import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFiscalCertificate, getFiscalSettings, listFiscalAudit, listServiceFiscalCodes, revokeFiscalCertificate, saveFiscalSettings, saveServiceFiscalCodes, uploadFiscalCertificate, type FiscalSettingsInput } from "../../src/lib/data/fiscal";
import { FISCAL_TERMS_VERSION } from "../../src/lib/fiscalTerms";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, withDatabase, type TestUser } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { makeTestPfx } from "./pfx";

// F11.3 — Dados fiscais e certificado A1. Dados: Administrador e Suporte
// gravam; Recepção, Profissional, bot e outra clínica não. Certificado: só o
// Administrador da clínica, com o termo, do mesmo CNPJ e válido; o arquivo e
// a senha ficam no Vault (somem ao revogar); trilha só de inclusão; nada
// grava direto nas tabelas do certificado; sem o item, nada grava.
const CNPJ = "11222333000181";
const OTHER_CNPJ = "11444777000161";
const SETTINGS: FiscalSettingsInput = {
  cnpj: "11.222.333/0001-81",
  legalName: "Clínica de Teste Ltda",
  municipalRegistration: "12345",
  municipalityIbge: "2408003",
  simplesNacional: "me_epp",
  specialRegime: "professional_society",
  serviceCode: "040101",
  issRate: "2,5",
};

let fixture: AgendaFixture;
let clinicId: string;
let professional: TestUser;
let support: TestUser;
let outsider: TestUser;
let otherClinic: string;
let emptyClinic: string;
let emptyAdmin: TestUser;

const upload = (user: TestUser, pfx: Uint8Array, password = "senha", clinic = clinicId) =>
  uploadFiscalCertificate(asDb(user), clinic, { pfx, password, acceptedTerms: true });

const vaultSecrets = (clinic: string) =>
  withDatabase(async (db) => {
    const { rows } = await db.query(`select name from vault.secrets where name like $1 order by name`, [`fiscal_pfx_%${clinic}`]);
    return rows.map((r) => r.name as string);
  });

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste dos dados fiscais", "+55619888");
  clinicId = fixture.clinicId;
  professional = await createUser("fis-prof");
  await addMember(clinicId, professional.id, ["professional"]);
  support = await createUser("fis-suporte");
  await makePlatformStaff(support.id);
  otherClinic = await createClinic("Outra clínica dos dados fiscais");
  outsider = await createUser("fis-outra");
  await addMember(otherClinic, outsider.id, ["admin", "reception"]);
  emptyClinic = await createClinic("Clínica sem dados fiscais");
  emptyAdmin = await createUser("fis-sem-dados");
  await addMember(emptyClinic, emptyAdmin.id, ["admin"]);
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteClinics([otherClinic, emptyClinic]);
  await deleteUsers([professional, support, outsider, emptyAdmin]);
});

