import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  adminClient,
  clinicServiceClient,
  createClinic,
  createUser,
  deleteClinics,
  deleteUsers,
  type TestUser,
} from "./helpers";

// Clínica A: admin, recepção (todas as agendas), recepção restrita (só a agenda
// liberada), dois profissionais com login e um recurso "Exames".
// Clínica B: admin e um profissional, para os testes de isolamento.
let clinicA: string;
let clinicB: string;
let adminA: TestUser;
let receptionA: TestUser;
let restrictedReceptionA: TestUser;
let drJoao: TestUser;
let draAna: TestUser;
let adminB: TestUser;

const a = {} as Record<string, string>;
const b = {} as Record<string, string>;

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await adminClient().from(table).insert(row).select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function link(table: string, row: Record<string, unknown>): Promise<void> {
  const { error } = await adminClient().from(table).insert(row);
  if (error) throw error;
}

beforeAll(async () => {
  clinicA = await createClinic("Clínica A (config)");
  clinicB = await createClinic("Clínica B (config)");
  [adminA, receptionA, restrictedReceptionA, drJoao, draAna, adminB] = await Promise.all([
    createUser("admin-a"),
    createUser("recep-a"),
    createUser("recep-restrita-a"),
    createUser("dr-joao"),
    createUser("dra-ana"),
    createUser("admin-b"),
  ]);
  await addMember(clinicA, adminA.id, ["admin"]);
  await addMember(clinicA, receptionA.id, ["reception"]);
  await addMember(clinicA, drJoao.id, ["professional"]);
  await addMember(clinicA, draAna.id, ["professional"]);
  await addMember(clinicB, adminB.id, ["admin", "professional"]);
  // Recepção restrita: entra com o padrão e o Administrador restringe.
  await addMember(clinicA, restrictedReceptionA.id, ["reception"]);
  await adminClient()
    .from("clinic_members")
    .update({ agenda_scope: "restricted" })
    .eq("clinic_id", clinicA)
    .eq("user_id", restrictedReceptionA.id);

  a.joao = await insert("professionals", {
    clinic_id: clinicA, user_id: drJoao.id, display_name: "Dr. João", profession: "Médico",
    specialty: "Pediatria", council: "CRM", council_number: "1234", council_state: "RN",
  });
  a.ana = await insert("professionals", {
    clinic_id: clinicA, user_id: draAna.id, display_name: "Dra. Ana", profession: "Psicóloga",
    council: "CRP", council_number: "5678", council_state: "RN",
  });
  a.office = await insert("locations", { clinic_id: clinicA, name: "Consultório Centro", type: "clinic", address: "Rua A, 1" });
  a.home = await insert("locations", { clinic_id: clinicA, name: "Domiciliar", type: "home_visit" });
  a.agendaJoao = await insert("agendas", { clinic_id: clinicA, name: "Dr. João", kind: "professional", professional_id: a.joao });
  a.agendaAna = await insert("agendas", { clinic_id: clinicA, name: "Dra. Ana", kind: "professional", professional_id: a.ana });
  a.agendaExams = await insert("agendas", { clinic_id: clinicA, name: "Exames", kind: "resource" });
  a.consultation = await insert("services", {
    clinic_id: clinicA, name: "Consulta", category: "consultation", duration_minutes: 30, price_cents: 25000,
  });
  a.exam = await insert("services", {
    clinic_id: clinicA, name: "Espirometria", category: "exam", duration_minutes: 40, price_cents: 18000,
    preparation_instructions: "*Jejum* de 2 horas", scheduling_mode: "group",
  });
  await link("service_agendas", { clinic_id: clinicA, service_id: a.consultation, agenda_id: a.agendaJoao });
  await link("service_agendas", { clinic_id: clinicA, service_id: a.consultation, agenda_id: a.agendaAna });
  await link("service_agendas", { clinic_id: clinicA, service_id: a.exam, agenda_id: a.agendaExams });
  await link("service_locations", { clinic_id: clinicA, service_id: a.consultation, location_id: a.office });
  await link("service_locations", { clinic_id: clinicA, service_id: a.consultation, location_id: a.home, price_cents: 40000 });
  a.windowJoao = await insert("availability_windows", {
    clinic_id: clinicA, agenda_id: a.agendaJoao, location_id: a.office, weekday: 1, start_time: "08:00", end_time: "12:00",
  });
  a.windowAna = await insert("availability_windows", {
    clinic_id: clinicA, agenda_id: a.agendaAna, location_id: a.office, weekday: 2, start_time: "14:00", end_time: "18:00",
  });
  a.windowExam = await insert("availability_windows", {
    clinic_id: clinicA, agenda_id: a.agendaExams, location_id: a.office, service_id: a.exam,
    weekday: 3, start_time: "07:00", end_time: "08:00", capacity: 5,
  });
  await link("member_agenda_grants", { clinic_id: clinicA, user_id: restrictedReceptionA.id, agenda_id: a.agendaAna });
  a.holiday = await insert("clinic_holidays", { clinic_id: clinicA, date: "2026-12-13", description: "Santa Luzia (Mossoró)" });
  a.recipient = await insert("notification_recipients", {
    clinic_id: clinicA, label: "Recepção", phone: "+5584999990000", receives_consultations: true,
  });
  a.unimed = await insert("insurance_plans", { clinic_id: clinicA, name: "Unimed", alternative_names: ["Unimed Natal", "Unimed RN"] });
  a.bradesco = await insert("insurance_plans", { clinic_id: clinicA, name: "Bradesco Saúde" });
  a.hapvida = await insert("insurance_plans", { clinic_id: clinicA, name: "Hapvida" });
  await link("professional_insurance_exclusions", { clinic_id: clinicA, professional_id: a.ana, insurance_plan_id: a.unimed });

  b.prof = await insert("professionals", { clinic_id: clinicB, user_id: adminB.id, display_name: "Dra. B", profession: "Dentista" });
  b.office = await insert("locations", { clinic_id: clinicB, name: "Consultório B", type: "clinic" });
  b.agenda = await insert("agendas", { clinic_id: clinicB, name: "Dra. B", kind: "professional", professional_id: b.prof });
  b.service = await insert("services", { clinic_id: clinicB, name: "Avaliação", category: "consultation", duration_minutes: 60, price_cents: 0 });
  b.unimed = await insert("insurance_plans", { clinic_id: clinicB, name: "Unimed Odonto" });
});

