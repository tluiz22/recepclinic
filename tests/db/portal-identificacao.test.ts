import type { AstroCookies } from "astro";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import {
  activeHold,
  ensureSession,
  forgetPhone,
  hitLimit,
  holdSlot,
  pendingCode,
  readSession,
  releaseHold,
  sendCode,
  verifyCode,
  type PortalSession,
} from "../../src/lib/data/portal/identity";
import { loadPortal, professionalSlots, type PortalProfessional } from "../../src/lib/data/portal/portal";
import { CODE_MAX_ATTEMPTS } from "../../src/lib/portalIdentity";
import { adminClient, clinicServiceClient, createClinic, createUser, addMember, deleteClinics, deleteUsers, type TestUser } from "./helpers";
import { asDb, at, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F2b da recepção digital: sessão, código pelo WhatsApp, limites com bloqueio progressivo e a reserva do horário.

const TZ = "America/Fortaleza";
let fixture: AgendaFixture;
let service: DbClient;
let otherClinic: string;
let outsider: TestUser;
let dra: PortalProfessional;

/** Cookies em memória (o que o Astro faz na página). */
function jar(): AstroCookies {
  const values = new Map<string, string>();
  return {
    get: (name: string) => (values.has(name) ? { value: values.get(name)! } : undefined),
    set: (name: string, value: string) => void values.set(name, value),
  } as unknown as AstroCookies;
}

/** Sessão com o celular comprovado pelo código. */
async function verified(phone: string): Promise<PortalSession> {
  const cookies = jar();
  const session = await ensureSession(service, fixture.clinicId, cookies, { ip: "200.1.2", secure: false });
  const sent = await sendCode(service, fixture.clinicId, session, phone, { ip: "200.1.2", sender: null, devMode: true });
  if (sent.status !== "sent" || !sent.devCode) throw new Error(sent.status);
  const result = await verifyCode(service, fixture.clinicId, session, sent.devCode);
  if (result.status !== "ok") throw new Error(result.status);
  return (await readSession(service, fixture.clinicId, cookies))!;
}

const slotAt = (time: string) => ({
  agendaId: dra.agendaId,
  serviceId: dra.consultations[0].serviceId,
  locationId: dra.locations[0].id,
  start: at(MON1, time),
  end: new Date(at(MON1, time).getTime() + 30 * 60_000),
});

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste da identificação", "849222800");
  service = clinicServiceClient(fixture.clinicId) as unknown as DbClient;
  otherClinic = await createClinic("Outra clínica (identificação)");
  outsider = await createUser("portal-de-fora");
  await addMember(otherClinic, outsider.id, ["reception"]);
  const portal = await loadPortal(service, fixture.clinicId, "x");
  if (portal.status !== "open") throw new Error("portal indisponível");
  dra = portal.professionals.find((p) => p.name === "Dra. Agenda")!;
});

afterAll(async () => {
  await fixture?.cleanup();
  await deleteClinics([otherClinic]);
  await deleteUsers([outsider]);
});

