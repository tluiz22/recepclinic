import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, cancelAppointment } from "../../src/lib/data/agenda/appointments";
import { setNewPassword, signIn, verifyEmailLink } from "../../src/lib/data/auth";
import type { DbClient } from "../../src/lib/data/clients";
import { listSelectableClinics } from "../../src/lib/data/clinicChoice";
import { loadClinicContext } from "../../src/lib/data/clinicContext";
import { getDashboardCounts } from "../../src/lib/data/dashboard";
import { recordOutboundMessage } from "../../src/lib/data/whatsapp/messages";
import { addMember, adminClient, anonClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, at, codeOf, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F4.1 — base do painel: escolha da clínica, login por convite e recuperação
// de senha (links do e-mail conferidos no servidor) e números da tela inicial.

let clinicA: string;
let clinicB: string;
let both: TestUser;
let onlyA: TestUser;
let support: TestUser;
const invited: string[] = [];

beforeAll(async () => {
  clinicA = await createClinic("Clínica A (painel)");
  clinicB = await createClinic("Clínica B (painel)");
  [both, onlyA, support] = await Promise.all([createUser("pb-duas"), createUser("pb-uma"), createUser("pb-suporte")]);
  await addMember(clinicA, both.id, ["admin"]);
  await addMember(clinicB, both.id, ["reception", "professional"]);
  await addMember(clinicA, onlyA.id, ["reception"]);
  await makePlatformStaff(support.id);
});

afterAll(async () => {
  await deleteClinics([clinicA, clinicB]);
  await deleteUsers([both, onlyA, support]);
  for (const id of invited) await adminClient().auth.admin.deleteUser(id);
});

describe("escolha da clínica", () => {
  it("membro vê as próprias clínicas, com os papéis; o Suporte vê todas", async () => {
    const mine = await listSelectableClinics(asDb(both), both.id);
    expect(mine.filter((c) => [clinicA, clinicB].includes(c.id)).map((c) => [c.id, c.roles])).toEqual([
      [clinicA, ["admin"]],
      [clinicB, ["reception", "professional"]],
    ]);
    expect((await listSelectableClinics(asDb(onlyA), onlyA.id)).map((c) => c.id)).toEqual([clinicA]);
    const all = await listSelectableClinics(asDb(support), support.id);
    expect(all.map((c) => c.id)).toEqual(expect.arrayContaining([clinicA, clinicB]));
    expect(all.find((c) => c.id === clinicA)?.roles).toEqual([]);
  });

  it("o contexto diz quem pode trocar de clínica", async () => {
    const ctx = async (user: TestUser, preferred: string | null) => {
      const result = await loadClinicContext(asDb(user), user.id, preferred);
      return result.status === "ok" ? result.context.canSwitchClinic : result.status;
    };
    expect(await ctx(both, clinicB)).toBe(true);
    expect(await ctx(onlyA, null)).toBe(false);
    expect(await ctx(support, clinicA)).toBe(true);
    expect(await ctx(support, null)).toBe("choose_clinic");
  });
});

describe("login por convite e recuperação de senha", () => {
  const linkFor = async (type: "invite" | "recovery", email: string) => {
    const { data, error } = await adminClient().auth.admin.generateLink({ type, email });
    if (error) throw error;
    if (type === "invite") invited.push(data.user.id);
    return data.properties.hashed_token;
  };

  it("não há cadastro público", async () => {
    const { error } = await anonClient().auth.signUp({ email: `publico-${randomUUID().slice(0, 8)}@teste.recepclinic.local`, password: "senha-forte-123" });
    expect(error).not.toBeNull();
  });

  it("convite: o link abre a sessão, a pessoa cria a senha e entra com ela", async () => {
    const email = `convite-${randomUUID().slice(0, 8)}@teste.recepclinic.local`;
    const token = await linkFor("invite", email);
    const browser = anonClient() as unknown as DbClient;
    expect(await verifyEmailLink(browser, token, "invite")).toBe(true);
    expect(await codeOf(() => setNewPassword(browser, "curta", "curta"))).toBe("invalid");
    expect(await codeOf(() => setNewPassword(browser, "senha-nova-123", "senha-nova-124"))).toBe("invalid");
    await setNewPassword(browser, "senha-nova-123", "senha-nova-123");
    expect(await signIn(anonClient() as unknown as DbClient, email, "senha-nova-123")).toBe(true);
    // O link já foi usado.
    expect(await verifyEmailLink(anonClient() as unknown as DbClient, token, "invite")).toBe(false);
  });

  it("recuperação: senha nova vale, a antiga não; link inválido não abre sessão", async () => {
    const email = `recupera-${randomUUID().slice(0, 8)}@teste.recepclinic.local`;
    const { data } = await adminClient().auth.admin.createUser({ email, password: "senha-antiga-123", email_confirm: true });
    invited.push(data.user!.id);
    const token = await linkFor("recovery", email);
    const browser = anonClient() as unknown as DbClient;
    expect(await verifyEmailLink(browser, "nao-existe", "recovery")).toBe(false);
    expect(await verifyEmailLink(browser, token, "recovery")).toBe(true);
    await setNewPassword(browser, "outra-senha-456", "outra-senha-456");
    expect(await signIn(anonClient() as unknown as DbClient, email, "outra-senha-456")).toBe(true);
    expect(await signIn(anonClient() as unknown as DbClient, email, "senha-antiga-123")).toBe(false);
  });
});

describe("tela inicial", () => {
  let fixture: AgendaFixture;
  afterAll(async () => fixture?.cleanup());

  it("conta os atendimentos de hoje por tipo, o comparecimento a registrar e os lembretes sem resposta", async () => {
    fixture = await setupAgendaClinic("Clínica do teste da tela inicial", "849777600");
    const { clinicId, reception, ids } = fixture;
    const book = async (patient: string, service: string, agenda: string, start: Date) =>
      (await bookAppointment(asDb(reception), clinicId, { patientId: patient, serviceId: service, agendaId: agenda, start, channel: "admin", actorId: reception.id }, NOW))
        .appointment.id;
    const c1 = await book(ids.p1, ids.consulta, ids.agendaDra, at(MON1, "08:00"));
    await book(ids.p2, ids.exame, ids.agendaExams, at(MON1, "08:00"));
    const canceled = await book(ids.p3, ids.consulta, ids.agendaDra2, at(MON1, "08:00"));
    await cancelAppointment(asDb(reception), clinicId, canceled, { channel: "admin", actorId: reception.id }, NOW);
    await recordOutboundMessage(asDb(reception), clinicId, { phone: "+5584977760099", appointmentId: c1, messageType: "appointment_reminder", status: "sent" }, at(MON1, "07:00"));

    expect(await getDashboardCounts(asDb(reception), clinicId, "America/Fortaleza", at(MON1, "12:00"))).toEqual({
      consultationsToday: 1,
      examsToday: 1,
      pendingAttendance: 2,
      unansweredReminders: 1,
    });
    await adminClient().from("appointments").update({ reminder_response: "confirmed", reminder_response_at: at(MON1, "07:30").toISOString() }).eq("id", c1);
    expect((await getDashboardCounts(asDb(reception), clinicId, "America/Fortaleza", at(MON1, "12:00"))).unansweredReminders).toBe(0);
  });
});
