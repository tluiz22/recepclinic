import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getFiscalIssuer,
  getFiscalIssuerOverview,
  getIssuerOf,
  saveFiscalIssuer,
  setIssuerPayer,
  setIssuingEnabled,
  setProfessionalRoute,
  setIssuerServiceCode,
  type IssuerInput,
} from "../../src/lib/data/fiscalIssuers";
import { addMember, adminClient, createClinic, createUser, deleteClinics, deleteUsers, withDatabase, type TestUser } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// N2a — Emissores fiscais (planejamento-nfse-asaas.md, seção 14.7). N-P1: o
// Administrador escolhe como o profissional sem CNPJ emite; N-P2: o
// Administrador e o próprio profissional configuram o emissor dele; Recepção
// e outra clínica não; a subconta e a chave só pelo servidor (service role);
// N-P6: pagador profissional precisa de login; emissão só liga completa.

const INPUT: IssuerInput = {
  cnpj: "11.222.333/0001-81",
  legalName: "Clínica do Teste Ltda",
  fiscalEmail: "Fiscal@Clinica.Teste",
  mobilePhone: "(84) 98888-0000",
  companyType: "LIMITED",
  monthlyIncome: "30.000",
  postalCode: "59600-000",
  street: "Rua A",
  streetNumber: "10",
  complement: "",
  district: "Centro",
  municipalityIbge: "2408003",
  municipalRegistration: "12345",
  simplesNacional: "false",
  specialTaxRegime: "0",
  cnae: "8630-5/03",
  serviceCode: "040101",
  serviceName: "Medicina",
  nbsCode: "123012200",
  issRate: "5",
  pisCofinsTaxStatus: "",
  taxSituationCode: "200",
  taxClassificationCode: "200029",
  operationIndicatorCode: "030101",
  rpsSeries: "2026",
  rpsNextNumber: "1",
};
const PRO_INPUT: IssuerInput = { ...INPUT, cnpj: "45.723.174/0001-10", legalName: "Dra. Agenda Medicina Ltda", fiscalEmail: "dra@teste.local" };

let fixture: AgendaFixture;
let clinicId: string;
let draId: string;
let dr2Id: string;
let draUser: TestUser;
let outsider: TestUser;
let otherClinic: string;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste dos emissores", "+55619877000");
  clinicId = fixture.clinicId;
  const { data } = await adminClient().from("agendas").select("id, professional_id").in("id", [fixture.ids.agendaDra, fixture.ids.agendaDra2]);
  draId = data!.find((a) => a.id === fixture.ids.agendaDra)!.professional_id as string;
  dr2Id = data!.find((a) => a.id === fixture.ids.agendaDra2)!.professional_id as string;
  draUser = await createUser("emi-dra");
  await addMember(clinicId, draUser.id, ["professional"]);
  await adminClient().from("professionals").update({ user_id: draUser.id }).eq("id", draId);
  otherClinic = await createClinic("Outra clínica dos emissores");
  outsider = await createUser("emi-outra");
  await addMember(otherClinic, outsider.id, ["admin"]);
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteClinics([otherClinic]);
  await deleteUsers([draUser, outsider]);
});