describe("limites de uso", () => {
  const rule = { action: "teste", limit: 2, windowSeconds: 600 } as const;

  it("passa do limite: bloqueio de 15 min, depois 1 h; a equipe libera", async () => {
    const key = `phone:+55849${Date.now()}`;
    expect(await hitLimit(service, fixture.clinicId, key, rule)).toBeNull();
    expect(await hitLimit(service, fixture.clinicId, key, rule)).toBeNull();
    const first = await hitLimit(service, fixture.clinicId, key, rule);
    expect(first).not.toBeNull();
    expect(first!.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(first!.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000 + 5_000);
    // Bloqueado: continua recusando sem contar mais.
    expect(await hitLimit(service, fixture.clinicId, key, rule)).toEqual(first);

    // A recepção libera; quem é de outra clínica não.
    const { data: block } = await adminClient().from("portal_blocks").select("id").eq("key", key).single();
    expect((await outsider.client.rpc("portal_release_block", { p_block_id: block!.id })).error?.code).toBe("42501");
    expect((await fixture.reception.client.rpc("portal_release_block", { p_block_id: block!.id })).error).toBeNull();
    // A contagem recomeçou; passa de novo do limite no mesmo dia: 1 hora.
    expect(await hitLimit(service, fixture.clinicId, key, rule)).toBeNull();
    expect(await hitLimit(service, fixture.clinicId, key, rule)).toBeNull();
    const second = await hitLimit(service, fixture.clinicId, key, rule);
    expect(second!.getTime() - Date.now()).toBeGreaterThan(59 * 60_000);
  });

  it("depois do bloqueio, a contagem recomeça", async () => {
    const key = `ip:reinicio-${Date.now()}`;
    for (let i = 0; i < 2; i++) expect(await hitLimit(service, fixture.clinicId, key, rule)).toBeNull();
    expect(await hitLimit(service, fixture.clinicId, key, rule)).not.toBeNull();
    // O bloqueio acaba (vencido): o próximo uso passa.
    await adminClient().from("portal_blocks").update({ blocked_until: new Date(Date.now() - 1000).toISOString() }).eq("key", key);
    expect(await hitLimit(service, fixture.clinicId, key, rule)).toBeNull();
  });

  it("a credencial de uma clínica não conta em outra", async () => {
    const { error } = await service.rpc("portal_rate_hit", { p_clinic_id: otherClinic, p_key: "ip:1", p_action: "x", p_limit: 1, p_window_seconds: 60 });
    expect(error?.code).toBe("42501");
  });
});

describe("código pelo WhatsApp", () => {
  it("sem o número do RecepClinic, não manda (fora do computador local)", async () => {
    const session = await ensureSession(service, fixture.clinicId, jar(), { ip: "200.1.3", secure: false });
    expect((await sendCode(service, fixture.clinicId, session, "+5584999990001", { ip: "200.1.3", sender: null })).status).toBe("unavailable");
  });

  it("errado conta tentativa; reenvio só depois de 60 s; certo comprova o celular", async () => {
    const cookies = jar();
    const session = await ensureSession(service, fixture.clinicId, cookies, { ip: "200.1.4", secure: false });
    const sent = await sendCode(service, fixture.clinicId, session, "+5584999990002", { ip: "200.1.4", sender: null, devMode: true });
    expect(sent.status).toBe("sent");
    const code = sent.status === "sent" ? sent.devCode! : "";
    expect((await sendCode(service, fixture.clinicId, session, "+5584999990002", { ip: "200.1.4", sender: null, devMode: true })).status).toBe("wait");
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await verifyCode(service, fixture.clinicId, session, wrong)).toEqual({ status: "wrong", attemptsLeft: CODE_MAX_ATTEMPTS - 1 });
    // O banco guarda só o hash.
    const { data } = await adminClient().from("portal_codes").select("code_hash").eq("session_id", session.id).single();
    expect(data!.code_hash).not.toContain(code);
    expect(await verifyCode(service, fixture.clinicId, session, code)).toEqual({ status: "ok", phone: "+5584999990002" });
    expect(await readSession(service, fixture.clinicId, cookies)).toMatchObject({ phone: "+5584999990002", verified: true });
    expect(await pendingCode(service, fixture.clinicId, session.id)).toBeNull();
  });

  it("cinco erros: o código deixa de valer", async () => {
    const session = await ensureSession(service, fixture.clinicId, jar(), { ip: "200.1.5", secure: false });
    const sent = await sendCode(service, fixture.clinicId, session, "+5584999990003", { ip: "200.1.5", sender: null, devMode: true });
    const code = sent.status === "sent" ? sent.devCode! : "";
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 1; i < CODE_MAX_ATTEMPTS; i++) expect((await verifyCode(service, fixture.clinicId, session, wrong)).status).toBe("wrong");
    expect((await verifyCode(service, fixture.clinicId, session, wrong)).status).toBe("exhausted");
    expect((await verifyCode(service, fixture.clinicId, session, code)).status).toBe("exhausted");
  });

  it("tentativas ao mesmo tempo não passam do limite de 5", async () => {
    const session = await ensureSession(service, fixture.clinicId, jar(), { ip: "200.1.6", secure: false });
    const sent = await sendCode(service, fixture.clinicId, session, "+5584999990005", { ip: "200.1.6", sender: null, devMode: true });
    const code = sent.status === "sent" ? sent.devCode! : "";
    const wrong = (n: number) => String((Number(code) + n) % 1_000_000).padStart(6, "0");
    await Promise.all(Array.from({ length: 12 }, (_, i) => verifyCode(service, fixture.clinicId, session, wrong(i + 1))));
    const { data } = await adminClient().from("portal_codes").select("attempts").eq("session_id", session.id).single();
    expect(data!.attempts).toBe(CODE_MAX_ATTEMPTS);
    expect((await verifyCode(service, fixture.clinicId, session, code)).status).toBe("exhausted");
  });

  it("três códigos por celular em uma hora; o quarto fica bloqueado", async () => {
    const phone = "+5584999990004";
    for (let i = 0; i < 3; i++) {
      const session = await ensureSession(service, fixture.clinicId, jar(), { ip: `200.2.${i}`, secure: false });
      expect((await sendCode(service, fixture.clinicId, session, phone, { ip: `200.2.${i}`, sender: null, devMode: true })).status).toBe("sent");
    }
    const session = await ensureSession(service, fixture.clinicId, jar(), { ip: "200.2.9", secure: false });
    expect((await sendCode(service, fixture.clinicId, session, phone, { ip: "200.2.9", sender: null, devMode: true })).status).toBe("blocked");
  });
});

