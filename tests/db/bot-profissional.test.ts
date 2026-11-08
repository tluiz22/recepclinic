import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";


const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "mb-numero";
type Sent = { to: string; kind: "text" | "list" | "buttons"; body: string; options: { id: string; title: string }[] };

let f: AgendaFixture;
let sent: Sent[] = [];
let seq = 0;

const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica Multi MB",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "sem template no teste" }),
  text: async (to, body) => (sent.push({ to, kind: "text", body, options: [] }), { sent: true, messageId: `wamid.mb.out.${++seq}`, body }),
  list: async (to: string, body: string, _button: string, sections: ListSection[]) => (
    sent.push({ to, kind: "list", body, options: sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title }))) }),
    { sent: true, messageId: `wamid.mb.out.${++seq}` }
  ),
  buttons: async (to: string, body: string, buttons: ReplyButton[]) => (
    sent.push({ to, kind: "buttons", body, options: buttons }),
    { sent: true, messageId: `wamid.mb.out.${++seq}` }
  ),
};

const deps = (): WebhookDeps => ({
  resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
  clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
  senderFor: async () => sender,
});

async function say(phone: string, input: string | { id: string }): Promise<Sent[]> {
  sent = [];
  const message =
    typeof input === "string"
      ? { id: `wamid.mb.in.${++seq}`, from: phone.slice(1), type: "text", text: { body: input } }
      : { id: `wamid.mb.in.${++seq}`, from: phone.slice(1), type: "interactive", interactive: { list_reply: { id: input.id, title: "" } } };
  const summary = await processWebhook(
    { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, messages: [message] } }] }] },
    deps(),
    new Date(),
  );
  expect(summary.errors).toBe(0);
  return sent;
}

// MB e MI (cliente, 07/nov/2026; plano multiprofissional, seções 4 e 5): clínica com dois profissionais. O bot
// pergunta a especialidade, depois o profissional (um só na especialidade: só o nome) e segue no contexto dele:
// serviços, valores, formas de pagamento e convênios do profissional. "Exames" (agenda da equipe) vai direto aos
// exames. "Outro profissional" no menu volta à pergunta.

const optionId = (reply: Sent[], titleStart: string) => reply.at(-1)!.options.find((o) => o.title.includes(titleStart))!.id;
const titles = (reply: Sent[]) => reply.at(-1)!.options.map((o) => o.title);
const bodies = (reply: Sent[]) => reply.map((m) => m.body);

let draId: string;
let segundoId: string;

async function specialtyId(name: string): Promise<string> {
  const { data } = await adminClient().from("kb_specialties").select("id").eq("name", name).single();
  return data!.id;
}

async function lastLink(phone: string) {
  const { data } = await adminClient()
    .from("booking_links")
    .select("service_id, agenda_id")
    .eq("clinic_id", f.clinicId)
    .eq("contact_phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data!;
}

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Multi MB", "+55849912290");
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "mb-waba", status: "connected" });
  const { data: agendas } = await adminClient().from("agendas").select("id, professional_id").in("id", [f.ids.agendaDra, f.ids.agendaDra2]);
  draId = agendas!.find((a) => a.id === f.ids.agendaDra)!.professional_id!;
  segundoId = agendas!.find((a) => a.id === f.ids.agendaDra2)!.professional_id!;
  const [ped, cardio] = [await specialtyId("Pediatria"), await specialtyId("Cardiologia")];
  // Dra. Agenda: Pediatria. Dr. Segundo: Cardiologia (principal) e Pediatria.
  await adminClient().from("professional_specialties").insert([
    { clinic_id: f.clinicId, professional_id: draId, specialty_id: ped, position: 0 },
    { clinic_id: f.clinicId, professional_id: segundoId, specialty_id: cardio, position: 0 },
    { clinic_id: f.clinicId, professional_id: segundoId, specialty_id: ped, position: 1 },
  ]);
  await adminClient().from("professional_bot_info").insert([
    { clinic_id: f.clinicId, professional_id: draId, payment_info: "Cartão em até 3x.", notes: "Chegue 10 minutos antes." },
    { clinic_id: f.clinicId, professional_id: segundoId, payment_info: "Só Pix." },
  ]);
  const { data: plan } = await adminClient().from("insurance_plans").insert({ clinic_id: f.clinicId, name: "Unimed" }).select("id").single();
  await adminClient().from("professional_insurance_plans").insert({ clinic_id: f.clinicId, professional_id: draId, insurance_plan_id: plan!.id });
});

afterAll(async () => f.cleanup());

const restart = (phone: string) =>
  adminClient().from("conversation_state").update({ state: "WELCOME", context: {} }).eq("clinic_id", f.clinicId).eq("contact_phone", phone);

