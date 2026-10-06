import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import {
  getPublicClinicBrand,
  LOGO_BUCKET,
  logoPathFromUrl,
  removeClinicLogo,
  uploadClinicLogo,
} from "../../src/lib/data/config/brand";
import { getClinicSettings, updateClinicSettings } from "../../src/lib/data/config/clinic";
import { addMember, adminClient, createClinic, createUser, deleteClinics, deleteUsers, type TestUser } from "./helpers";
import { codeOf } from "./agendaFixture";

// F5.1 — Marca da clínica: site, logo no Storage (bucket "clinic-logos") e a
// marca lida pelas páginas públicas.

let clinicA: string;
let clinicB: string;
let adminA: TestUser;
let receptionA: TestUser;
let adminB: TestUser;
const asDb = (user: TestUser) => user.client as unknown as DbClient;

// PNG de 1×1 pixel.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);
const pngFile = () => ({ size: PNG.byteLength, type: "image/png", arrayBuffer: async () => PNG.slice().buffer });

async function storedFiles(clinicId: string): Promise<string[]> {
  const { data, error } = await adminClient().storage.from(LOGO_BUCKET).list(clinicId);
  if (error) throw error;
  return data.map((file) => file.name);
}

beforeAll(async () => {
  clinicA = await createClinic("Clínica A (marca)");
  clinicB = await createClinic("Clínica B (marca)");
  [adminA, receptionA, adminB] = await Promise.all([createUser("marca-admin-a"), createUser("marca-recep-a"), createUser("marca-admin-b")]);
  await addMember(clinicA, adminA.id, ["admin"]);
  await addMember(clinicA, receptionA.id, ["reception"]);
  await addMember(clinicB, adminB.id, ["admin"]);
});

afterAll(async () => {
  for (const clinicId of [clinicA, clinicB]) {
    const files = await storedFiles(clinicId);
    if (files.length) await adminClient().storage.from(LOGO_BUCKET).remove(files.map((name) => `${clinicId}/${name}`));
  }
  await deleteClinics([clinicA, clinicB]);
  await deleteUsers([adminA, receptionA, adminB]);
});

describe("marca da clínica", () => {
  it("site: ganha https:// quando falta; vazio tira; endereço inválido é recusado", async () => {
    await updateClinicSettings(asDb(adminA), clinicA, { websiteUrl: " www.clinicaa.com.br " });
    expect((await getClinicSettings(asDb(adminA), clinicA)).websiteUrl).toBe("https://www.clinicaa.com.br");
    expect(await codeOf(() => updateClinicSettings(asDb(adminA), clinicA, { websiteUrl: "clinica a" }))).toBe("invalid");
    await updateClinicSettings(asDb(adminA), clinicA, { websiteUrl: "" });
    expect((await getClinicSettings(asDb(adminA), clinicA)).websiteUrl).toBeNull();
  });

  it("o Administrador envia o logo; o endereço é público; trocar apaga o anterior; remover limpa", async () => {
    const first = await uploadClinicLogo(asDb(adminA), clinicA, pngFile());
    expect(logoPathFromUrl(first)).toMatch(new RegExp(`^${clinicA}/logo-\\d+\\.png$`));
    const response = await fetch(first);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await uploadClinicLogo(asDb(adminA), clinicA, pngFile());
    expect(second).not.toBe(first);
    expect(await storedFiles(clinicA)).toEqual([logoPathFromUrl(second)!.split("/")[1]]);
    expect((await getPublicClinicBrand(adminClient() as unknown as DbClient, clinicA)).logoUrl).toBe(second);

    await removeClinicLogo(asDb(adminA), clinicA);
    expect(await storedFiles(clinicA)).toEqual([]);
    expect((await getClinicSettings(asDb(adminA), clinicA)).logoUrl).toBeNull();
  });

  it("a Recepção não envia; o Administrador de outra clínica não escreve na pasta dela", async () => {
    expect(await codeOf(() => uploadClinicLogo(asDb(receptionA), clinicA, pngFile()))).toBe("forbidden");
    const { error } = await asDb(adminB).storage.from(LOGO_BUCKET).upload(`${clinicA}/intruso.png`, PNG, { contentType: "image/png" });
    expect(error).not.toBeNull();
    const { error: outside } = await asDb(adminB).storage.from(LOGO_BUCKET).upload(`solto.png`, PNG, { contentType: "image/png" });
    expect(outside).not.toBeNull();
    expect(await storedFiles(clinicA)).toEqual([]);
  });

  it("formato e tamanho fora do combinado são recusados antes de enviar", async () => {
    expect(await codeOf(() => uploadClinicLogo(asDb(adminA), clinicA, { ...pngFile(), type: "image/gif" }))).toBe("invalid");
    expect(await codeOf(() => uploadClinicLogo(asDb(adminA), clinicA, { ...pngFile(), size: 1024 * 1024 + 1 }))).toBe("invalid");
  });

  it("páginas públicas: sem cor escolhida usa a padrão; nome e site da clínica", async () => {
    await updateClinicSettings(asDb(adminB), clinicB, { brandColor: null, websiteUrl: "https://clinicab.com.br" });
    expect(await getPublicClinicBrand(adminClient() as unknown as DbClient, clinicB)).toEqual({
      name: "Clínica B (marca)",
      logoUrl: null,
      brandColor: "#0369A1",
      websiteUrl: "https://clinicab.com.br",
    });
  });
});