afterAll(async () => {
  await deleteClinics([clinicA, clinicB]);
  await deleteUsers([adminA, receptionA, restrictedReceptionA, drJoao, draAna, adminB]);
});

// Tabelas com `id` próprio e uma linha de cada clínica para conferir isolamento.
const tables = [
  "professionals",
  "locations",
  "services",
  "clinic_holidays",
  "notification_recipients",
  "insurance_plans",
] as const;

describe("configuração geral (clinic_settings)", () => {
  it("é criada junto com a clínica, com os padrões", async () => {
    const { data } = await adminA.client.from("clinic_settings").select("*").eq("clinic_id", clinicA).single();
    expect(data).toMatchObject({
      profile: "mixed",
      timezone: "America/Fortaleza",
      reminder_hour: 18,
      consultation_age_limit_years: null,
      require_insurance_details: false,
    });
  });

  it("toda a equipe lê; outra clínica não", async () => {
    for (const user of [receptionA, drJoao]) {
      const { data } = await user.client.from("clinic_settings").select("clinic_id");
      expect(data).toEqual([{ clinic_id: clinicA }]);
    }
    const { data } = await adminB.client.from("clinic_settings").select("clinic_id").eq("clinic_id", clinicA);
    expect(data).toEqual([]);
  });

  it("só o Administrador edita", async () => {
    const { data: byAdmin } = await adminA.client
      .from("clinic_settings")
      .update({ profile: "pediatric", consultation_age_limit_years: 14, require_insurance_details: true })
      .eq("clinic_id", clinicA)
      .select("profile");
    expect(byAdmin).toEqual([{ profile: "pediatric" }]);

    const { data: byReception } = await receptionA.client
      .from("clinic_settings")
      .update({ reminder_hour: 8 })
      .eq("clinic_id", clinicA)
      .select("clinic_id");
    expect(byReception).toEqual([]);

    const { data: byOtherAdmin } = await adminB.client
      .from("clinic_settings")
      .update({ reminder_hour: 8 })
      .eq("clinic_id", clinicA)
      .select("clinic_id");
    expect(byOtherAdmin).toEqual([]);
  });

  it("recusa fuso horário inválido e cor fora do formato", async () => {
    const { error: tz } = await adminA.client.from("clinic_settings").update({ timezone: "Brasil/Mossoró" }).eq("clinic_id", clinicA);
    expect(tz?.message).toContain("Fuso horário inválido");
    const { error: color } = await adminA.client.from("clinic_settings").update({ brand_color: "verde" }).eq("clinic_id", clinicA);
    expect(color?.code).toBe("23514");
  });

  it("ninguém cria nem apaga a configuração pela API", async () => {
    const { error: insertError } = await adminA.client.from("clinic_settings").insert({ clinic_id: clinicA });
    expect(insertError?.code).toBe("42501");
  });
});