describe("bot com mais de um profissional (MB)", () => {
  it("boas-vindas e a pergunta da especialidade, com Exames; um profissional na especialidade: só o nome e o menu dele", async () => {
    const phone = "+5584991229001";
    let reply = await say(phone, "Oi");
    expect(reply[0].body).toContain("Olá, Resp.! 👋");
    expect(reply.at(-1)!.body).toBe("Para qual especialidade é o atendimento?");
    expect(titles(reply)).toEqual(["1. Cardiologia", "2. Pediatria", "3. Exames"]);
    reply = await say(phone, "1");
    expect(bodies(reply)[0]).toBe("Atendimento com *Dr. Segundo* (Cardiologia).");
    expect(titles(reply)).toEqual(["1. Consultas", "2. Exames", "3. Informações gerais", "4. Outro profissional"]);
    // Consultas › Marcar consulta: só a agenda dele, sem "Com qual profissional?".
    await say(phone, "1");
    reply = await say(phone, "1");
    expect(bodies(reply).join("\n")).not.toContain("Com qual profissional?");
    expect(reply.at(-1)!.body).toBe("É para você ou para outra pessoa?");
    reply = await say(phone, { id: "for_other" });
    // Número novo: a data de nascimento do paciente, o nome, a conferência.
    for (const input of ["10/03/2010", "Ana Multi"]) reply = await say(phone, input);
    reply = await say(phone, "sim");
    expect(reply[0].body).toContain("/agendar/");
    expect(await lastLink(phone)).toMatchObject({ service_id: f.ids.consulta2, agenda_id: f.ids.agendaDra2 });
  });

  it("especialidade com dois: a lista dos profissionais (com as outras especialidades) e \"Outra especialidade\"", async () => {
    const phone = "+5584991229002";
    await say(phone, "Oi");
    let reply = await say(phone, "pediatria");
    expect(reply.at(-1)!.body).toBe("Com qual profissional?");
    expect(reply.at(-1)!.options.map((o) => o.title)).toEqual(["1. Dr. Segundo", "2. Dra. Agenda", "3. Outra especialidade"]);
    reply = await say(phone, "3");
    expect(reply.at(-1)!.body).toBe("Para qual especialidade é o atendimento?");
    reply = await say(phone, "2");
    reply = await say(phone, { id: optionId(reply, "Dra. Agenda") });
    expect(bodies(reply)[0]).toBe("Atendimento com *Dra. Agenda* (Pediatria).");
  });

  it("informações do profissional escolhido: formas de pagamento, convênios e observações", async () => {
    const phone = "+5584991229003";
    await restart(phone);
    await say(phone, "Oi");
    await say(phone, "2");
    let reply = await say(phone, "Dra. Agenda");
    reply = await say(phone, "3");
    expect(titles(reply)).toEqual(["1. Valores", "2. Convênios", "3. Endereço", "4. Outras informações", "5. Voltar ao menu"]);
    reply = await say(phone, "1");
    expect(reply[0].body).toContain("*Formas de pagamento*\nCartão em até 3x.");
    reply = await say(phone, "2");
    expect(reply[0].body).toBe("Convênios atendidos por *Dra. Agenda*: Unimed.");
    reply = await say(phone, "4");
    expect(reply[0].body).toBe("Chegue 10 minutos antes.");

    // Outro profissional: a pergunta de novo; Dr. Segundo atende só particular e não tem observações.
    reply = await say(phone, "Voltar ao menu");
    reply = await say(phone, { id: optionId(reply, "Outro profissional") });
    expect(reply.at(-1)!.body).toBe("Para qual especialidade é o atendimento?");
    await say(phone, "1");
    reply = await say(phone, "3");
    expect(titles(reply)).toEqual(["1. Valores", "2. Convênios", "3. Endereço", "4. Voltar ao menu"]);
    reply = await say(phone, "1");
    expect(reply[0].body).toContain("*Formas de pagamento*\nSó Pix.");
    reply = await say(phone, "2");
    expect(reply[0].body).toBe("*Dr. Segundo* atende só particular.");
  });

  it("Exames: direto ao submenu de exames, sem profissional", async () => {
    const phone = "+5584991229004";
    await restart(phone);
    await say(phone, "Oi");
    const reply = await say(phone, "3");
    expect(bodies(reply)[0]).toBe("Certo, vamos ver os exames.");
    expect(titles(reply)[0]).toBe("1. Marcar exame");
  });

  it("resposta que não está na lista: não entendeu e a pergunta de novo", async () => {
    const phone = "+5584991229005";
    await restart(phone);
    await say(phone, "Oi");
    const reply = await say(phone, "9");
    expect(reply.at(-1)!.body).toBe("Para qual especialidade é o atendimento?");
    expect(bodies(reply).join("\n")).toMatch(/Não entendi/);
  });
});
