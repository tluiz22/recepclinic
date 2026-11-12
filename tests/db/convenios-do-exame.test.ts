import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInsurancePlan, setInsurancePlanActive } from "../../src/lib/data/config/insurance";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { examPlanFor, listServicePlans, setServiceCoverage } from "../../src/lib/data/config/serviceInsurance";
import { listServices } from "../../src/lib/data/config/services";
import { adminClient } from "./helpers";
import { asDb, at, codeOf, MON2, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// Convênios de cada exame (CE-1; cliente, 10/nov/2026; docs/implementacao-recepcao-digital.md, 15.5.7):
// "Particular" no serviço e a associação positiva service_insurance_plans, só para exame, mantida por quem
// mantém os convênios, com a trilha.

let f: AgendaFixture;
let unimed: string;

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica do teste dos convênios do exame", "849555300");
  unimed = (await createInsurancePlan(asDb(f.admin), f.clinicId, { name: "Unimed", alternativeNames: [], ansCode: null })).id;
});

afterAll(async () => {
  await f.cleanup();
});

const acceptsPrivate = async (serviceId: string) =>
  (await adminClient().from("services").select("accepts_private").eq("id", serviceId).single()).data!.accepts_private as boolean;

describe("convênios do exame (CE-1)", () => {
  it("exame começa só particular, sem convênio", async () => {
    expect(await acceptsPrivate(f.ids.exame)).toBe(true);
    const { data } = await adminClient().from("service_insurance_plans").select("insurance_plan_id").eq("service_id", f.ids.exame);
    expect(data).toEqual([]);
  });

  it("o Administrador associa o convênio ao exame, com observação, e a trilha registra", async () => {
    const db = f.admin.client;
    expect((await db.from("service_insurance_plans").insert({ clinic_id: f.clinicId, service_id: f.ids.exame, insurance_plan_id: unimed }).select()).error).toBeNull();
    expect((await db.from("service_insurance_plans").update({ note: "Com pedido médico" }).eq("service_id", f.ids.exame).eq("insurance_plan_id", unimed)).error).toBeNull();
    expect((await db.rpc("set_service_accepts_private", { p_clinic_id: f.clinicId, p_service_id: f.ids.exame, p_accepts: false })).error).toBeNull();
    expect(await acceptsPrivate(f.ids.exame)).toBe(false);
    const { data: log } = await adminClient()
      .from("insurance_change_log")
      .select("action, insurance_plan_id, service_id, professional_id, actor_user_id")
      .eq("clinic_id", f.clinicId)
      .eq("service_id", f.ids.exame)
      .order("id");
    expect(log).toEqual([
      { action: "linked", insurance_plan_id: unimed, service_id: f.ids.exame, professional_id: null, actor_user_id: f.admin.id },
      { action: "note_updated", insurance_plan_id: unimed, service_id: f.ids.exame, professional_id: null, actor_user_id: f.admin.id },
    ]);
  });

  it("consulta não tem convênios próprios", async () => {
    const { error } = await f.admin.client.from("service_insurance_plans").insert({ clinic_id: f.clinicId, service_id: f.ids.consulta, insurance_plan_id: unimed });
    expect(error?.code).toBe("23514");
    const rpc = await f.admin.client.rpc("set_service_accepts_private", { p_clinic_id: f.clinicId, p_service_id: f.ids.consulta, p_accepts: false });
    // "Exame não encontrado" (P0002): o PostgREST responde como erro, sem mudar a consulta.
    expect(rpc.error).not.toBeNull();
    expect(await acceptsPrivate(f.ids.consulta)).toBe(true);
  });

  it("a Recepção sem a permissão de convênios não muda nada", async () => {
    const db = f.reception.client;
    expect((await db.from("service_insurance_plans").delete().eq("service_id", f.ids.exame).select()).data ?? []).toEqual([]);
    expect((await db.from("service_insurance_plans").insert({ clinic_id: f.clinicId, service_id: f.ids.turma, insurance_plan_id: unimed })).error).not.toBeNull();
    expect((await db.rpc("set_service_accepts_private", { p_clinic_id: f.clinicId, p_service_id: f.ids.exame, p_accepts: true })).error?.code).toBe("42501");
    // Pela tela do serviço (update direto): o gatilho barra quem pode editar o serviço mas não os convênios.
    await db.from("services").update({ accepts_private: true }).eq("id", f.ids.exame);
    expect(await acceptsPrivate(f.ids.exame)).toBe(false);
  });

  it("com a permissão de convênios, a Recepção muda; sem mudar o Particular, edita o serviço normalmente", async () => {
    await adminClient().from("clinic_members").update({ can_manage_insurance: true }).eq("clinic_id", f.clinicId).eq("user_id", f.reception.id);
    try {
      expect((await f.reception.client.rpc("set_service_accepts_private", { p_clinic_id: f.clinicId, p_service_id: f.ids.exame, p_accepts: true })).error).toBeNull();
      expect(await acceptsPrivate(f.ids.exame)).toBe(true);
    } finally {
      await adminClient().from("clinic_members").update({ can_manage_insurance: false }).eq("clinic_id", f.clinicId).eq("user_id", f.reception.id);
    }
    expect((await f.admin.client.from("services").update({ duration_minutes: 25 }).eq("id", f.ids.exame)).error).toBeNull();
  });

  it("sem o item Convênios na matriz, não associa", async () => {
    const { data: features } = await adminClient().from("clinic_features").select("feature_key").eq("clinic_id", f.clinicId).eq("feature_key", "insurance");
    if (!features?.length) return;
    await adminClient().from("clinic_features").delete().eq("clinic_id", f.clinicId).eq("feature_key", "insurance");
    try {
      const { error } = await adminClient().from("service_insurance_plans").insert({ clinic_id: f.clinicId, service_id: f.ids.turma, insurance_plan_id: unimed });
      expect(error).not.toBeNull();
    } finally {
      await adminClient().from("clinic_features").insert({ clinic_id: f.clinicId, feature_key: "insurance" });
    }
  });

  it("CE-2: a tela grava particular, convênios e observações; exige um dos dois; plano desativado fica", async () => {
    const db = asDb(f.admin);
    const amil = (await createInsurancePlan(db, f.clinicId, { name: "Amil", alternativeNames: [], ansCode: null })).id;
    await setServiceCoverage(db, f.clinicId, f.ids.turma, { acceptsPrivate: false, plans: [{ planId: unimed, note: " Com pedido " }, { planId: amil, note: null }] });
    expect(await listServicePlans(db, f.clinicId, f.ids.turma)).toEqual(
      [{ planId: unimed, note: "Com pedido" }, { planId: amil, note: null }].sort((a, b) => a.planId.localeCompare(b.planId)),
    );
    expect((await listServices(db, f.clinicId)).find((s) => s.id === f.ids.turma)?.acceptsPrivate).toBe(false);

    expect(await codeOf(() => setServiceCoverage(db, f.clinicId, f.ids.turma, { acceptsPrivate: false, plans: [] }))).toBe("invalid");

    // Amil desativado: a ligação fica (keepPlanIds), a Unimed sai, a observação muda.
    await setInsurancePlanActive(db, f.clinicId, amil, false);
    await setServiceCoverage(db, f.clinicId, f.ids.turma, { acceptsPrivate: true, plans: [], keepPlanIds: [amil] });
    expect(await listServicePlans(db, f.clinicId, f.ids.turma)).toEqual([{ planId: amil, note: null }]);
    expect((await listServices(db, f.clinicId)).find((s) => s.id === f.ids.turma)?.acceptsPrivate).toBe(true);

    expect(await codeOf(() => setServiceCoverage(asDb(f.reception), f.clinicId, f.ids.turma, { acceptsPrivate: true, plans: [{ planId: unimed, note: null }] }))).not.toBe("ok");
  });

  it("CE-5: a Marcar grava o exame como particular quando ele não aceita o convênio do paciente; sem particular, recusa", async () => {
    const db = asDb(f.reception);
    const adm = asDb(f.admin);
    const bradesco = (await createInsurancePlan(adm, f.clinicId, { name: "Bradesco", alternativeNames: [], ansCode: null })).id;
    await setServiceCoverage(adm, f.clinicId, f.ids.exame, { acceptsPrivate: true, plans: [{ planId: unimed, note: null }] });
    expect(await examPlanFor(db, f.clinicId, f.ids.exame, unimed)).toEqual({ planId: unimed, asPrivate: false });
    expect(await examPlanFor(db, f.clinicId, f.ids.exame, bradesco)).toEqual({ planId: null, asPrivate: true });
    expect(await examPlanFor(db, f.clinicId, f.ids.exame, null)).toEqual({ planId: null, asPrivate: false });
    // Consulta: segue o convênio do paciente (profissional: só o aviso, MC).
    expect(await examPlanFor(db, f.clinicId, f.ids.consulta, bradesco)).toEqual({ planId: bradesco, asPrivate: false });

    // Paciente Bradesco: o gatilho põe o convênio dele; com asPrivate, o atendimento fica particular.
    expect((await adminClient().from("patients").update({ insurance_plan_id: bradesco }).eq("id", f.ids.p2)).error).toBeNull();
    const { appointment } = await bookAppointment(
      db,
      f.clinicId,
      { patientId: f.ids.p2, serviceId: f.ids.exame, agendaId: f.ids.agendaExams, start: at(MON2, "08:00"), locationId: f.ids.office, channel: "admin", actorId: null, asPrivate: true },
      NOW,
    );
    expect(appointment.insurancePlanId).toBeNull();

    await setServiceCoverage(adm, f.clinicId, f.ids.exame, { acceptsPrivate: false, plans: [{ planId: unimed, note: null }] });
    expect(await codeOf(() => examPlanFor(db, f.clinicId, f.ids.exame, bradesco))).toBe("invalid");
    expect(await codeOf(() => examPlanFor(db, f.clinicId, f.ids.exame, null))).toBe("invalid");
  });
});
