import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { getBookingLink } from "../../src/lib/data/agenda/links";
import { confirmBookingLink, linkCandidates, listLinkDates, listLinkSlots, loadBookingPage } from "../../src/lib/data/agenda/publicBooking";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { asDb, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

// Jornada do bot, E2 (cliente, 31/out/2026): particular ou convênio depois de
// serviço, profissional e local; o valor só no particular. Conversas inteiras
// pelo webhook, com a Meta simulada. Clínica da agenda: Consulta com a
// Dra. Agenda (consultório e domiciliar) e o Dr. Segundo (só consultório),
// R$ 300,00 no consultório e R$ 450,00 no domiciliar; Exame (R$ 150,00) numa
// agenda sem profissional.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "e2-numero";
type Sent = { to: string; kind: "text" | "list" | "buttons"; body: string; options: { id: string; title: string }[] };

let f: AgendaFixture;
let sent: Sent[] = [];
let seq = 0;
const plans: Record<string, string> = {};

const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica Convênio E2",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "sem template no teste" }),
  text: async (to, body) => (sent.push({ to, kind: "text", body, options: [] }), { sent: true, messageId: `wamid.e2.out.${++seq}`, body }),
  list: async (to: string, body: string, _button: string, sections: ListSection[]) => (
    sent.push({ to, kind: "list", body, options: sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title }))) }),
    { sent: true, messageId: `wamid.e2.out.${++seq}` }
  ),
  buttons: async (to: string, body: string, buttons: ReplyButton[]) => (
    sent.push({ to, kind: "buttons", body, options: buttons }),
    { sent: true, messageId: `wamid.e2.out.${++seq}` }
  ),
};

const deps = (): WebhookDeps => ({
  resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
  clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
  senderFor: async () => sender,
});

/** Tudo o que o bot mandou na conversa (para conferir que o valor não aparece). */
let transcript: string[] = [];

async function say(phone: string, input: string | { id: string }): Promise<Sent[]> {
  sent = [];
  const message =
    typeof input === "string"
      ? { id: `wamid.e2.in.${++seq}`, from: phone.slice(1), type: "text", text: { body: input } }
      : { id: `wamid.e2.in.${++seq}`, from: phone.slice(1), type: "interactive", interactive: { list_reply: { id: input.id, title: "" } } };
  const summary = await processWebhook(
    { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, messages: [message] } }] }] },
    deps(),
    new Date(),
  );
  expect(summary.errors).toBe(0);
  // O valor sai com espaço fixo (Intl): aqui, espaço comum.
  sent = sent.map((m) => ({ ...m, body: m.body.replace(/\u00a0/g, " ") }));
  transcript.push(...sent.map((m) => m.body));
  return sent;
}

const titles = (reply: Sent[]) => reply.at(-1)!.options.map((o) => o.title);
const optionId = (reply: Sent[], titleStart: string) => reply.at(-1)!.options.find((o) => o.title.includes(titleStart))!.id;
const bodies = (reply: Sent[]) => reply.map((m) => m.body);

async function reset(phone: string) {
  transcript = [];
  await adminClient().from("conversation_state").update({ state: "WELCOME", context: {}, human_handoff: false }).eq("clinic_id", f.clinicId).eq("contact_phone", phone);
}

/** Do "Oi" até depois do profissional (Dr. Segundo só tem consultório; a Dra. Agenda pergunta o local). */
async function upToProfessional(phone: string, professional: "Dr. Segundo" | "Dra. Agenda" | "Primeiro horário"): Promise<Sent[]> {
  await reset(phone);
  await say(phone, "Oi");
  await say(phone, "1"); // Consultas
  const agendas = await say(phone, "1"); // Marcar consulta (consulta única)
  let reply = await say(phone, { id: optionId(agendas, professional) });
  if (reply.at(-1)!.body === "Prefere consultório ou atendimento domiciliar?") reply = await say(phone, "1");
  return reply;
}

async function lastLink(phone: string) {
  const { data } = await adminClient()
    .from("booking_links")
    .select("id, insurance_plan_id, agenda_id, patient_id")
    .eq("clinic_id", f.clinicId)
    .eq("contact_phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data!;
}

async function handoff(phone: string) {
  const { data } = await adminClient().from("conversation_state").select("human_handoff").eq("clinic_id", f.clinicId).eq("contact_phone", phone).single();
  return data!.human_handoff;
}

async function addPlan(name: string, extra: { is_active?: boolean; alternative_names?: string[] } = {}) {
  const { data, error } = await adminClient().from("insurance_plans").insert({ clinic_id: f.clinicId, name, ...extra }).select("id").single();
  if (error) throw error;
  plans[name] = data.id;
  return data.id as string;
}

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Convênio E2", "+55849912270");
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "e2-waba", status: "connected" });
  await adminClient().from("clinic_settings").update({ bot_payment_info: "PIX, dinheiro ou transferência bancária." }).eq("clinic_id", f.clinicId);
});

afterAll(async () => f.cleanup());

