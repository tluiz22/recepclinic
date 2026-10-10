import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  adminClient,
  clinicServiceClient,
  createClinic,
  createUser,
  deleteClinics,
  deleteUsers,
  makePlatformStaff,
  type TestUser,
} from "./helpers";

let clinicA: string;
let clinicB: string;
let adminA: TestUser;
let receptionA: TestUser;
let professionalA: TestUser;
let adminB: TestUser;
let support: TestUser;
const a = {} as Record<string, string>;
const PHONE_ID_A = `pnid-a-${Date.now()}`;
const PHONE_ID_B = `pnid-b-${Date.now()}`;

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await adminClient().from(table).insert(row).select("id").single();
  if (error) throw error;
  return data.id as string;
}

beforeAll(async () => {
  clinicA = await createClinic("Clínica A (whatsapp)");
  clinicB = await createClinic("Clínica B (whatsapp)");
  [adminA, receptionA, professionalA, adminB, support] = await Promise.all([
    createUser("admin-a"),
    createUser("recep-a"),
    createUser("prof-a"),
    createUser("admin-b"),
    createUser("suporte"),
  ]);
  await addMember(clinicA, adminA.id, ["admin"]);
  await addMember(clinicA, receptionA.id, ["reception"]);
  await addMember(clinicA, professionalA.id, ["professional"]);
  await addMember(clinicB, adminB.id, ["admin"]);
  await makePlatformStaff(support.id);

  a.contact = await insert("contacts", { clinic_id: clinicA, full_name: "Maria", phone: "+5584966660001" });
  a.patient = await insert("patients", { clinic_id: clinicA, contact_id: a.contact, full_name: "João", birthdate: "2018-01-01" });
  a.professional = await insert("professionals", { clinic_id: clinicA, display_name: "Dra.", profession: "Médica" });
  a.agenda = await insert("agendas", { clinic_id: clinicA, name: "Dra.", kind: "professional", professional_id: a.professional });
  a.location = await insert("locations", { clinic_id: clinicA, name: "Consultório", type: "clinic" });
  a.service = await insert("services", { clinic_id: clinicA, name: "Consulta", category: "consultation", duration_minutes: 30, price_cents: 0 });
  await adminClient().from("service_agendas").insert({ clinic_id: clinicA, service_id: a.service, agenda_id: a.agenda });
});

afterAll(async () => {
  await deleteClinics([clinicA, clinicB]);
  await deleteUsers([adminA, receptionA, professionalA, adminB, support]);
});