describe("Emissores fiscais (N2a)", () => {
  it("o Administrador grava o emissor da clínica (campos normalizados) e a trilha registra", async () => {
    const id = await saveFiscalIssuer(asDb(fixture.admin), clinicId, null, INPUT);
    const issuer = await getFiscalIssuer(asDb(fixture.admin), id);
    expect(issuer).toMatchObject({
      kind: "clinic",
      cnpj: "11222333000181",
      fiscalEmail: "fiscal@clinica.teste",
      mobilePhone: "84988880000",
      monthlyIncomeCents: 3_000_000,
      postalCode: "59600000",
      cnae: "8630503",
      serviceListItem: "04.01",
      serviceCode: "04.01.01",
      nbsCode: "1.2301.22.00",
      issRate: 5,
      accountStatus: "none",
      issuingEnabled: false,
      payer: "clinic",
    });
    const log = await withDatabase(async (db) => (await db.query(`select event from public.fiscal_audit_log where issuer_id = $1`, [id])).rows);
    expect(log.map((r) => r.event)).toContain("issuer_saved");
  });

  it("N-P2: o profissional com login configura o próprio emissor; não o de outro nem o da clínica", async () => {
    const own = await saveFiscalIssuer(asDb(draUser), clinicId, draId, PRO_INPUT);
    expect((await getFiscalIssuer(asDb(draUser), own))?.kind).toBe("professional");
    expect(await codeOf(() => saveFiscalIssuer(asDb(draUser), clinicId, dr2Id, { ...PRO_INPUT, cnpj: "11.444.777/0001-61" }))).toBe("forbidden");
    expect(await codeOf(() => saveFiscalIssuer(asDb(draUser), clinicId, null, INPUT))).toBe("forbidden");
    // Só vê o dele.
    const { data } = await asDb(draUser).from("fiscal_issuers").select("id");
    expect(data?.map((r) => r.id)).toEqual([own]);
  });

  it("Recepção e outra clínica não leem nem gravam; ninguém grava direto na tabela", async () => {
    expect(await codeOf(() => saveFiscalIssuer(asDb(fixture.reception), clinicId, null, INPUT))).toBe("forbidden");
    expect(await codeOf(() => saveFiscalIssuer(asDb(outsider), clinicId, null, INPUT))).toBe("forbidden");
    const { data } = await asDb(fixture.reception).from("fiscal_issuers").select("id").eq("clinic_id", clinicId);
    expect(data).toEqual([]);
    const { error } = await asDb(fixture.admin).from("fiscal_issuers").update({ issuing_enabled: true }).eq("clinic_id", clinicId);
    expect(error).not.toBeNull();
  });

  it("mesmo CNPJ em dois emissores da clínica é recusado", async () => {
    expect(await codeOf(() => saveFiscalIssuer(asDb(fixture.admin), clinicId, dr2Id, INPUT))).toBe("invalid");
  });

  it("N-P1: o Administrador escolhe pela clínica ou não emite; o profissional não escolhe", async () => {
    await setProfessionalRoute(asDb(fixture.admin), clinicId, dr2Id, "none");
    let overview = await getFiscalIssuerOverview(asDb(fixture.admin), clinicId);
    expect(overview.professionals.find((p) => p.professionalId === dr2Id)?.route).toBe("none");
    expect(overview.professionals.find((p) => p.professionalId === draId)?.route).toBe("own");
    expect(await codeOf(() => setProfessionalRoute(asDb(draUser), clinicId, dr2Id, "clinic"))).toBe("forbidden");
    await setProfessionalRoute(asDb(fixture.admin), clinicId, dr2Id, "clinic");
    overview = await getFiscalIssuerOverview(asDb(fixture.admin), clinicId);
    expect(overview.professionals.find((p) => p.professionalId === dr2Id)?.route).toBe("clinic");
    // O banco resolve o emissor de cada profissional.
    const clinicIssuer = await getIssuerOf(asDb(fixture.admin), clinicId, null);
    const draIssuer = await getIssuerOf(asDb(fixture.admin), clinicId, draId);
    const resolved = await withDatabase(async (db) =>
      (
        await db.query(`select app.fiscal_issuer_for_professional($1, $2) as dra, app.fiscal_issuer_for_professional($1, $3) as dr2`, [clinicId, draId, dr2Id])
      ).rows[0],
    );
    expect(resolved).toEqual({ dra: draIssuer!.id, dr2: clinicIssuer!.id });
    await setProfessionalRoute(asDb(fixture.admin), clinicId, dr2Id, "none");
    const none = await withDatabase(async (db) => (await db.query(`select app.fiscal_issuer_for_professional($1, $2) as id`, [clinicId, dr2Id])).rows[0].id);
    expect(none).toBeNull();
  });

  it("N-P6: pagador profissional só com login; emissor da clínica é sempre pago pela clínica", async () => {
    const draIssuer = await getIssuerOf(asDb(fixture.admin), clinicId, draId);
    await setIssuerPayer(asDb(fixture.admin), draIssuer!.id, "professional");
    expect((await getFiscalIssuer(asDb(fixture.admin), draIssuer!.id))?.payer).toBe("professional");
    expect(await codeOf(() => setIssuerPayer(asDb(draUser), draIssuer!.id, "clinic"))).toBe("forbidden");
    const clinicIssuer = await getIssuerOf(asDb(fixture.admin), clinicId, null);
    expect(await codeOf(() => setIssuerPayer(asDb(fixture.admin), clinicIssuer!.id, "professional"))).toBe("invalid");
    // Sem login: recusa.
    await adminClient().from("professionals").update({ user_id: null }).eq("id", draId);
    expect(await codeOf(() => setIssuerPayer(asDb(fixture.admin), draIssuer!.id, "professional"))).toBe("invalid");
    await adminClient().from("professionals").update({ user_id: draUser.id }).eq("id", draId);
  });

  it("emissão só liga com tudo pronto; subconta e situação só pelo servidor; chave no Vault", async () => {
    const issuer = await getIssuerOf(asDb(fixture.admin), clinicId, null);
    expect(await codeOf(() => setIssuingEnabled(asDb(fixture.admin), issuer!.id, true))).toBe("invalid");
    const service = adminClient();
    // Usuário comum não chama as funções da plataforma.
    const { error: denied } = await asDb(fixture.admin).rpc("platform_link_fiscal_issuer_account", {
      p_issuer_id: issuer!.id, p_account_id: "acc_x", p_wallet_id: "w", p_api_key: "k", p_webhook_token: "t", p_environment: "sandbox", p_actor: fixture.admin.id,
    });
    expect(denied).not.toBeNull();
    const link = await service.rpc("platform_link_fiscal_issuer_account", {
      p_issuer_id: issuer!.id, p_account_id: `acc_${clinicId.slice(0, 8)}`, p_wallet_id: "wal_1", p_api_key: "$aact_chave_teste", p_webhook_token: "t".repeat(40), p_environment: "sandbox", p_actor: fixture.admin.id,
    });
    expect(link.error).toBeNull();
    expect((await service.rpc("get_fiscal_issuer_api_key", { p_issuer_id: issuer!.id })).data).toBe("$aact_chave_teste");
    const { data: byAccount } = await service.rpc("find_fiscal_issuer_by_account", { p_account_id: `acc_${clinicId.slice(0, 8)}` });
    expect(byAccount?.[0]).toMatchObject({ issuer_id: issuer!.id, clinic_id: clinicId, webhook_token: "t".repeat(40) });
    expect((await asDb(fixture.admin).rpc("get_fiscal_issuer_api_key", { p_issuer_id: issuer!.id })).error).not.toBeNull();

    await service.rpc("platform_set_fiscal_issuer_account_status", { p_issuer_id: issuer!.id, p_status: "approved" });
    await service.rpc("platform_set_fiscal_issuer_fiscal_info", {
      p_issuer_id: issuer!.id, p_ok: true, p_message: null as unknown as string, p_municipal_options: { authenticationType: "CERTIFICATE", supportsCancellation: true },
      p_certificate_sent: true, p_certificate_valid_until: "2031-12-31T00:00:00Z", p_actor: fixture.admin.id,
    });
    // Não optante sem PIS/COFINS: ainda falta.
    expect(await codeOf(() => setIssuingEnabled(asDb(fixture.admin), issuer!.id, true))).toBe("invalid");
    await saveFiscalIssuer(asDb(fixture.admin), clinicId, null, { ...INPUT, pisCofinsTaxStatus: "none" });
    // Dado mudou: configuração volta para pendente até reenviar.
    expect((await getFiscalIssuer(asDb(fixture.admin), issuer!.id))?.fiscalInfoStatus).toBe("pending");
    await service.rpc("platform_set_fiscal_issuer_fiscal_info", {
      p_issuer_id: issuer!.id, p_ok: true, p_message: null as unknown as string, p_municipal_options: null as unknown as object,
      p_certificate_sent: false, p_certificate_valid_until: null as unknown as string, p_actor: fixture.admin.id,
    });
    await setIssuingEnabled(asDb(fixture.admin), issuer!.id, true);
    const on = await getFiscalIssuer(asDb(fixture.admin), issuer!.id);
    expect(on).toMatchObject({ issuingEnabled: true, pisCofinsTaxStatus: "NONE", hasAccount: true, certificateSentAt: expect.any(Date) });
    // CNPJ travado com subconta.
    expect(await codeOf(() => saveFiscalIssuer(asDb(fixture.admin), clinicId, null, { ...INPUT, cnpj: "11.444.777/0001-61" }))).toBe("invalid");
    // Recusa do Asaas desliga.
    await service.rpc("platform_set_fiscal_issuer_account_status", { p_issuer_id: issuer!.id, p_status: "rejected" });
    expect((await getFiscalIssuer(asDb(fixture.admin), issuer!.id))?.issuingEnabled).toBe(false);
  });

  it("código de serviço por emissor; apagar volta o do emissor", async () => {
    const issuer = await getIssuerOf(asDb(draUser), clinicId, draId);
    await setIssuerServiceCode(asDb(draUser), issuer!.id, fixture.ids.consulta, "04.03.01");
    const { data } = await asDb(draUser).from("fiscal_issuer_service_codes").select("service_code").eq("issuer_id", issuer!.id);
    expect(data).toEqual([{ service_code: "04.03.01" }]);
    await setIssuerServiceCode(asDb(draUser), issuer!.id, fixture.ids.consulta, "");
    const { data: after } = await asDb(draUser).from("fiscal_issuer_service_codes").select("service_code").eq("issuer_id", issuer!.id);
    expect(after).toEqual([]);
  });

  it("excluir o emissor apaga a chave e o token do Vault", async () => {
    const issuer = await getIssuerOf(asDb(fixture.admin), clinicId, null);
    const count = () => withDatabase(async (db) => (await db.query(`select count(*)::int as n from vault.secrets where name like $1`, [`asaas_issuer_%${issuer!.id}`])).rows[0].n);
    expect(await count()).toBe(2);
    await adminClient().from("fiscal_issuers").delete().eq("id", issuer!.id);
    expect(await count()).toBe(0);
  });
});