describe("clínica sem convênios", () => {
  const phone = "+5584991227099";

  it("não pergunta particular ou convênio: valor e formas de pagamento depois do profissional", async () => {
    const reply = await upToProfessional(phone, "Dr. Segundo");
    expect(bodies(reply)).toEqual([
      "O valor da consulta é R$ 300,00.\n\nFormas de pagamento: PIX, dinheiro ou transferência bancária.",
      "É para você ou para outra pessoa?",
    ]);
    expect(transcript.join("\n")).not.toContain("convênio");
  });

  it("domiciliar: o valor do domiciliar, depois do endereço; a lista de locais sem preço", async () => {
    await reset(phone);
    await say(phone, "Oi");
    await say(phone, "1");
    const agendas = await say(phone, "1");
    let reply = await say(phone, { id: optionId(agendas, "Dra. Agenda") });
    expect(titles(reply)).toEqual(["1. Consultório", "2. Atendimento domicili…", "3. Voltar ao menu"]);
    expect(transcript.join("\n")).not.toContain("R$");
    await say(phone, "2");
    await say(phone, "Rua das Flores, 10");
    reply = await say(phone, "sim");
    expect(reply[0].body).toBe("O valor da consulta é R$ 450,00.\n\nFormas de pagamento: PIX, dinheiro ou transferência bancária.");
  });

  it("recurso Convênios desligado: o plano ativo não conta", async () => {
    const id = await addPlan("Plano Antigo");
    const { data: all } = await adminClient().from("features").select("key");
    await adminClient().rpc("set_clinic_features", { p_clinic_id: f.clinicId, p_features: all!.map((r) => r.key as string).filter((k) => k !== "insurance") });
    try {
      const reply = await upToProfessional(phone, "Dr. Segundo");
      expect(reply[0].body).toMatch(/^O valor da consulta é R\$ 300,00\./);
    } finally {
      await adminClient().rpc("set_clinic_features", { p_clinic_id: f.clinicId, p_features: all!.map((r) => r.key as string) });
      await adminClient().from("insurance_plans").delete().eq("id", id);
    }
  });
});