describe("conexão do WhatsApp e token (D3a)", () => {
  it("o Suporte cadastra a conexão e grava o token no cofre", async () => {
    const { error } = await support.client
      .from("whatsapp_connections")
      .insert({ clinic_id: clinicA, phone_number_id: PHONE_ID_A, waba_id: "waba-a", display_phone: "+55 84 3333-0000", status: "connected" });
    expect(error).toBeNull();
    const { error: tokenError } = await support.client.rpc("set_whatsapp_access_token", { p_clinic_id: clinicA, p_token: "token-secreto-a" });
    expect(tokenError).toBeNull();

    await adminClient().from("whatsapp_connections").insert({ clinic_id: clinicB, phone_number_id: PHONE_ID_B, waba_id: "waba-b", status: "connected" });
    await adminClient().rpc("set_whatsapp_access_token", { p_clinic_id: clinicB, p_token: "token-secreto-b" });
  });

  it("o Administrador da clínica não cadastra conexão nesta fase", async () => {
    await adminA.client.from("whatsapp_connections").update({ status: "disconnected" }).eq("clinic_id", clinicA);
    const { data } = await adminClient().from("whatsapp_connections").select("status").eq("clinic_id", clinicA).single();
    expect(data!.status).toBe("connected");
    const { error: tokenError } = await adminA.client.rpc("set_whatsapp_access_token", { p_clinic_id: clinicA, p_token: "x" });
    expect(tokenError?.code).toBe("42501");
  });

  it("a equipe vê a situação da conexão, mas nunca o token nem o id do segredo", async () => {
    const { data } = await receptionA.client.from("whatsapp_connections").select("status, phone_number_id");
    expect(data).toEqual([{ status: "connected", phone_number_id: PHONE_ID_A }]);
    const { error: secretColumn } = await receptionA.client.from("whatsapp_connections").select("access_token_secret_id");
    expect(secretColumn?.code).toBe("42501");
    const { error: token } = await adminA.client.rpc("get_whatsapp_access_token");
    expect(token?.code).toBe("42501");
  });

  it("o bot lê só o token da própria clínica", async () => {
    const { data: tokenA } = await clinicServiceClient(clinicA).rpc("get_whatsapp_access_token");
    expect(tokenA).toBe("token-secreto-a");
    const { data: tokenB } = await clinicServiceClient(clinicB).rpc("get_whatsapp_access_token");
    expect(tokenB).toBe("token-secreto-b");
  });

  it("trocar o token atualiza o cofre", async () => {
    await support.client.rpc("set_whatsapp_access_token", { p_clinic_id: clinicA, p_token: "token-novo-a" });
    const { data } = await clinicServiceClient(clinicA).rpc("get_whatsapp_access_token");
    expect(data).toBe("token-novo-a");
  });

  it("o webhook descobre a clínica pelo phone_number_id (só a plataforma)", async () => {
    const { data } = await adminClient().rpc("resolve_whatsapp_clinic", { p_phone_number_id: PHONE_ID_A });
    expect(data).toBe(clinicA);
    const { data: unknown } = await adminClient().rpc("resolve_whatsapp_clinic", { p_phone_number_id: "nao-existe" });
    expect(unknown).toBeNull();
    const { error } = await clinicServiceClient(clinicA).rpc("resolve_whatsapp_clinic", { p_phone_number_id: PHONE_ID_A });
    expect(error?.code).toBe("42501");
  });

  it("o mesmo número não pode estar em duas clínicas", async () => {
    await adminClient().from("whatsapp_connections").delete().eq("clinic_id", clinicB);
    const { error } = await adminClient()
      .from("whatsapp_connections")
      .insert({ clinic_id: clinicB, phone_number_id: PHONE_ID_A, waba_id: "waba-b" });
    expect(error?.code).toBe("23505");
  });

  it("apagar a conexão apaga o token do cofre", async () => {
    // A conexão de B foi apagada no teste anterior: o bot de B não tem mais token.
    const { data } = await clinicServiceClient(clinicB).rpc("get_whatsapp_access_token");
    expect(data).toBeNull();
  });
});

describe("templates por clínica (D3b)", () => {
  it("o Suporte e o bot cadastram; a equipe só lê", async () => {
    const { error: bySupport } = await support.client
      .from("whatsapp_templates")
      .insert({ clinic_id: clinicA, template_key: "reminder", name: "lembrete_consulta" });
    expect(bySupport).toBeNull();
    const { error: byBot } = await clinicServiceClient(clinicA)
      .from("whatsapp_templates")
      .insert({ clinic_id: clinicA, template_key: "confirmation", name: "confirmacao" });
    expect(byBot).toBeNull();
    const { error: byAdmin } = await adminA.client
      .from("whatsapp_templates")
      .insert({ clinic_id: clinicA, template_key: "cancellation", name: "cancelamento" });
    expect(byAdmin?.code).toBe("42501");
    const { data } = await receptionA.client.from("whatsapp_templates").select("template_key").order("template_key");
    expect(data!.map((row) => row.template_key)).toEqual(["confirmation", "reminder"]);
  });

  it("um template por tipo e por clínica; tipo desconhecido é recusado", async () => {
    const { error: duplicate } = await support.client
      .from("whatsapp_templates")
      .insert({ clinic_id: clinicA, template_key: "reminder", name: "outro" });
    expect(duplicate?.code).toBe("23505");
    const { error: unknown } = await support.client
      .from("whatsapp_templates")
      .insert({ clinic_id: clinicA, template_key: "promocao", name: "x" });
    expect(unknown?.code).toBe("23514");
  });
});