describe("Dados fiscais (F11.3)", () => {
  it("o Administrador grava; o Suporte também", async () => {
    await saveFiscalSettings(asDb(fixture.admin), clinicId, SETTINGS);
    expect(await getFiscalSettings(asDb(fixture.admin), clinicId)).toEqual({
      cnpj: CNPJ,
      legalName: "Clínica de Teste Ltda",
      municipalRegistration: "12345",
      municipalityIbge: "2408003",
      simplesNacional: "me_epp",
      specialRegime: "professional_society",
      serviceCode: "04.01.01",
      issRate: 2.5,
    });
    await saveFiscalSettings(asDb(support), clinicId, { ...SETTINGS, issRate: "2" });
    expect((await getFiscalSettings(asDb(fixture.admin), clinicId))?.issRate).toBe(2);
  });

  it("recusa CNPJ, município, código e alíquota inválidos (na tela e no banco)", async () => {
    expect(await codeOf(() => saveFiscalSettings(asDb(fixture.admin), clinicId, { ...SETTINGS, cnpj: "11.222.333/0001-80" }))).toBe("invalid");
    expect(await codeOf(() => saveFiscalSettings(asDb(fixture.admin), clinicId, { ...SETTINGS, municipalityIbge: "3550308" }))).toBe("invalid");
    expect(await codeOf(() => saveFiscalSettings(asDb(fixture.admin), clinicId, { ...SETTINGS, serviceCode: "04.01" }))).toBe("invalid");
    expect(await codeOf(() => saveFiscalSettings(asDb(fixture.admin), clinicId, { ...SETTINGS, issRate: "6" }))).toBe("invalid");
    const { error: cnpj } = await fixture.admin.client.from("clinic_fiscal_settings").update({ cnpj: "11222333000180" }).eq("clinic_id", clinicId);
    expect(cnpj?.code).toBe("23514");
    const { error: city } = await fixture.admin.client.from("clinic_fiscal_settings").update({ municipality_ibge: "3550308" }).eq("clinic_id", clinicId);
    expect(city?.code).toBe("23514");
  });

  it("código próprio por serviço: grava e volta ao padrão quando vazio", async () => {
    await saveServiceFiscalCodes(asDb(fixture.admin), clinicId, [{ serviceId: fixture.ids.exame, code: "04.02.01" }]);
    expect((await listServiceFiscalCodes(asDb(fixture.admin), clinicId)).get(fixture.ids.exame)).toBe("04.02.01");
    await saveServiceFiscalCodes(asDb(fixture.admin), clinicId, [{ serviceId: fixture.ids.exame, code: "" }]);
    expect((await listServiceFiscalCodes(asDb(fixture.admin), clinicId)).size).toBe(0);
  });

  it("a Recepção, o Profissional, o bot e outra clínica não leem nem gravam", async () => {
    expect(await getFiscalSettings(asDb(fixture.reception), clinicId)).toBeNull();
    expect(await getFiscalSettings(asDb(professional), clinicId)).toBeNull();
    expect(await codeOf(() => saveFiscalSettings(asDb(fixture.reception), clinicId, SETTINGS))).toBe("forbidden");
    expect(await codeOf(() => saveFiscalSettings(asDb(outsider), clinicId, SETTINGS))).toBe("forbidden");
    const { error } = await clinicServiceClient(clinicId).from("clinic_fiscal_settings").select("cnpj");
    expect(error?.code).toBe("42501");
  });
});