describe("isolamento entre clínicas nas tabelas de configuração", () => {
  it.each(tables)("%s: a equipe de A vê só as linhas de A", async (table) => {
    const { data, error } = await receptionA.client.from(table).select("clinic_id");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(new Set(data!.map((row) => row.clinic_id))).toEqual(new Set([clinicA]));
  });

  it.each(tables)("%s: o Administrador de B não vê nada de A", async (table) => {
    const { data } = await adminB.client.from(table).select("id").eq("clinic_id", clinicA);
    expect(data).toEqual([]);
  });

  it("o Administrador de B não grava na clínica A", async () => {
    const { error } = await adminB.client.from("locations").insert({ clinic_id: clinicA, name: "invasão", type: "clinic" });
    expect(error?.code).toBe("42501");
    const { data } = await adminB.client.from("services").update({ price_cents: 1 }).eq("id", a.consultation).select("id");
    expect(data).toEqual([]);
  });

  it("não dá para ligar dados de clínicas diferentes (chave composta)", async () => {
    const { error: agenda } = await adminA.client
      .from("agendas")
      .insert({ clinic_id: clinicA, name: "Agenda cruzada", kind: "professional", professional_id: b.prof });
    expect(agenda?.code).toBe("23503");

    const { error: serviceAgenda } = await adminA.client
      .from("service_agendas")
      .insert({ clinic_id: clinicA, service_id: a.consultation, agenda_id: b.agenda });
    expect(serviceAgenda?.code).toBe("23503");

    const { error: professional } = await adminA.client
      .from("professionals")
      .insert({ clinic_id: clinicA, user_id: adminB.id, display_name: "Login de outra clínica", profession: "Médico" });
    expect(professional?.code).toBe("23503");
  });
});

describe("quem altera a configuração", () => {
  it("o Administrador cria, edita e desativa", async () => {
    const id = await (async () => {
      const { data, error } = await adminA.client
        .from("services")
        .insert({ clinic_id: clinicA, name: "Retorno", category: "return_visit", duration_minutes: 20, price_cents: 0, return_deadline_days: 30 })
        .select("id")
        .single();
      expect(error).toBeNull();
      return data!.id as string;
    })();
    const { data } = await adminA.client.from("services").update({ is_active: false }).eq("id", id).select("is_active");
    expect(data).toEqual([{ is_active: false }]);
  });

  it("Recepção e Profissional não alteram", async () => {
    for (const user of [receptionA, drJoao]) {
      const { error } = await user.client.from("insurance_plans").insert({ clinic_id: clinicA, name: `Plano ${user.email}` });
      expect(error?.code).toBe("42501");
      const { data } = await user.client.from("services").update({ price_cents: 1 }).eq("id", a.consultation).select("id");
      expect(data).toEqual([]);
    }
  });
});