describe("conversas e mensagens", () => {
  it("o bot guarda o estado da conversa por clínica e telefone", async () => {
    const service = clinicServiceClient(clinicA);
    const { error } = await service
      .from("conversation_state")
      .insert({ clinic_id: clinicA, contact_phone: "+5584966660001", contact_id: a.contact, state: "MENU" });
    expect(error).toBeNull();
    const { error: duplicate } = await service
      .from("conversation_state")
      .insert({ clinic_id: clinicA, contact_phone: "+5584966660001", state: "MENU" });
    expect(duplicate?.code).toBe("23505");
    const { error: otherClinic } = await clinicServiceClient(clinicB)
      .from("conversation_state")
      .insert({ clinic_id: clinicB, contact_phone: "+5584966660001", state: "WELCOME" });
    expect(otherClinic).toBeNull();
  });

  it("a recepção pausa a conversa (atendimento por uma pessoa)", async () => {
    const { data } = await receptionA.client
      .from("conversation_state")
      .update({ human_handoff: true })
      .eq("clinic_id", clinicA)
      .select("human_handoff");
    expect(data).toEqual([{ human_handoff: true }]);
  });

  it("mensagem recebida repetida pela Meta é recusada (L23)", async () => {
    const service = clinicServiceClient(clinicA);
    const message = { clinic_id: clinicA, contact_id: a.contact, direction: "inbound", message_type: "text", body: "oi", wa_message_id: "wamid.1" };
    const { error: first } = await service.from("whatsapp_messages").insert(message);
    expect(first).toBeNull();
    const { error: second } = await service.from("whatsapp_messages").insert(message);
    expect(second?.code).toBe("23505");
  });

  it("a equipe registra mensagem enviada pela tela (ex.: reenvio do lembrete)", async () => {
    const { error } = await receptionA.client
      .from("whatsapp_messages")
      .insert({ clinic_id: clinicA, contact_id: a.contact, direction: "outbound", message_type: "template", template_name: "lembrete_consulta" });
    expect(error).toBeNull();
  });

  it("outra clínica não vê conversas nem mensagens", async () => {
    for (const table of ["conversation_state", "whatsapp_messages"]) {
      const { data } = await adminB.client.from(table).select("clinic_id").eq("clinic_id", clinicA);
      expect(data, table).toEqual([]);
      const { data: fromBot } = await clinicServiceClient(clinicB).from(table).select("clinic_id").eq("clinic_id", clinicA);
      expect(fromBot, table).toEqual([]);
    }
  });
});

describe("funil, rotinas e resumos (gravados pelo bot/agendador)", () => {
  it("o bot grava; a equipe lê; a equipe não grava", async () => {
    const service = clinicServiceClient(clinicA);
    const rows: Record<string, Record<string, unknown>> = {
      bot_funnel_events: { clinic_id: clinicA, session_id: crypto.randomUUID(), flow: "booking", step: "start", contact_phone: "+5584966660001" },
      job_runs: { clinic_id: clinicA, job: "appointment_reminders", trigger: "scheduled" },
      daily_summary_sends: { clinic_id: clinicA, summary_date: "2027-03-01", kind: "consultas", first_scheduled_at: "2027-03-01T11:00:00Z" },
    };
    for (const [table, row] of Object.entries(rows)) {
      const { error } = await service.from(table).insert(row);
      expect(error, table).toBeNull();
      const { data } = await professionalA.client.from(table).select("clinic_id");
      expect(data, table).toEqual([{ clinic_id: clinicA }]);
      const { error: byTeam } = await receptionA.client.from(table).insert(row);
      expect(byTeam?.code, table).toBe("42501");
      const { data: fromOther } = await adminB.client.from(table).select("clinic_id");
      expect(fromOther, table).toEqual([]);
    }
  });

  it("o agendador atualiza a própria execução", async () => {
    const service = clinicServiceClient(clinicA);
    const { data } = await service
      .from("job_runs")
      .update({ status: "ok", finished_at: new Date().toISOString(), totals: { sent: 3 } })
      .eq("clinic_id", clinicA)
      .select("status");
    expect(data).toEqual([{ status: "ok" }]);
    const { data: fromOther } = await clinicServiceClient(clinicB).from("job_runs").update({ status: "error" }).eq("clinic_id", clinicA).select("id");
    expect(fromOther).toEqual([]);
  });
});

