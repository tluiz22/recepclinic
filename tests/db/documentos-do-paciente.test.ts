import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import {
  confirmDocumentUpload,
  deleteDocument,
  documentLink,
  DOCUMENTS_BUCKET,
  listPatientDocuments,
  prepareDocumentUpload,
  type DocumentInput,
} from "../../src/lib/data/patientDocuments";
import { anonymizePatient } from "../../src/lib/data/patients";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { addMember, adminClient, createUser, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// CRM P1 — documentos do paciente: a equipe toda vê; Administrador e Recepção
// anexam e apagam (Q19); foto ou PDF até 10 MB (Q23); caminho por clínica e
// paciente; o banco lê o tipo e o tamanho do arquivo; anonimização apaga tudo.

let clinic: AgendaFixture;
let other: AgendaFixture;
let professional: TestUser;
let support: TestUser;

const pdf = (bytes = 2048) => new Blob([new Uint8Array(bytes).fill(37)], { type: "application/pdf" });
const input = (overrides: Partial<DocumentInput> = {}): DocumentInput => ({
  kind: "insurance_card",
  description: "Carteirinha 2026",
  fileName: "carteirinha.pdf",
  mimeType: "application/pdf",
  sizeBytes: 2048,
  ...overrides,
});

const send = async (uploadUrl: string, file: Blob) => {
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file);
  return fetch(uploadUrl, { method: "PUT", headers: { "x-upsert": "false" }, body });
};

/** O "Anexar" inteiro: preparar, enviar o arquivo e confirmar. */
const attach = async (db: DbClient, patientId: string, overrides: Partial<DocumentInput> = {}, file = pdf()) => {
  const doc = input({ sizeBytes: file.size, ...overrides });
  const { documentId, uploadUrl } = await prepareDocumentUpload(db, clinic.clinicId, patientId, doc);
  expect((await send(uploadUrl, file)).ok).toBe(true);
  return confirmDocumentUpload(db, clinic.clinicId, patientId, { ...doc, documentId });
};

beforeAll(async () => {
  clinic = await setupAgendaClinic("Clínica dos documentos", "849444700");
  other = await setupAgendaClinic("Outra clínica dos documentos", "849444800");
  [professional, support] = await Promise.all([createUser("doc-prof"), createUser("doc-sup")]);
  await addMember(clinic.clinicId, professional.id, ["professional"]);
  await makePlatformStaff(support.id);
});

afterAll(async () => {
  // Os arquivos de teste saem do armazenamento antes das clínicas.
  for (const f of [clinic, other]) {
    const { data } = await adminClient().from("patient_documents").select("storage_path").eq("clinic_id", f.clinicId);
    if (data?.length) await adminClient().storage.from(DOCUMENTS_BUCKET).remove(data.map((d) => d.storage_path));
  }
  await clinic.cleanup();
  await other.cleanup();
  await deleteUsers([professional, support]);
});