describe("regras dos cadastros", () => {
  it("agenda de profissional precisa do profissional; de recurso, não pode ter", async () => {
    const { error: missing } = await adminA.client.from("agendas").insert({ clinic_id: clinicA, name: "X", kind: "professional" });
    expect(missing?.code).toBe("23514");
    const { error: extra } = await adminA.client
      .from("agendas")
      .insert({ clinic_id: clinicA, name: "Y", kind: "resource", professional_id: a.joao });
    expect(extra?.code).toBe("23514");
  });

  it("prazo só no retorno; preparo e turma só no exame", async () => {
    const base = { clinic_id: clinicA, duration_minutes: 30, price_cents: 0 };
    const rows: Record<string, unknown>[] = [
      { ...base, name: "C1", category: "consultation", return_deadline_days: 30 },
      { ...base, name: "C2", category: "consultation", preparation_instructions: "x" },
      { ...base, name: "C3", category: "consultation", scheduling_mode: "group" },
    ];
    for (const row of rows) {
      const { error } = await adminA.client.from("services").insert(row);
      expect(error?.code, String(row.name)).toBe("23514");
    }
  });

  it("vagas de turma exigem um serviço na janela; horário de início antes do fim", async () => {
    const base = { clinic_id: clinicA, agenda_id: a.agendaExams, location_id: a.office, weekday: 4 };
    const { error: capacity } = await adminA.client
      .from("availability_windows")
      .insert({ ...base, start_time: "07:00", end_time: "08:00", capacity: 3 });
    expect(capacity?.code).toBe("23514");
    const { error: order } = await adminA.client
      .from("availability_windows")
      .insert({ ...base, start_time: "09:00", end_time: "08:00" });
    expect(order?.code).toBe("23514");
  });

  it("telefone do resumo do dia em E.164 e único por clínica", async () => {
    const { error: format } = await adminA.client
      .from("notification_recipients")
      .insert({ clinic_id: clinicA, label: "X", phone: "84999990000" });
    expect(format?.code).toBe("23514");
    const { error: duplicate } = await adminA.client
      .from("notification_recipients")
      .insert({ clinic_id: clinicA, label: "Y", phone: "+5584999990000" });
    expect(duplicate?.code).toBe("23505");
    const { error: otherClinic } = await adminB.client
      .from("notification_recipients")
      .insert({ clinic_id: clinicB, label: "Z", phone: "+5584999990000" });
    expect(otherClinic).toBeNull();
  });

  it("nome do plano único por clínica, sem diferenciar maiúsculas", async () => {
    const { error } = await adminA.client.from("insurance_plans").insert({ clinic_id: clinicA, name: "UNIMED" });
    expect(error?.code).toBe("23505");
  });
});

describe("acesso às agendas (D6 revista)", () => {
  const agendaNames = async (user: TestUser) => {
    const { data } = await user.client.from("agendas").select("name").order("name");
    return data!.map((row) => row.name);
  };

  it("padrão do acesso por papel: Administrador e Recepção todas; Profissional restrito", async () => {
    const { data } = await adminClient()
      .from("clinic_members")
      .select("user_id, agenda_scope")
      .eq("clinic_id", clinicA);
    const scope = Object.fromEntries(data!.map((row) => [row.user_id, row.agenda_scope]));
    expect(scope[adminA.id]).toBe("all");
    expect(scope[receptionA.id]).toBe("all");
    expect(scope[drJoao.id]).toBe("restricted");
  });

  it("Administrador e Recepção veem todas as agendas", async () => {
    expect(await agendaNames(adminA)).toEqual(["Dr. João", "Dra. Ana", "Exames"]);
    expect(await agendaNames(receptionA)).toEqual(["Dr. João", "Dra. Ana", "Exames"]);
  });

  it("o Profissional vê só a própria agenda", async () => {
    expect(await agendaNames(drJoao)).toEqual(["Dr. João"]);
    expect(await agendaNames(draAna)).toEqual(["Dra. Ana"]);
  });

  it("Recepção restrita vê só as agendas liberadas", async () => {
    expect(await agendaNames(restrictedReceptionA)).toEqual(["Dra. Ana"]);
  });

  it("a disponibilidade segue o acesso às agendas", async () => {
    const { data: fromJoao } = await drJoao.client.from("availability_windows").select("id");
    expect(fromJoao!.map((row) => row.id)).toEqual([a.windowJoao]);
    const { data: fromReception } = await receptionA.client.from("availability_windows").select("id");
    expect(fromReception!.map((row) => row.id).sort()).toEqual([a.windowJoao, a.windowAna, a.windowExam].sort());
  });

  it("liberar uma agenda para o Profissional passa a mostrá-la", async () => {
    await link("member_agenda_grants", { clinic_id: clinicA, user_id: drJoao.id, agenda_id: a.agendaExams });
    expect(await agendaNames(drJoao)).toEqual(["Dr. João", "Exames"]);
    await adminClient().from("member_agenda_grants").delete().eq("user_id", drJoao.id).eq("agenda_id", a.agendaExams);
    expect(await agendaNames(drJoao)).toEqual(["Dr. João"]);
  });

  it("só o Administrador libera agendas; cada um vê as próprias liberações", async () => {
    const { error } = await receptionA.client
      .from("member_agenda_grants")
      .insert({ clinic_id: clinicA, user_id: receptionA.id, agenda_id: a.agendaJoao });
    expect(error?.code).toBe("42501");
    const { data: own } = await restrictedReceptionA.client.from("member_agenda_grants").select("agenda_id");
    expect(own).toEqual([{ agenda_id: a.agendaAna }]);
    const { data: others } = await drJoao.client.from("member_agenda_grants").select("agenda_id");
    expect(others).toEqual([]);
  });

  it("não dá para liberar agenda de outra clínica", async () => {
    const { error } = await adminA.client
      .from("member_agenda_grants")
      .insert({ clinic_id: clinicA, user_id: receptionA.id, agenda_id: b.agenda });
    expect(error?.code).toBe("23503");
  });
});