describe("contadores de uso (L49)", () => {
  it("sobem sozinhos com mensagens que saíram (templates à parte) e atendimentos criados", async () => {
    const before = (await adminClient().from("clinic_usage_monthly").select("messages_sent, templates_sent, appointments_created").eq("clinic_id", clinicA)).data!;
    const sentBefore = before.reduce((sum, row) => sum + row.messages_sent, 0);
    const createdBefore = before.reduce((sum, row) => sum + row.appointments_created, 0);
    const templatesBefore = before.reduce((sum, row) => sum + row.templates_sent, 0);

    await clinicServiceClient(clinicA)
      .from("whatsapp_messages")
      .insert({ clinic_id: clinicA, direction: "outbound", message_type: "text", body: "olá" });
    await clinicServiceClient(clinicA)
      .from("whatsapp_messages")
      .insert({ clinic_id: clinicA, direction: "inbound", message_type: "text", body: "oi", wa_message_id: "wamid.2" });
    // F9.5: template conta também como template; pulada e com falha não contam.
    await clinicServiceClient(clinicA).from("whatsapp_messages").insert([
      { clinic_id: clinicA, direction: "outbound", message_type: "appointment_reminder", template_name: "rc_lembrete_v1", status: "sent" },
      { clinic_id: clinicA, direction: "outbound", message_type: "appointment_confirmation", template_name: "rc_confirmacao_v1", status: "skipped_no_template" },
      { clinic_id: clinicA, direction: "outbound", message_type: "text", body: "falhou", status: "failed" },
    ]);
    await adminClient().from("appointments").insert({
      clinic_id: clinicA, patient_id: a.patient, service_id: a.service, agenda_id: a.agenda, location_id: a.location,
      scheduled_at: "2027-03-01T13:00:00Z", duration_minutes: 30, booking_channel: "whatsapp_bot",
    });

    const after = (await adminClient().from("clinic_usage_monthly").select("messages_sent, templates_sent, appointments_created").eq("clinic_id", clinicA)).data!;
    expect(after.reduce((sum, row) => sum + row.messages_sent, 0)).toBe(sentBefore + 2);
    expect(after.reduce((sum, row) => sum + row.templates_sent, 0)).toBe(templatesBefore + 1);
    expect(after.reduce((sum, row) => sum + row.appointments_created, 0)).toBe(createdBefore + 1);
  });

  it("o Administrador vê; Recepção e outra clínica não; ninguém grava", async () => {
    const { data: byAdmin } = await adminA.client.from("clinic_usage_monthly").select("clinic_id");
    expect(byAdmin!.length).toBeGreaterThan(0);
    const { data: byReception } = await receptionA.client.from("clinic_usage_monthly").select("clinic_id");
    expect(byReception).toEqual([]);
    const { data: byOther } = await adminB.client.from("clinic_usage_monthly").select("clinic_id").eq("clinic_id", clinicA);
    expect(byOther).toEqual([]);
    const { error } = await adminA.client.from("clinic_usage_monthly").update({ messages_sent: 0 }).eq("clinic_id", clinicA);
    expect(error?.code).toBe("42501");
  });
});