describe("anexar", () => {
  it("a Recepção anexa; o tipo e o tamanho gravados são os do arquivo; o autor é quem anexou", async () => {
    const id = await attach(asDb(clinic.reception), clinic.ids.p1, { sizeBytes: 1 });
    const { data } = await adminClient().from("patient_documents").select("*").eq("id", id).single();
    expect(data).toMatchObject({ kind: "insurance_card", description: "Carteirinha 2026", mime_type: "application/pdf", size_bytes: 2048, created_by: clinic.reception.id });
    expect(data!.storage_path).toBe(`${clinic.clinicId}/${clinic.ids.p1}/${id}.pdf`);
  });

  it("o Administrador e o Suporte anexam (o Suporte com auditoria)", async () => {
    await attach(asDb(clinic.admin), clinic.ids.p1, { kind: "identity" });
    await attach(asDb(support), clinic.ids.p1, { kind: "other" });
    const { data } = await adminClient().from("platform_audit_log").select("operation").eq("table_name", "patient_documents").eq("actor_user_id", support.id);
    expect(data).toEqual([{ operation: "INSERT" }]);
  });

  it("o Profissional e outra clínica não anexam", async () => {
    expect(await codeOf(() => attach(asDb(professional), clinic.ids.p1))).toBe("forbidden");
    expect(await codeOf(() => prepareDocumentUpload(asDb(other.reception), clinic.clinicId, clinic.ids.p1, input()))).toBe("not_found");
    // Nem direto no armazenamento, na pasta da clínica.
    const { error } = await asDb(professional).storage.from(DOCUMENTS_BUCKET).upload(`${clinic.clinicId}/${clinic.ids.p1}/x.pdf`, pdf());
    expect(error).not.toBeNull();
  });

  it("tipo, tamanho e descrição conferidos; o armazenamento recusa outro tipo de arquivo", async () => {
    const db = asDb(clinic.reception);
    expect(await codeOf(() => prepareDocumentUpload(db, clinic.clinicId, clinic.ids.p1, input({ mimeType: "text/plain" })))).toBe("invalid");
    expect(await codeOf(() => prepareDocumentUpload(db, clinic.clinicId, clinic.ids.p1, input({ sizeBytes: 10 * 1024 * 1024 + 1 })))).toBe("invalid");
    expect(await codeOf(() => prepareDocumentUpload(db, clinic.clinicId, clinic.ids.p1, input({ kind: "receita" })))).toBe("invalid");
    expect(await codeOf(() => prepareDocumentUpload(db, clinic.clinicId, clinic.ids.p1, input({ description: "x".repeat(121) })))).toBe("invalid");
    const { uploadUrl } = await prepareDocumentUpload(db, clinic.clinicId, clinic.ids.p1, input());
    expect((await send(uploadUrl, new Blob(["oi"], { type: "text/plain" }))).ok).toBe(false);
  });

  it("confirmar sem o arquivo ou com o caminho de outro paciente é recusado", async () => {
    const db = asDb(clinic.reception);
    expect(await codeOf(() => confirmDocumentUpload(db, clinic.clinicId, clinic.ids.p1, { ...input(), documentId: crypto.randomUUID() }))).toBe("invalid");
    // Arquivo enviado na pasta do Paciente Um, linha gravada para o Paciente Dois.
    const { documentId, uploadUrl } = await prepareDocumentUpload(db, clinic.clinicId, clinic.ids.p1, input());
    await send(uploadUrl, pdf());
    const { error } = await db.from("patient_documents").insert({
      id: documentId,
      clinic_id: clinic.clinicId,
      patient_id: clinic.ids.p2,
      kind: "other",
      storage_path: `${clinic.clinicId}/${clinic.ids.p1}/${documentId}.pdf`,
      file_name: "a.pdf",
      mime_type: "application/pdf",
      size_bytes: 1,
    });
    expect(error).toMatchObject({ code: "23514" });
  });
});

describe("ver, abrir e apagar", () => {
  it("a equipe toda vê e abre; outra clínica não", async () => {
    const mine = await listPatientDocuments(asDb(professional), clinic.clinicId, clinic.ids.p1);
    expect(mine.length).toBeGreaterThanOrEqual(3);
    const url = await documentLink(asDb(professional), clinic.clinicId, clinic.ids.p1, mine[0].id, "download");
    const file = await fetch(url);
    expect(file.ok).toBe(true);
    expect((await file.arrayBuffer()).byteLength).toBe(mine[0].sizeBytes);
    expect(await listPatientDocuments(asDb(other.admin), clinic.clinicId, clinic.ids.p1)).toEqual([]);
    expect(await codeOf(() => documentLink(asDb(other.admin), clinic.clinicId, clinic.ids.p1, mine[0].id, "open"))).toBe("not_found");
  });

  it("ninguém altera; o Profissional não apaga; a Recepção apaga a linha e o arquivo", async () => {
    const db = asDb(clinic.reception);
    const id = await attach(db, clinic.ids.p2, { kind: "exam_request" });
    expect((await asDb(clinic.admin).from("patient_documents").update({ kind: "other" }).eq("id", id)).error).toMatchObject({ code: "42501" });
    expect(await codeOf(() => deleteDocument(asDb(professional), clinic.clinicId, clinic.ids.p2, id))).toBe("forbidden");
    const { data: row } = await adminClient().from("patient_documents").select("storage_path").eq("id", id).single();
    expect(await deleteDocument(db, clinic.clinicId, clinic.ids.p2, id)).toEqual({ fileRemoved: true });
    expect(await listPatientDocuments(db, clinic.clinicId, clinic.ids.p2)).toEqual([]);
    const { data: files } = await adminClient().storage.from(DOCUMENTS_BUCKET).list(`${clinic.clinicId}/${clinic.ids.p2}`);
    expect(files?.map((f) => f.name)).not.toContain(row!.storage_path.split("/").pop());
  });
});

describe("anonimização", () => {
  it("apaga os documentos e os arquivos do paciente", async () => {
    const db = asDb(clinic.admin);
    await attach(db, clinic.ids.p3, { kind: "medical_request" });
    await anonymizePatient(db, clinic.clinicId, clinic.ids.p3);
    const { data } = await adminClient().from("patient_documents").select("id").eq("patient_id", clinic.ids.p3);
    expect(data).toEqual([]);
    const { data: files } = await adminClient().storage.from(DOCUMENTS_BUCKET).list(`${clinic.clinicId}/${clinic.ids.p3}`);
    expect(files ?? []).toEqual([]);
  });
});
