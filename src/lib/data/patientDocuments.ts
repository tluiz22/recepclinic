import type { DbClient } from "./clients";
import { DataError, unwrap } from "./errors";

// Documentos do paciente (CRM P1, cliente, 28/out/2026): foto ou PDF da
// carteirinha, identidade, pedido de exame ou médico, para a secretária
// encaminhar ao plano de saúde. O arquivo vai do aparelho direto ao
// armazenamento privado por um link de envio de uso único (o limite das
// funções da Vercel não se aplica); depois a linha é gravada, e o banco confere
// o caminho, o tipo e o tamanho (20261029120000_documentos_do_paciente.sql).

export const DOCUMENTS_BUCKET = "patient-documents";

export type DocumentKind = "insurance_card" | "identity" | "exam_request" | "medical_request" | "other";

export const DOCUMENT_KINDS: { key: DocumentKind; label: string }[] = [
  { key: "insurance_card", label: "Carteirinha do convênio" },
  { key: "identity", label: "Documento de identidade" },
  { key: "exam_request", label: "Pedido de exame" },
  { key: "medical_request", label: "Pedido médico" },
  { key: "other", label: "Outro" },
];

export const DOCUMENT_KIND_LABEL = Object.fromEntries(DOCUMENT_KINDS.map((k) => [k.key, k.label])) as Record<DocumentKind, string>;

/** Q23: foto (JPG, PNG, HEIC) ou PDF, até 10 MB. */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};
export const DOCUMENT_MIME_TYPES = Object.keys(EXTENSION);
export const DESCRIPTION_MAX = 120;

export type PatientDocument = {
  id: string;
  kind: DocumentKind;
  description: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  createdBy: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DocumentInput = { kind: string; description: string | null; fileName: string; mimeType: string; sizeBytes: number };

/** Confere o pedido de envio (tipo do documento, arquivo, tamanho e descrição). */
export function validateDocumentInput(input: DocumentInput): { kind: DocumentKind; description: string | null; fileName: string; mimeType: string } {
  const fields: Record<string, string> = {};
  if (!DOCUMENT_KINDS.some((k) => k.key === input.kind)) fields.kind = "Escolha o tipo do documento.";
  if (!EXTENSION[input.mimeType]) fields.file = "Envie uma foto (JPG, PNG ou HEIC) ou um PDF.";
  if (!(input.sizeBytes > 0)) fields.file ??= "Escolha o arquivo.";
  else if (input.sizeBytes > DOCUMENT_MAX_BYTES) fields.file = "O arquivo passa de 10 MB. Envie uma foto menor ou um PDF mais leve.";
  const description = input.description?.trim() || null;
  if (description && description.length > DESCRIPTION_MAX) fields.description = `A descrição vai até ${DESCRIPTION_MAX} caracteres.`;
  if (Object.keys(fields).length) throw new DataError("invalid", "Documento: confira os campos", fields);
  const fileName = (input.fileName.split(/[\\/]/).pop() || "documento").trim().slice(0, 200) || "documento";
  return { kind: input.kind as DocumentKind, description, fileName, mimeType: input.mimeType };
}

/** "<clínica>/<paciente>/<documento>.<ext>" (a primeira pasta é a clínica: as regras do armazenamento leem dela). */
export function documentPath(clinicId: string, patientId: string, documentId: string, mimeType: string): string {
  return `${clinicId}/${patientId}/${documentId}.${EXTENSION[mimeType] ?? "bin"}`;
}

async function activePatient(db: DbClient, clinicId: string, patientId: string): Promise<void> {
  if (!UUID.test(patientId)) throw new DataError("not_found", "Documento: paciente não encontrado");
  const patient = unwrap(await db.from("patients").select("id, anonymized_at").eq("clinic_id", clinicId).eq("id", patientId).maybeSingle(), "Documento");
  if (!patient || patient.anonymized_at) throw new DataError("not_found", "Documento: paciente não encontrado");
}

/**
 * 1º passo do "Anexar": confere o pedido e devolve o link de envio de uso
 * único (o armazenamento recusa sem o papel de Administrador ou Recepção).
 */
export async function prepareDocumentUpload(
  db: DbClient,
  clinicId: string,
  patientId: string,
  input: DocumentInput,
): Promise<{ documentId: string; path: string; uploadUrl: string }> {
  const valid = validateDocumentInput(input);
  await activePatient(db, clinicId, patientId);
  const documentId = crypto.randomUUID();
  const path = documentPath(clinicId, patientId, documentId, valid.mimeType);
  const { data, error } = await db.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    const status = (error as { statusCode?: string; status?: number } | null)?.statusCode ?? (error as { status?: number } | null)?.status;
    if (String(status) === "403" || String(status) === "400") throw new DataError("forbidden", "Documento: sem permissão para anexar");
    throw new DataError("unexpected", `Documento: link de envio não gerado (${error?.message ?? "sem resposta"})`);
  }
  return { documentId, path, uploadUrl: data.signedUrl };
}

