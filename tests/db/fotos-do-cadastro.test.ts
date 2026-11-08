import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PHOTO_BUCKET, profilePhotoLink, removeProfilePhoto, uploadProfilePhoto, validatePhotoFile } from "../../src/lib/data/config/profilePhotos";
import { addMember, adminClient, createUser, deleteUsers, type TestUser } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// Fotos do profissional e das pessoas da Equipe (cliente, 08/nov/2026): o Administrador envia e remove as de todos;
// o profissional com login, só a do próprio cadastro; a Recepção não envia; outra clínica não vê.

let f: AgendaFixture;
let other: AgendaFixture;
let doctor: TestUser;
let draId: string;
let dra2Id: string;

// PNG de 1×1 pixel.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
const photo = (type = "image/png", size = PNG.byteLength) => ({ type, size, arrayBuffer: async () => PNG.buffer.slice(0) as ArrayBuffer });

const pathOf = async (table: "professionals" | "clinic_members", column: "id" | "user_id", id: string) =>
  ((await adminClient().from(table).select("photo_path").eq(column, id).single()).data as { photo_path: string | null }).photo_path;

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica das fotos", "+55849911771");
  other = await setupAgendaClinic("Outra clínica das fotos", "+55849911772");
  doctor = await createUser("fotos-dra");
  await addMember(f.clinicId, doctor.id, ["professional"]);
  const { data: agendas } = await adminClient().from("agendas").select("id, professional_id").in("id", [f.ids.agendaDra, f.ids.agendaDra2]);
  draId = agendas!.find((a) => a.id === f.ids.agendaDra)!.professional_id!;
  dra2Id = agendas!.find((a) => a.id === f.ids.agendaDra2)!.professional_id!;
  await adminClient().from("professionals").update({ user_id: doctor.id }).eq("id", draId);
});

afterAll(async () => {
  for (const id of [draId, dra2Id]) {
    const path = await pathOf("professionals", "id", id);
    if (path) await adminClient().storage.from(PHOTO_BUCKET).remove([path]);
  }
  const memberPath = await pathOf("clinic_members", "user_id", f.reception.id);
  if (memberPath) await adminClient().storage.from(PHOTO_BUCKET).remove([memberPath]);
  await f.cleanup();
  await other.cleanup();
  await deleteUsers([doctor]);
});

describe("fotos do cadastro", () => {
  it("recusa formato, tamanho e arquivo vazio", () => {
    expect(() => validatePhotoFile({ type: "image/gif", size: 10 })).toThrow(/formato/);
    expect(() => validatePhotoFile({ type: "image/png", size: 5 * 1024 * 1024 })).toThrow(/grande/);
    expect(() => validatePhotoFile({ type: "image/png", size: 0 })).toThrow(/vazio/);
  });

  it("o Administrador envia, troca (a anterior sai do armazenamento) e remove a foto do profissional", async () => {
    const db = asDb(f.admin);
    const owner = { kind: "professional" as const, id: dra2Id };
    await uploadProfilePhoto(db, f.clinicId, owner, photo());
    const first = await pathOf("professionals", "id", dra2Id);
    expect(first).toMatch(new RegExp(`^${f.clinicId}/profissionais/${dra2Id}/\\d+\\.png$`));
    expect(await profilePhotoLink(db, f.clinicId, owner)).toMatch(/^https?:\/\//);

    await new Promise((r) => setTimeout(r, 5));
    await uploadProfilePhoto(db, f.clinicId, owner, photo());
    const second = await pathOf("professionals", "id", dra2Id);
    expect(second).not.toBe(first);
    const { data: left } = await adminClient().storage.from(PHOTO_BUCKET).list(`${f.clinicId}/profissionais/${dra2Id}`);
    expect(left!.map((o) => o.name)).toEqual([second!.split("/").pop()]);

    await removeProfilePhoto(db, f.clinicId, owner);
    expect(await pathOf("professionals", "id", dra2Id)).toBeNull();
    expect(await profilePhotoLink(db, f.clinicId, owner)).toBeNull();
  });

  it("o Administrador envia a foto de uma pessoa da Equipe; a Recepção não", async () => {
    const owner = { kind: "member" as const, id: f.reception.id };
    expect(await codeOf(() => uploadProfilePhoto(asDb(f.reception), f.clinicId, owner, photo()))).not.toBe("ok");
    await uploadProfilePhoto(asDb(f.admin), f.clinicId, owner, photo("image/png"));
    expect(await pathOf("clinic_members", "user_id", f.reception.id)).toMatch(new RegExp(`^${f.clinicId}/equipe/${f.reception.id}/`));
    // Qualquer pessoa da clínica vê; outra clínica, não.
    expect(await profilePhotoLink(asDb(f.reception), f.clinicId, owner)).not.toBeNull();
    const path = (await pathOf("clinic_members", "user_id", f.reception.id))!;
    const { data } = await asDb(other.admin).storage.from(PHOTO_BUCKET).createSignedUrl(path, 60);
    expect(data?.signedUrl ?? null).toBeNull();
  });

  it("o profissional com login envia a própria foto, não a de outro profissional", async () => {
    await uploadProfilePhoto(asDb(doctor), f.clinicId, { kind: "professional", id: draId }, photo("image/png"));
    expect(await pathOf("professionals", "id", draId)).toMatch(new RegExp(`^${f.clinicId}/profissionais/${draId}/`));
    expect(await codeOf(() => uploadProfilePhoto(asDb(doctor), f.clinicId, { kind: "professional", id: dra2Id }, photo()))).not.toBe("ok");
    expect(await pathOf("professionals", "id", dra2Id)).toBeNull();
  });
});
