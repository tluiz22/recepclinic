import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listBillingAudit } from "../../src/lib/data/billing";
import type { DbClient } from "../../src/lib/data/clients";
import { getPublicClinicBrand, isClinicSuspended } from "../../src/lib/data/config/brand";
import { activeSuspensionReasons, listClinicSuspensions, releaseClinicSuspension, suspendClinic } from "../../src/lib/data/suspension";
import { adminClient, clinicServiceClient, createUser, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F12.3 — Suspensão da clínica por motivos (decisões 11.1, 11.4 e 11.12, item
// 23 do planejamento-faturamento-saas.md; cliente, 02/nov/2026: inadimplência
// só com as cobranças). Só o Suporte suspende e libera; a situação anterior
// volta quando o último motivo sai; "suspensa" não entra nem sai por fora das
// funções; quem é da clínica lê só os motivos.
let fixture: AgendaFixture;
let clinicId: string;
let support: TestUser;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste da suspensão", "+55619866002");
  clinicId = fixture.clinicId;
  support = await createUser("suspensao-suporte");
  await makePlatformStaff(support.id);
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteUsers([support]);
});

const status = async () => (await adminClient().from("clinics").select("status, status_before_suspension").eq("id", clinicId).single()).data!;
const activeIds = async () => (await listClinicSuspensions(asDb(support), clinicId)).filter((s) => !s.releasedAt);

describe("Suspensão da clínica (F12.3)", () => {
  it("só o Suporte suspende; texto e motivo obrigatórios; inadimplência ainda não", async () => {
    expect(await codeOf(() => suspendClinic(asDb(fixture.admin), clinicId, { reason: "administrative", note: "teste" }))).toBe("forbidden");
    expect(await codeOf(() => suspendClinic(asDb(support), clinicId, { reason: "administrative", note: "x" }))).toBe("invalid");
    expect(await codeOf(() => suspendClinic(asDb(support), clinicId, { reason: "non_payment", note: "atraso" }))).toBe("invalid");
    const { error } = await support.client.rpc("suspend_clinic", { p_clinic_id: clinicId, p_reason: "non_payment", p_note: "atraso", p_no_app_confirmed: false });
    expect(error?.hint).toBe("suspension_non_payment_unavailable");
    expect((await status()).status).toBe("active");
  });

  it("sem o app WhatsApp Business, exige a confirmação a mais", async () => {
    await adminClient()
      .from("whatsapp_connections")
      .insert({ clinic_id: clinicId, phone_number_id: `pn-suspensao-${Date.now()}`, waba_id: "waba", status: "connected", coexistence: false });
    expect(await codeOf(() => suspendClinic(asDb(support), clinicId, { reason: "administrative", note: "Pedido da clínica." }))).toBe("invalid");
    expect((await status()).status).toBe("active");
  });

  it("suspende, guarda a situação anterior e registra na trilha", async () => {
    await suspendClinic(asDb(support), clinicId, { reason: "administrative", note: "Pedido da clínica.", noAppConfirmed: true });
    expect(await status()).toEqual({ status: "suspended", status_before_suspension: "active" });
    const [entry] = await listBillingAudit(asDb(support), clinicId);
    expect(entry).toMatchObject({ action: "clinic_suspended", actorKind: "support" });
    // O mesmo motivo de novo é recusado; outro motivo se soma.
    expect(await codeOf(() => suspendClinic(asDb(support), clinicId, { reason: "administrative", note: "De novo.", noAppConfirmed: true }))).toBe("invalid");
    await suspendClinic(asDb(support), clinicId, { reason: "contract_ended", note: "Contrato encerrado.", noAppConfirmed: true });
    expect(await activeIds()).toHaveLength(2);
  });

  it("quem é da clínica lê só os motivos; a tabela é só do Suporte", async () => {
    expect(await activeSuspensionReasons(asDb(fixture.reception), clinicId)).toEqual(["administrative", "contract_ended"]);
    expect((await fixture.admin.client.from("clinic_suspensions").select("id").eq("clinic_id", clinicId)).data).toEqual([]);
    const outsider = await createUser("suspensao-fora");
    expect(await activeSuspensionReasons(asDb(outsider), clinicId)).toEqual([]);
    await deleteUsers([outsider]);
  });

  it("a situação suspensa não muda por fora dos motivos, nem pelo Suporte", async () => {
    const { error } = await support.client.from("clinics").update({ status: "active" }).eq("id", clinicId);
    expect(error?.hint).toBe("clinic_suspension_by_reason");
    expect((await status()).status).toBe("suspended");
  });

  it("páginas públicas e rotas sabem que está suspensa", async () => {
    const bot = clinicServiceClient(clinicId) as unknown as DbClient;
    expect(await isClinicSuspended(bot, clinicId)).toBe(true);
    expect((await getPublicClinicBrand(bot, clinicId)).suspended).toBe(true);
  });

  it("liberar exige texto e só o Suporte; com outro motivo ativo, segue suspensa", async () => {
    const [first] = await activeIds();
    expect(await codeOf(() => releaseClinicSuspension(asDb(fixture.admin), first.id, "Regularizado."))).toBe("forbidden");
    expect(await codeOf(() => releaseClinicSuspension(asDb(support), first.id, ""))).toBe("invalid");
    await releaseClinicSuspension(asDb(support), first.id, "Regularizado.");
    expect((await status()).status).toBe("suspended");
    expect(await codeOf(() => releaseClinicSuspension(asDb(support), first.id, "De novo."))).toBe("invalid");
  });

  it("sem motivo ativo, volta à situação de antes (também em implantação)", async () => {
    const [last] = await activeIds();
    await releaseClinicSuspension(asDb(support), last.id, "Novo contrato assinado.");
    expect(await status()).toEqual({ status: "active", status_before_suspension: null });
    expect((await listBillingAudit(asDb(support), clinicId))[0]).toMatchObject({ action: "suspension_released" });
    expect(await isClinicSuspended(clinicServiceClient(clinicId) as unknown as DbClient, clinicId)).toBe(false);

    await adminClient().from("clinics").update({ status: "onboarding" }).eq("id", clinicId);
    await suspendClinic(asDb(support), clinicId, { reason: "administrative", note: "Pausa na implantação.", noAppConfirmed: true });
    expect(await status()).toEqual({ status: "suspended", status_before_suspension: "onboarding" });
    await releaseClinicSuspension(asDb(support), (await activeIds())[0].id, "Retomada.");
    expect((await status()).status).toBe("onboarding");
  });
});