/** 2º passo: o arquivo já subiu; grava o documento (o banco lê o tipo e o tamanho do arquivo). */
export async function confirmDocumentUpload(
  db: DbClient,
  clinicId: string,
  patientId: string,
  input: DocumentInput & { documentId: string },
): Promise<string> {
  const valid = validateDocumentInput(input);
  if (!UUID.test(input.documentId)) throw new DataError("not_found", "Documento: envio não encontrado");
  await activePatient(db, clinicId, patientId);
  const { error } = await db.from("patient_documents").insert({
    id: input.documentId,
    clinic_id: clinicId,
    patient_id: patientId,
    kind: valid.kind,
    description: valid.description,
    storage_path: documentPath(clinicId, patientId, input.documentId, valid.mimeType),
    file_name: valid.fileName,
    mime_type: valid.mimeType,
    size_bytes: input.sizeBytes,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23514") throw new DataError("invalid", "Documento: arquivo não encontrado", { file: "O arquivo não chegou. Tente anexar de novo." });
    if (code === "42501") throw new DataError("forbidden", "Documento: sem permissão para anexar");
    throw new DataError("unexpected", `Documento: ${error.message}`, {}, { cause: error });
  }
  return input.documentId;
}

const COLUMNS = "id, kind, description, file_name, mime_type, size_bytes, created_at, created_by";
type Row = { id: string; kind: string; description: string | null; file_name: string; mime_type: string; size_bytes: number; created_at: string; created_by: string | null };

export async function listPatientDocuments(db: DbClient, clinicId: string, patientId: string): Promise<PatientDocument[]> {
  const rows = unwrap(
    await db.from("patient_documents").select(COLUMNS).eq("clinic_id", clinicId).eq("patient_id", patientId).order("created_at", { ascending: false }),
    "Documentos",
  ) as Row[];
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as DocumentKind,
    description: row.description,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: new Date(row.created_at),
    createdBy: row.created_by,
  }));
}

async function documentRow(db: DbClient, clinicId: string, patientId: string, documentId: string) {
  if (!UUID.test(documentId)) throw new DataError("not_found", "Documento: não encontrado");
  const row = unwrap(
    await db.from("patient_documents").select("id, storage_path, file_name").eq("clinic_id", clinicId).eq("patient_id", patientId).eq("id", documentId).maybeSingle(),
    "Documento",
  );
  if (!row) throw new DataError("not_found", "Documento: não encontrado");
  return row;
}

/** Link de 2 minutos para abrir ou baixar (com o nome do arquivo). */
export async function documentLink(db: DbClient, clinicId: string, patientId: string, documentId: string, mode: "open" | "download"): Promise<string> {
  const row = await documentRow(db, clinicId, patientId, documentId);
  const { data, error } = await db.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(row.storage_path, 120, mode === "download" ? { download: row.file_name } : undefined);
  if (error || !data) throw new DataError("unexpected", "Documento: link não gerado");
  return data.signedUrl;
}

/**
 * Apaga o documento: a linha primeiro (some da ficha) e o arquivo em seguida.
 * Se o arquivo não sair, o erro volta para quem chamou registrar (fica órfão,
 * sem dado ligado a ele na ficha).
 */
export async function deleteDocument(db: DbClient, clinicId: string, patientId: string, documentId: string): Promise<{ fileRemoved: boolean }> {
  const row = await documentRow(db, clinicId, patientId, documentId);
  const { data, error } = await db.from("patient_documents").delete().eq("clinic_id", clinicId).eq("id", row.id).select("id");
  if (error) throw new DataError("unexpected", `Documento: ${error.message}`, {}, { cause: error });
  if (!data?.length) throw new DataError("forbidden", "Documento: sem permissão para apagar");
  return { fileRemoved: await removeDocumentFiles(db, [row.storage_path]) };
}

/** Caminhos dos arquivos do paciente (lidos antes da anonimização, que apaga as linhas). */
export async function documentPaths(db: DbClient, clinicId: string, patientId: string): Promise<string[]> {
  const rows = unwrap(await db.from("patient_documents").select("storage_path").eq("clinic_id", clinicId).eq("patient_id", patientId), "Documentos");
  return rows.map((row) => row.storage_path);
}

/** Apaga os arquivos no armazenamento; false = algum não saiu. */
export async function removeDocumentFiles(db: DbClient, paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true;
  const { data, error } = await db.storage.from(DOCUMENTS_BUCKET).remove(paths);
  return !error && (data?.length ?? 0) === paths.length;
}