describe("reserva do horário", () => {
  it("sem o celular comprovado, não reserva", async () => {
    const session = await ensureSession(service, fixture.clinicId, jar(), { ip: "200.3.1", secure: false });
    expect((await holdSlot(service, fixture.clinicId, session.id, slotAt("08:00"))).status).toBe("session");
  });

  it("reservado por um paciente: some para os outros e não pode ser reservado de novo", async () => {
    const ana = await verified("+5584999990010");
    const bia = await verified("+5584999990011");
    const held = await holdSlot(service, fixture.clinicId, ana.id, slotAt("08:00"));
    expect(held.status).toBe("ok");
    const consulta = dra.consultations[0].serviceId;
    const times = async (sessionId: string | null) => (await professionalSlots(service, fixture.clinicId, dra, consulta, MON1, TZ, NOW, sessionId)).map((s) => s.time);
    expect(await times(bia.id)).not.toContain("08:00");
    expect(await times(ana.id)).toContain("08:00");
    expect((await holdSlot(service, fixture.clinicId, bia.id, slotAt("08:00"))).status).toBe("taken");
    // Período que encosta em parte também está ocupado.
    expect((await holdSlot(service, fixture.clinicId, bia.id, { ...slotAt("08:00"), start: at(MON1, "08:15"), end: at(MON1, "08:45") })).status).toBe("taken");

    // A nova reserva de Ana solta a anterior; o Voltar solta a atual.
    expect((await holdSlot(service, fixture.clinicId, ana.id, slotAt("09:00"))).status).toBe("ok");
    expect(await times(bia.id)).toContain("08:00");
    await releaseHold(service, fixture.clinicId, ana.id);
    expect(await times(bia.id)).toContain("09:00");
    if (held.status === "ok") expect(await activeHold(service, fixture.clinicId, ana.id, held.holdId)).toBeNull();
  });

  it("o mesmo horário de novo (recarregou a página) devolve a mesma reserva; a que falha não solta a atual", async () => {
    const fabi = await verified("+5584999990015");
    const gil = await verified("+5584999990016");
    const first = await holdSlot(service, fixture.clinicId, fabi.id, slotAt("10:30"));
    const again = await holdSlot(service, fixture.clinicId, fabi.id, slotAt("10:30"));
    expect(again).toEqual(first);
    const { count } = await adminClient().from("slot_holds").select("id", { count: "exact", head: true }).eq("session_id", fabi.id);
    expect(count).toBe(1);
    // Gil segura 11:30; Fabi tenta 11:30 (ocupado) e continua com 10:30.
    expect((await holdSlot(service, fixture.clinicId, gil.id, slotAt("11:30"))).status).toBe("ok");
    expect((await holdSlot(service, fixture.clinicId, fabi.id, slotAt("11:30"))).status).toBe("taken");
    if (first.status === "ok") expect(await activeHold(service, fixture.clinicId, fabi.id, first.holdId)).not.toBeNull();
    await releaseHold(service, fixture.clinicId, fabi.id);
    await releaseHold(service, fixture.clinicId, gil.id);
  });

  it("horário já marcado (pela recepção ou pelo bot) não é reservado", async () => {
    await bookAppointment(
      asDb(fixture.admin),
      fixture.clinicId,
      { patientId: fixture.ids.p1, serviceId: dra.consultations[0].serviceId, agendaId: dra.agendaId, locationId: dra.locations[0].id, start: at(MON1, "10:00"), channel: "admin", actorId: fixture.admin.id },
      NOW,
    );
    const cris = await verified("+5584999990012");
    expect((await holdSlot(service, fixture.clinicId, cris.id, slotAt("10:00"))).status).toBe("taken");
  });

  it("cinco reservas por celular em 24 h", async () => {
    const dani = await verified("+5584999990013");
    for (const time of ["08:30", "09:30", "10:30", "11:00", "11:30"]) {
      expect((await holdSlot(service, fixture.clinicId, dani.id, slotAt(time))).status).toBe("ok");
    }
    expect((await holdSlot(service, fixture.clinicId, dani.id, slotAt("08:30"))).status).toBe("limit");
  });

  it("Trocar número: a sessão perde o celular e a reserva", async () => {
    const eva = await verified("+5584999990014");
    const held = await holdSlot(service, fixture.clinicId, eva.id, slotAt("11:00"));
    await forgetPhone(service, fixture.clinicId, eva.id);
    if (held.status === "ok") expect(await activeHold(service, fixture.clinicId, eva.id, held.holdId)).toBeNull();
    expect((await holdSlot(service, fixture.clinicId, eva.id, slotAt("11:00"))).status).toBe("session");
  });
});