describe("clínica com convênios", () => {
  const phone = "+5584991227098";

  beforeAll(async () => {
    await addPlan("Unimed", { alternative_names: ["Unimed Natal"] });
    await addPlan("Amil");
    await addPlan("Bradesco Saúde", { is_active: false });
    // O Dr. Segundo não atende Amil.
    const { data: agenda } = await adminClient().from("agendas").select("professional_id").eq("id", f.ids.agendaDra2).single();
    await adminClient().from("professional_insurance_exclusions").insert({ clinic_id: f.clinicId, professional_id: agenda!.professional_id, insurance_plan_id: plans.Amil });
  });

  it("pergunta particular ou convênio; particular: valor e formas de pagamento", async () => {
    let reply = await upToProfessional(phone, "Dr. Segundo");
    expect(reply.at(-1)).toMatchObject({ kind: "buttons", body: "O atendimento será particular ou por convênio?" });
    expect(transcript.join("\n")).not.toContain("R$");
    reply = await say(phone, { id: "coverage_private" });
    expect(bodies(reply)).toEqual([
      "O valor da consulta é R$ 300,00.\n\nFormas de pagamento: PIX, dinheiro ou transferência bancária.",
      "É para você ou para outra pessoa?",
    ]);
  });

  it("convênio aceito: lista só os planos ativos, confirma e segue sem valor; o plano vai no link, no atendimento e no paciente", async () => {
    // Número próprio: o atendimento confirmado aqui mudaria a entrada dos outros testes.
    const phone = "+5584991227096";
    await upToProfessional(phone, "Dr. Segundo");
    let reply = await say(phone, "convênio");
    expect(reply.at(-1)!.body).toBe("Qual é o seu convênio?");
    expect(titles(reply)).toEqual(["1. Amil", "2. Unimed", "3. Outro convênio", "4. Voltar ao menu"]);
    reply = await say(phone, { id: optionId(reply, "Unimed") });
    expect(bodies(reply)).toEqual(["Atendemos pelo convênio *Unimed*.", "É para você ou para outra pessoa?"]);
    await say(phone, { id: "for_other" });
    await say(phone, "Maria Convênio");
    await say(phone, "sim");
    await say(phone, "Joana Convênio");
    await say(phone, "10/03/2015");
    reply = await say(phone, "Sim");
    expect(reply[0].body).toContain("/agendar/");
    expect(transcript.join("\n")).not.toContain("R$");

    const link = await lastLink(phone);
    expect(link).toMatchObject({ insurance_plan_id: plans.Unimed, agenda_id: f.ids.agendaDra2 });
    // Na página: o atendimento confirmado fica com o plano, e o paciente sem plano também.
    const db = createClinicServiceClient(f.clinicId, env());
    const page = await loadBookingPage(db, f.clinicId, link.id);
    if (page.state !== "form") throw new Error(page.state);
    const [date] = await listLinkDates(db, f.clinicId, page);
    const [slot] = await listLinkSlots(db, f.clinicId, page, date.date);
    const result = await confirmBookingLink(db, f.clinicId, link.id, { start: slot.start, agendaId: slot.agendaId, locationId: slot.locationId });
    expect(result.status).toBe("confirmed");
    const { data: appointment } = await adminClient().from("appointments").select("insurance_plan_id").eq("patient_id", link.patient_id).single();
    expect(appointment!.insurance_plan_id).toBe(plans.Unimed);
    const { data: patient } = await adminClient().from("patients").select("insurance_plan_id").eq("id", link.patient_id).single();
    expect(patient!.insurance_plan_id).toBe(plans.Unimed);
  });

  it("profissional que não atende o plano: avisa, oferece particular e, com Sim, mostra o valor", async () => {
    await upToProfessional(phone, "Dr. Segundo");
    let reply = await say(phone, { id: "coverage_insurance" });
    reply = await say(phone, { id: optionId(reply, "Amil") });
    expect(reply.at(-1)).toMatchObject({
      kind: "buttons",
      body: "Infelizmente a clínica não atende pelo convênio *Amil* neste atendimento.\n\nQuer seguir com o atendimento particular?",
    });
    reply = await say(phone, "sim");
    expect(reply[0].body).toMatch(/^O valor da consulta é R\$ 300,00\./);
    expect(reply.at(-1)!.body).toBe("É para você ou para outra pessoa?");
  });

  it("\"Primeiro horário\" com plano que um dos profissionais não atende: aceito, e a página só oferece quem atende", async () => {
    await upToProfessional(phone, "Primeiro horário");
    let reply = await say(phone, { id: "coverage_insurance" });
    reply = await say(phone, { id: optionId(reply, "Amil") });
    expect(reply[0].body).toBe("Atendemos pelo convênio *Amil*.");
    await say(phone, { id: "for_other" });
    for (const input of ["Rita Amil", "sim", "Lia Amil", "05/05/2016", "Sim"]) reply = await say(phone, input);
    expect(reply[0].body).toContain("/agendar/");
    const link = await lastLink(phone);
    expect(link).toMatchObject({ insurance_plan_id: plans.Amil, agenda_id: null });
    const candidates = await linkCandidates(asDb(f.reception), f.clinicId, await getBookingLink(asDb(f.reception), f.clinicId, link.id));
    expect(candidates.agendas.map((a) => a.id)).toEqual([f.ids.agendaDra]);
  });

  it("\"Outro convênio\": não atende; sem particular, a conversa vai para a recepção", async () => {
    await upToProfessional(phone, "Dr. Segundo");
    let reply = await say(phone, { id: "coverage_insurance" });
    reply = await say(phone, { id: "plan_other" });
    expect(reply.at(-1)!.body).toBe("Infelizmente a clínica não atende por esse convênio.\n\nQuer seguir com o atendimento particular?");
    reply = await say(phone, "não");
    expect(bodies(reply)).toEqual(["Tudo bem. A clínica responderá sua mensagem em breve."]);
    expect(await handoff(phone)).toBe(true);
    expect(transcript.join("\n")).not.toContain("R$");
  });

  it("exame particular: \"valor do exame\"; agenda sem profissional atende o plano", async () => {
    await reset(phone);
    await say(phone, "Oi");
    await say(phone, "2"); // Exames
    await say(phone, "1"); // Marcar exame
    let reply = await say(phone, "1"); // Exame (só consultório)
    expect(reply.at(-1)!.body).toBe("O atendimento será particular ou por convênio?");
    reply = await say(phone, "1");
    expect(reply[0].body).toBe("O valor do exame é R$ 150,00.\n\nFormas de pagamento: PIX, dinheiro ou transferência bancária.");
    await reset(phone);
    await say(phone, "Oi");
    await say(phone, "2");
    await say(phone, "1");
    await say(phone, "1");
    reply = await say(phone, "2");
    reply = await say(phone, { id: optionId(reply, "Amil") });
    expect(reply[0].body).toBe("Atendemos pelo convênio *Amil*.");
  });
});

describe("clínica com muitos convênios: o paciente escreve", () => {
  const phone = "+5584991227097";

  beforeAll(async () => {
    for (let i = 1; i <= 8; i++) await addPlan(`Plano Extra ${i}`);
  });

  it("acha pelo outro nome e confirma na lista; inativo ou desconhecido não é aceito", async () => {
    await upToProfessional(phone, "Dr. Segundo");
    let reply = await say(phone, "2");
    expect(bodies(reply)).toEqual(["Qual é o seu convênio? Escreva o nome do plano."]);
    reply = await say(phone, "unimed natal");
    expect(reply.at(-1)!.body).toBe("Qual é o seu convênio?");
    expect(titles(reply)[0]).toBe("1. Unimed");
    reply = await say(phone, "1");
    expect(reply[0].body).toBe("Atendemos pelo convênio *Unimed*.");

    for (const typed of ["Bradesco Saúde", "Convênio Inexistente XYZ"]) {
      await upToProfessional(phone, "Dr. Segundo");
      await say(phone, "2");
      reply = await say(phone, typed);
      expect(reply.at(-1)!.body).toBe("Infelizmente a clínica não atende por esse convênio.\n\nQuer seguir com o atendimento particular?");
    }
  });
});