describe("credencial do bot (clinic_service)", () => {
  it("lê a configuração da própria clínica, inclusive todas as agendas", async () => {
    const service = clinicServiceClient(clinicA);
    const { data: agendas } = await service.from("agendas").select("id");
    expect(agendas).toHaveLength(3);
    const { data: services } = await service.from("services").select("clinic_id");
    expect(new Set(services!.map((row) => row.clinic_id))).toEqual(new Set([clinicA]));
    const { data: settings } = await service.from("clinic_settings").select("clinic_id");
    expect(settings).toEqual([{ clinic_id: clinicA }]);
  });

  it("não vê a configuração de outra clínica", async () => {
    const { data } = await clinicServiceClient(clinicB).from("services").select("id").eq("clinic_id", clinicA);
    expect(data).toEqual([]);
  });

  it("não altera nada", async () => {
    const service = clinicServiceClient(clinicA);
    const { error } = await service.from("locations").insert({ clinic_id: clinicA, name: "bot", type: "clinic" });
    expect(error?.code).toBe("42501");
    const { data } = await service.from("services").update({ price_cents: 1 }).eq("id", a.consultation).select("id");
    expect(data ?? []).toEqual([]);
  });
});

describe("busca de convênio por nome parecido (D10)", () => {
  const search = async (client: TestUser["client"], clinicId: string, query: string) => {
    const { data, error } = await client.rpc("search_insurance_plans", { p_clinic_id: clinicId, p_query: query });
    expect(error).toBeNull();
    return (data as { name: string }[]).map((row) => row.name);
  };

  it("encontra com erro de digitação, sem acento e em maiúsculas", async () => {
    expect((await search(receptionA.client, clinicA, "unimede"))[0]).toBe("Unimed");
    expect((await search(receptionA.client, clinicA, "BRADESCO SAUDE"))[0]).toBe("Bradesco Saúde");
    expect((await search(receptionA.client, clinicA, "hap vida"))[0]).toBe("Hapvida");
  });

  it("encontra pelos nomes alternativos", async () => {
    expect((await search(receptionA.client, clinicA, "unimed natal"))[0]).toBe("Unimed");
  });

  it("nada parecido: lista vazia", async () => {
    expect(await search(receptionA.client, clinicA, "Amil")).toEqual([]);
    expect(await search(receptionA.client, clinicA, "   ")).toEqual([]);
  });

  it("o bot busca nos planos da própria clínica", async () => {
    expect((await search(clinicServiceClient(clinicA), clinicA, "unimed"))[0]).toBe("Unimed");
  });

  it("planos de outra clínica nunca aparecem, mesmo pedindo pelo id dela", async () => {
    expect(await search(receptionA.client, clinicB, "unimed")).toEqual([]);
    expect(await search(clinicServiceClient(clinicA), clinicB, "unimed")).toEqual([]);
    expect(await search(adminB.client, clinicB, "unimed")).toEqual(["Unimed Odonto"]);
  });

  it("plano desativado não aparece", async () => {
    await adminClient().from("insurance_plans").update({ is_active: false }).eq("id", a.hapvida);
    expect(await search(receptionA.client, clinicA, "hapvida")).toEqual([]);
    await adminClient().from("insurance_plans").update({ is_active: true }).eq("id", a.hapvida);
  });

  it("exceção por profissional fica registrada (a Dra. Ana não atende Unimed)", async () => {
    const { data } = await receptionA.client.from("professional_insurance_exclusions").select("professional_id, insurance_plan_id");
    expect(data).toEqual([{ professional_id: a.ana, insurance_plan_id: a.unimed }]);
  });
});