describe("Certificado A1 (F11.3)", () => {
  it("o Administrador envia, com o termo: titular, CNPJ e validade; arquivo e senha no Vault; trilha", async () => {
    const saved = await upload(fixture.admin, makeTestPfx(CNPJ, "senha"));
    expect(saved.subjectName).toBe("CLINICA DE TESTE LTDA");
    expect(saved.subjectCnpj).toBe(CNPJ);
    expect(saved.termsVersion).toBe(FISCAL_TERMS_VERSION);
    expect(await vaultSecrets(clinicId)).toEqual([`fiscal_pfx_${clinicId}`, `fiscal_pfx_password_${clinicId}`]);
    const audit = await listFiscalAudit(asDb(fixture.admin), clinicId);
    expect(audit.map((a) => a.event).sort()).toEqual(["certificate_uploaded", "terms_accepted"]);
    expect(audit.every((a) => a.actorId === fixture.admin.id)).toBe(true);
    expect(JSON.stringify(audit)).not.toContain("senha");
  });

  it("recusa sem o termo, senha errada, outro CNPJ, vencido e clínica sem dados fiscais", async () => {
    expect(await codeOf(() => uploadFiscalCertificate(asDb(fixture.admin), clinicId, { pfx: makeTestPfx(CNPJ, "s"), password: "s", acceptedTerms: false }))).toBe("invalid");
    expect(await codeOf(() => upload(fixture.admin, makeTestPfx(CNPJ, "senha"), "errada"))).toBe("invalid");
    expect(await codeOf(() => upload(fixture.admin, makeTestPfx(OTHER_CNPJ, "senha")))).toBe("invalid");
    const expired = makeTestPfx(CNPJ, "senha", { validFrom: new Date("2024-01-01"), validUntil: new Date("2025-01-01") });
    expect(await codeOf(() => upload(fixture.admin, expired))).toBe("invalid");
    expect(await codeOf(() => upload(emptyAdmin, makeTestPfx(CNPJ, "senha"), "senha", emptyClinic))).toBe("invalid");
    expect((await getFiscalCertificate(asDb(fixture.admin), clinicId))?.subjectCnpj).toBe(CNPJ);
  });

  it("a Recepção e o Suporte não enviam nem revogam", async () => {
    expect(await codeOf(() => upload(fixture.reception, makeTestPfx(CNPJ, "senha")))).toBe("forbidden");
    expect(await codeOf(() => upload(support, makeTestPfx(CNPJ, "senha")))).toBe("forbidden");
    expect(await codeOf(() => revokeFiscalCertificate(asDb(support), clinicId))).toBe("forbidden");
    expect(await codeOf(() => revokeFiscalCertificate(asDb(fixture.reception), clinicId))).toBe("forbidden");
  });

  it("ninguém grava direto nas tabelas do certificado e da trilha", async () => {
    const { error: insert } = await fixture.admin.client.from("clinic_fiscal_certificates").update({ subject_cnpj: OTHER_CNPJ }).eq("clinic_id", clinicId);
    expect(insert?.code).toBe("42501");
    const { error: audit } = await fixture.admin.client.from("fiscal_audit_log").delete().eq("clinic_id", clinicId);
    expect(audit?.code).toBe("42501");
    const { data: other } = await outsider.client.from("clinic_fiscal_certificates").select("subject_name").eq("clinic_id", clinicId);
    expect(other).toEqual([]);
    const { error: bot } = await clinicServiceClient(clinicId).from("clinic_fiscal_certificates").select("subject_name");
    expect(bot?.code).toBe("42501");
  });

  it("trocar mantém os mesmos segredos; revogar apaga do Vault e registra", async () => {
    await upload(fixture.admin, makeTestPfx(CNPJ, "outra"), "outra");
    expect((await listFiscalAudit(asDb(fixture.admin), clinicId)).map((a) => a.event)).toContain("certificate_replaced");
    expect(await vaultSecrets(clinicId)).toHaveLength(2);
    await revokeFiscalCertificate(asDb(fixture.admin), clinicId);
    expect(await getFiscalCertificate(asDb(fixture.admin), clinicId)).toBeNull();
    expect(await vaultSecrets(clinicId)).toEqual([]);
    expect((await listFiscalAudit(asDb(fixture.admin), clinicId))[0].event).toBe("certificate_revoked");
    expect(await codeOf(() => revokeFiscalCertificate(asDb(fixture.admin), clinicId))).toBe("invalid");
  });

  it("sem o item liberado, nada grava (revogar continua valendo)", async () => {
    await upload(fixture.admin, makeTestPfx(CNPJ, "senha"));
    await adminClient().from("clinic_features").delete().eq("clinic_id", clinicId).eq("feature_key", "finance");
    try {
      expect(await codeOf(() => saveFiscalSettings(asDb(fixture.admin), clinicId, SETTINGS))).toBe("not_enabled");
      expect(await codeOf(() => upload(fixture.admin, makeTestPfx(CNPJ, "senha")))).toBe("not_enabled");
      await revokeFiscalCertificate(asDb(fixture.admin), clinicId);
      expect(await vaultSecrets(clinicId)).toEqual([]);
    } finally {
      await adminClient().from("clinic_features").insert({ clinic_id: clinicId, feature_key: "finance" });
    }
  });

  it("excluir a clínica apaga os segredos do certificado", async () => {
    const temp = await createClinic("Clínica temporária do certificado");
    const tempAdmin = await createUser("fis-temp");
    await addMember(temp, tempAdmin.id, ["admin"]);
    try {
      await saveFiscalSettings(asDb(tempAdmin), temp, SETTINGS);
      await upload(tempAdmin, makeTestPfx(CNPJ, "senha"), "senha", temp);
      expect(await vaultSecrets(temp)).toHaveLength(2);
      await deleteClinics([temp]);
      expect(await vaultSecrets(temp)).toEqual([]);
    } finally {
      await deleteUsers([tempAdmin]);
    }
  });
});
