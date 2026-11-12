import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { listFunnelSessions } from "../../src/lib/data/botFunnel";
import { buildResolutionReport } from "../../src/lib/data/botResolution";
import { asDb, setupAgendaClinic, type AgendaFixture, linkPlanToAllProfessionals, setBotInfoForAll } from "./agendaFixture";
import { adminClient, createUser, deleteUsers } from "./helpers";

// Base de Conhecimento no bot (BC, Etapa 4): conversas inteiras pelo webhook,
// com a Meta simulada e o catálogo inicial ativo e publicado só durante o teste.
// Clínica da agenda: Consulta (Dra. Agenda e Dr. Segundo; R$ 300,00 no
// consultório, R$ 450,00 no domiciliar), Retorno, Exame e Turma; consultório na
// Rua A, 1.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "bc-numero";
type Sent = { to: string; kind: "text" | "list" | "buttons"; body: string; options: { id: string; title: string; description?: string }[]; button?: string };

let f: AgendaFixture;
let sent: Sent[] = [];
let seq = 0;
let version = 0;
let activated: string[] = [];

const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica Base",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "sem template no teste" }),
  text: async (to, body) => (sent.push({ to, kind: "text", body, options: [] }), { sent: true, messageId: `wamid.bc.out.${++seq}`, body }),
  list: async (to: string, body: string, button: string, sections: ListSection[]) => (
    sent.push({ to, kind: "list", body, button, options: sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title, description: r.description }))) }),
    { sent: true, messageId: `wamid.bc.out.${++seq}` }
  ),
  buttons: async (to: string, body: string, buttons: ReplyButton[]) => (
    sent.push({ to, kind: "buttons", body, options: buttons }),
    { sent: true, messageId: `wamid.bc.out.${++seq}` }
  ),
};

const deps = (): WebhookDeps => ({
  resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
  clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
  senderFor: async () => sender,
});

/** Última lista ou botões enviados (o toque responde a ela). */
let lastPrompt: string | null = null;

async function say(phone: string, input: string | { id: string }): Promise<Sent[]> {
  sent = [];
  const message =
    typeof input === "string"
      ? { id: `wamid.bc.in.${++seq}`, from: phone.slice(1), type: "text", text: { body: input } }
      : { id: `wamid.bc.in.${++seq}`, from: phone.slice(1), type: "interactive", context: lastPrompt ? { id: lastPrompt } : undefined, interactive: { list_reply: { id: input.id, title: "" } } };
  const summary = await processWebhook(
    { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, messages: [message] } }] }] },
    deps(),
    new Date(),
  );
  expect(summary.errors).toBe(0);
  sent = sent.map((m) => ({ ...m, body: m.body.replace(/ /g, " ") }));
  const prompts = sent.filter((m) => m.kind !== "text");
  if (prompts.length) lastPrompt = `wamid.bc.out.${seq - (sent.length - 1 - sent.lastIndexOf(prompts.at(-1)!))}`;
  return sent;
}

const bodies = (reply: Sent[]) => reply.map((m) => m.body);
const optionId = (reply: Sent[], title: string) => reply.at(-1)!.options.find((o) => o.title.includes(title))!.id;
const MENU = "Escolha uma opção abaixo ou faça uma pergunta.";
// Bot enxuto (F3f, BE-2): o 1º menu da conversa é uma mensagem só, com as boas-vindas.
const LEAN = expect.stringMatching(/^Olá! 👋\n\nEste é o contato oficial para agendamento d[\s\S]+\n\nEscolha uma das opções abaixo\.$/);
const LEAN_KNOWN = expect.stringMatching(/^Olá, Resp\.! 👋\n\nEste é o contato oficial para agendamento d[\s\S]+\n\nEscolha uma das opções abaixo\.$/);
const LEAN_HANDOFF = "Certo! A recepção vai te atender por aqui. Escreva sua dúvida, por favor.";
const BOOK_LINK = /^Para agendar sua consulta ou exame, toque no botão abaixo\./;
const MINE_LINK = /^Para ver, remarcar ou cancelar suas consultas, toque no botão abaixo\./;
const titles = (reply: Sent[]) => reply.at(-1)!.options.map((o) => o.title);

async function reset(phone: string, state = "MENU") {
  await adminClient().from("conversation_state").update({ state, context: {}, human_handoff: false, not_understood_count: 0 }).eq("clinic_id", f.clinicId).eq("contact_phone", phone);
}

async function convo(phone: string) {
  const { data } = await adminClient().from("conversation_state").select("state, human_handoff, not_understood_count").eq("clinic_id", f.clinicId).eq("contact_phone", phone).single();
  return data!;
}

async function setCoexistence(on: boolean) {
  await adminClient().from("whatsapp_connections").update({ coexistence: on }).eq("clinic_id", f.clinicId);
}

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Base", "+55849913370", { oneBotProfessional: true });
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "bc-waba", status: "connected" });
  await adminClient().from("clinics").update({ portal_slug: `bc-${Date.now()}` }).eq("id", f.clinicId);
  await setBotInfoForAll(f.clinicId, { payment_info: "PIX ou cartão." });
  const { data: unimed } = await adminClient().from("insurance_plans").insert({ clinic_id: f.clinicId, name: "Unimed" }).select("id").single();
  await linkPlanToAllProfessionals(f.clinicId, unimed!.id);
  // Catálogo inicial ativo e publicado só para este teste.
  const { data: drafts } = await adminClient().from("kb_entries").select("code").eq("status", "draft").not("code", "like", "Z%");
  activated = drafts!.map((d) => d.code);
  await adminClient().from("kb_entries").update({ status: "active" }).in("code", activated);
  const { data } = await adminClient().rpc("publish_knowledge_base");
  version = data as number;
});

afterAll(async () => {
  await adminClient().from("kb_entries").update({ status: "draft" }).in("code", activated);
  await adminClient().from("kb_publications").delete().eq("version", version);
  await adminClient().from("kb_unmatched").delete().eq("clinic_id", f.clinicId);
  await f.cleanup();
});

describe("primeira mensagem", () => {
  it("pergunta da base: boas-vindas, a resposta e o menu, sem \"Isso resolve sua dúvida?\" (cliente, 04/nov/2026)", async () => {
    const reply = await say("+5584991337001", "Oi, vocês aceitam Unimed?");
    expect(bodies(reply)).toEqual(["Sim, atendemos *Unimed*.", LEAN_KNOWN]);
    expect((await convo("+5584991337001")).state).toBe("MENU");
  });

  it("só \"oi\": o menu com as boas-vindas, numa mensagem", async () => {
    const reply = await say("+5584991337002", "Oi");
    expect(bodies(reply)).toEqual([LEAN_KNOWN]);
  });

  it("1º menu: opções com descrição e \"Ver opções\"; nas outras vezes, o menu curto (BE-2)", async () => {
    const phone = "+5584991337099";
    const first = await say(phone, "Oi");
    expect(first.at(-1)!.button).toBe("Ver opções");
    expect(first.at(-1)!.options).toEqual([
      { id: "menu_book", title: "📅 Agendar", description: "Consulta, retorno ou exame" },
      { id: "menu_mine", title: "🗓 Minhas consultas", description: "Consultar, remarcar ou cancelar" },
      { id: "menu_professionals", title: "👥 Profissionais", description: "Especialidades, valores e convênios" },
    ]);
    const again = await say(phone, "voltar");
    expect(bodies(again)).toEqual([MENU]);
    // O número digitado vale como o toque.
    expect(bodies(await say(phone, "2"))[0]).toMatch(MINE_LINK);
    expect((await convo(phone)).state).toBe("WELCOME");
  });

  it("pedido claro na 1ª mensagem: o link do Agendar, sem o menu", async () => {
    const reply = await say("+5584991337003", "quero marcar uma consulta");
    expect(reply).toHaveLength(1);
    expect(reply[0].body).toMatch(BOOK_LINK);
  });
});

describe("no menu", () => {
  const phone = "+5584991337010";

  it("responde e mostra o menu de novo (sem \"Isso resolve?\"), sem \"não entendi\" e sem contar", async () => {
    await say(phone, "Oi");
    const reply = await say(phone, "qual o endereço?");
    expect(reply).toHaveLength(2);
    expect(reply[0].body).toContain("Rua A, 1");
    expect(reply[0].body).toContain("https://www.google.com/maps/search/");
    expect(reply.at(-1)!.body).toBe(MENU);
    expect(bodies(reply).join("\n")).not.toContain("Não entendi");
    expect((await convo(phone)).not_understood_count).toBe(0);
  });

  it("número fora das opções segue no \"não entendi\" de hoje e não vai para a base", async () => {
    await reset(phone);
    const reply = await say(phone, "9");
    expect(reply[0].body).toContain("Não entendi");
    const { data } = await adminClient().from("kb_unmatched").select("text").eq("clinic_id", f.clinicId).eq("text", "9");
    expect(data).toEqual([]);
  });

  it("não reconhecida: \"não entendi\" e o texto para o Suporte, sem telefone", async () => {
    await reset(phone);
    const reply = await say(phone, "tem estacionamento?");
    expect(reply[0].body).toContain("Não entendi");
    expect((await convo(phone)).not_understood_count).toBe(1);
    const { data } = await adminClient().from("kb_unmatched").select("*").eq("clinic_id", f.clinicId).eq("text", "tem estacionamento?");
    expect(data).toHaveLength(1);
    expect(data![0].conversation_state).toBe("MENU");
    expect(JSON.stringify(data)).not.toContain("991337010");
  });

  it("agradecimento depois do menu: sem resposta (cortesia, BE-8); com pedido junto, a base responde", async () => {
    await reset(phone);
    await say(phone, "menu");
    expect(await say(phone, "obrigado!")).toEqual([]);
    expect(bodies(await say(phone, "obrigado, vocês fazem exame?"))).toEqual(["Sim, fazemos *Exame*.", MENU]);
  });

  it("agradecimento depois de uma mensagem que não fecha assunto: resposta curta e o menu", async () => {
    await reset(phone);
    await adminClient()
      .from("whatsapp_messages")
      .insert({ clinic_id: f.clinicId, contact_phone: phone, direction: "outbound", message_type: "agent_reply", status: "sent", created_at: new Date().toISOString() });
    expect(bodies(await say(phone, "obrigado!"))).toEqual(["Por nada! Se precisar, é só mandar mensagem por aqui.", MENU]);
  });

  it("pedido de marcação (consulta ou exame): o link do Agendar (bot enxuto)", async () => {
    await reset(phone);
    expect(bodies(await say(phone, "quero marcar uma consulta"))[0]).toMatch(BOOK_LINK);
    await reset(phone);
    expect(bodies(await say(phone, "quero marcar um exame"))[0]).toMatch(BOOK_LINK);
  });

  it("serviço citado: a resposta e o menu, de onde a marcação segue", async () => {
    await reset(phone);
    const reply = await say(phone, "vocês fazem exame?");
    expect(bodies(reply)).toEqual(["Sim, fazemos *Exame*.", MENU]);
  });

});

describe("\"voltar\" digitado (cliente, 31/out/2026)", () => {
  const phone = "+5584991337025";

  it("sempre o menu (bot enxuto, sem submenus); nunca o retorno", async () => {
    await say(phone, "Oi");
    const menu = await say(phone, "Voltar ao menu anterior");
    expect(bodies(menu)).toEqual([MENU]);
    const again = await say(phone, "voltar");
    expect(bodies(again)).toEqual([MENU]);
    expect((await convo(phone)).not_understood_count).toBe(0);
  });
});

describe("\"Você quis dizer…?\"", () => {
  const phone = "+5584991337030";

  it("empate: as opções e \"Nenhuma destas\"; a escolha abre o fluxo", async () => {
    await say(phone, "Oi");
    const reply = await say(phone, "não vou poder ir");
    expect(reply.at(-1)).toMatchObject({ kind: "list", body: "Você quis dizer…?" });
    expect(reply.at(-1)!.options.map((o) => o.title)).toEqual(["1. Quero cancelar", "2. Quero remarcar", "3. Nenhuma destas"]);
    const chosen = await say(phone, { id: optionId(reply, "remarcar") });
    // Bot enxuto: remarcar vai a Minhas consultas, no portal.
    expect(chosen.at(-1)!.body).toMatch(MINE_LINK);
  });

  it("\"Nenhuma destas\": o \"não entendi\" de hoje e o passo de novo", async () => {
    await reset(phone);
    const reply = await say(phone, "não vou poder ir");
    const none = await say(phone, { id: optionId(reply, "Nenhuma") });
    // "Não entendi" e o menu numa mensagem só (cliente, 12/nov/2026).
    expect(none).toHaveLength(1);
    expect(none[0]).toMatchObject({ kind: "list", body: "Não entendi sua resposta 🙏 Escolha uma das opções abaixo." });
  });
});

describe("pergunta clínica", () => {
  const phone = "+5584991337040";

  it("sem recepção no app: o aviso e o menu", async () => {
    await say(phone, "Oi");
    const reply = await say(phone, "meu filho está com febre, o que eu dou?");
    expect(bodies(reply)).toEqual(["Por aqui não conseguimos dar orientação de saúde.", MENU]);
  });

  it("com recepção no app: o aviso e \"Quer falar com a recepção?\"; Sim transfere", async () => {
    await setCoexistence(true);
    await reset(phone);
    const reply = await say(phone, "meu filho está com febre, o que eu dou?");
    expect(reply[0].body).toBe("Por aqui não conseguimos dar orientação de saúde.");
    expect(reply.at(-1)!.kind).toBe("buttons");
    await say(phone, { id: "reception_yes" });
    expect((await convo(phone)).human_handoff).toBe(true);
    await setCoexistence(false);
  });
});

describe("encaixe (cliente, 31/out/2026)", () => {
  const phone = "+5584991337045";

  it("sem a Lista de espera: explica e pergunta da recepção; sem recepção no app, o aviso e o menu", async () => {
    const { data: features } = await adminClient().from("clinic_features").select("feature_key").eq("clinic_id", f.clinicId);
    const keys = features!.map((x) => x.feature_key);
    await adminClient().rpc("set_clinic_features", { p_clinic_id: f.clinicId, p_features: keys.filter((k) => k !== "waitlist") });
    await setCoexistence(true);
    await reset(phone);
    const reply = await say(phone, "encaixe");
    expect(reply.at(-1)).toMatchObject({ kind: "buttons", body: "O encaixe é combinado com a recepção. Você quer falar com a recepção?" });
    await setCoexistence(false);
    await reset(phone);
    const without = await say(phone, "encaixe");
    expect(without.at(-1)!.body).toBe(MENU);
    await adminClient().rpc("set_clinic_features", { p_clinic_id: f.clinicId, p_features: keys });
  });
});

describe("item da matriz", () => {
  it("desligado: o bot segue como hoje", async () => {
    const phone = "+5584991337050";
    const { data: features } = await adminClient().from("clinic_features").select("feature_key").eq("clinic_id", f.clinicId);
    const keys = features!.map((x) => x.feature_key).filter((k) => k !== "knowledge_base");
    await adminClient().rpc("set_clinic_features", { p_clinic_id: f.clinicId, p_features: keys });
    await say(phone, "Oi");
    const reply = await say(phone, "qual o endereço?");
    expect(reply[0].body).toContain("Não entendi");
    await adminClient().rpc("set_clinic_features", { p_clinic_id: f.clinicId, p_features: [...keys, "knowledge_base"] });
  });
});

// ---------------------------------------------------------------------------
// Evolução do assistente (EA, cliente, 02/nov/2026; docs/arquivo/modulos/evolucao-assistente.md)
// ---------------------------------------------------------------------------

const AFTER_RECEPTION = "Espero ter ajudado! 😊 Conseguiu resolver ou ainda quer falar com a recepção?";

async function handoffOf(phone: string) {
  const { data } = await adminClient()
    .from("conversation_state")
    .select("state, human_handoff, handoff_subject, handoff_subject_asked_at")
    .eq("clinic_id", f.clinicId)
    .eq("contact_phone", phone)
    .single();
  return data!;
}

/** Passos das dúvidas (flow "info") e dos pedidos de recepção do número, em ordem. */
async function funnel(phone: string, flow: "info" | "handoff") {
  const { data } = await adminClient()
    .from("bot_funnel_events")
    .select("session_id, step, metadata")
    .eq("clinic_id", f.clinicId)
    .eq("contact_phone", phone)
    .eq("flow", flow)
    .order("occurred_at");
  return data!;
}

const ALWAYS_OPEN = Array.from({ length: 7 }, () => ({ open: "00:00", close: "23:59" }));
const setReceptionHours = (hours: unknown) => adminClient().from("clinic_settings").update({ reception_hours: hours as never }).eq("clinic_id", f.clinicId);

describe("dúvida respondida fora de um fluxo: sem confirmação (cliente, 04/nov/2026)", () => {
  it("no menu: a dúvida no funil (started → answered), marcada sem confirmação", async () => {
    const phone = "+5584991337060";
    await say(phone, "Oi");
    const reply = await say(phone, "qual o endereço?");
    expect(reply.at(-1)!.body).toBe(MENU);
    expect(await handoffOf(phone)).toMatchObject({ state: "MENU", human_handoff: false });
    const steps = await funnel(phone, "info");
    expect(steps.map((s) => s.step)).toEqual(["started", "answered"]);
    expect(steps[0].metadata).toMatchObject({ origin: "menu", implicit: true });
  });

  it("na 1ª mensagem: origem first_message", async () => {
    const phone = "+5584991337061";
    await say(phone, "Oi, qual o endereço?");
    expect((await funnel(phone, "info"))[0].metadata).toMatchObject({ origin: "first_message", implicit: true });
  });

  it("outra pergunta depois da resposta: responde de novo e o menu; duas dúvidas no funil", async () => {
    const phone = "+5584991337063";
    await say(phone, "Oi, qual o endereço?");
    const reply = await say(phone, "vocês aceitam Unimed?");
    expect(bodies(reply)).toEqual(["Sim, atendemos *Unimed*.", MENU]);
    const steps = await funnel(phone, "info");
    expect(steps.filter((s) => s.step === "started")).toHaveLength(2);
  });

});

describe("pedido de recepção: o digitado confirma, o menu transfere; o motivo na mesma mensagem vai para a base (cliente, 06/nov/2026)", () => {
  beforeAll(async () => {
    await setCoexistence(true);
    await setReceptionHours(ALWAYS_OPEN);
  });
  afterAll(async () => setCoexistence(false));

  it("sem motivo, digitado: confirma (Sim · Não); Sim transfere e pergunta o assunto", async () => {
    const phone = "+5584991337070";
    await say(phone, "Oi");
    const ask = await say(phone, "atendente");
    expect(ask.at(-1)).toMatchObject({ kind: "buttons", body: "Você quer falar com a recepção? A conversa passa para a nossa equipe." });
    expect((await handoffOf(phone)).human_handoff).toBe(false);
    const reply = await say(phone, { id: "reception_yes" });
    // BE-4: uma mensagem, que já pede a dúvida.
    expect(bodies(reply)).toEqual([LEAN_HANDOFF]);
    expect((await handoffOf(phone)).human_handoff).toBe(true);
    expect((await funnel(phone, "handoff"))[0].metadata).toMatchObject({ origin: "typed" });
  });

  it("sem motivo, digitado (\"secretária\"): Não mantém com o bot e mostra o menu", async () => {
    const phone = "+5584991337096";
    await say(phone, "Oi");
    await say(phone, "secretária");
    const reply = await say(phone, { id: "reception_no" });
    expect(reply[0].body).toBe("Tudo bem, seguimos por aqui.");
    expect((await handoffOf(phone)).human_handoff).toBe(false);
  });

  it("\"Atendimento\" é pedido de recepção (cliente, 06/nov/2026): confirma; \"horário de atendimento\" segue para a base", async () => {
    for (const [phone, text] of [["+5584991337097", "Atendimento"], ["+5584991337098", "Bom dia, atendimento por favor"], ["+5584991337099", "quero falar com o atendimento"]]) {
      await say(phone, "Oi");
      const ask = await say(phone, text);
      expect(ask.at(-1), text).toMatchObject({ kind: "buttons", body: "Você quer falar com a recepção? A conversa passa para a nossa equipe." });
      expect((await handoffOf(phone)).human_handoff).toBe(false);
    }
    const phone = "+5584991337094";
    await say(phone, "Oi");
    const reply = await say(phone, "qual o horário de atendimento?");
    expect(bodies(reply).join("\n")).not.toContain("Você quer falar com a recepção?");
    expect((await handoffOf(phone)).human_handoff).toBe(false);
  });

  it("sem motivo, pelo menu: transfere direto", async () => {
    const phone = "+5584991337071";
    await say(phone, "Oi");
    const reply = await say(phone, "4"); // Falar com a recepção, pelo menu
    expect(bodies(reply)).toEqual([LEAN_HANDOFF]);
    expect((await handoffOf(phone)).human_handoff).toBe(true);
    expect((await funnel(phone, "handoff"))[0].metadata).toMatchObject({ origin: "menu" });
  });

  it("situação A: a base responde; \"Resolvido\" encerra sem transferir", async () => {
    const phone = "+5584991337072";
    await say(phone, "Oi");
    const reply = await say(phone, "atendente, quanto custa a consulta?");
    expect(reply[0].body).toContain("R$ 300,00");
    expect(reply.at(-1)!.body).toBe(AFTER_RECEPTION);
    expect(titles(reply)).toEqual(["Resolvido", "Falar com a recepção", "Agendar Atendimento"]);
    await say(phone, { id: "kb_resolved" });
    expect((await handoffOf(phone)).human_handoff).toBe(false);
    expect(await funnel(phone, "handoff")).toEqual([]);
    const steps = await funnel(phone, "info");
    expect(steps[0].metadata).toMatchObject({ origin: "reception" });
    expect(steps.at(-1)!.step).toBe("resolved");
  });

  it("situação A, ainda quer a recepção: transfere com o motivo como assunto (sem perguntar de novo)", async () => {
    const phone = "+5584991337073";
    const text = "atendente, quanto custa a consulta?";
    await say(phone, "Oi");
    await say(phone, text);
    const reply = await say(phone, { id: "kb_reception" });
    expect(bodies(reply)).toEqual([LEAN_HANDOFF]);
    const convo = await handoffOf(phone);
    expect(convo).toMatchObject({ human_handoff: true, handoff_subject: text });
    expect(convo.handoff_subject_asked_at).not.toBeNull();
    expect((await funnel(phone, "info")).at(-1)!.step).toBe("escalated");
    expect((await funnel(phone, "handoff"))[0].metadata).toMatchObject({ origin: "typed" });
  });

  it("situação A, \"Agendar Atendimento\": o link do Agendar e a dúvida conta como resolvida", async () => {
    const phone = "+5584991337074";
    await say(phone, "Oi");
    const reply = await say(phone, "atendente, quanto custa a consulta?");
    // Bot enxuto: o link do Agendar, onde se escolhe o tipo e o profissional.
    const booking = await say(phone, { id: optionId(reply, "Agendar Atendimento") });
    expect(bodies(booking)[0]).toMatch(BOOK_LINK);
    expect((await funnel(phone, "info")).at(-1)).toMatchObject({ step: "resolved", metadata: { via: "book" } });
  });

  it("motivo sem resposta segura na mesma mensagem: confirma; Sim transfere e pergunta o assunto", async () => {
    const phone = "+5584991337075";
    await say(phone, "Oi");
    const ask = await say(phone, "atendente, tem estacionamento?");
    expect(ask.at(-1)).toMatchObject({ kind: "buttons", body: "Você quer falar com a recepção? A conversa passa para a nossa equipe." });
    expect((await handoffOf(phone)).human_handoff).toBe(false);
    const reply = await say(phone, { id: "reception_yes" });
    expect(bodies(reply)).toEqual([LEAN_HANDOFF]);
    expect((await handoffOf(phone)).human_handoff).toBe(true);
  });

  it("entrada do tipo recepção na mesma mensagem (resultado de exame): confirma; Sim transfere", async () => {
    const phone = "+5584991337076";
    await say(phone, "Oi");
    const ask = await say(phone, "atendente, o resultado do meu exame já saiu?");
    expect(ask.at(-1)).toMatchObject({ kind: "buttons", body: "Você quer falar com a recepção? A conversa passa para a nossa equipe." });
    expect((await handoffOf(phone)).human_handoff).toBe(false);
    const reply = await say(phone, { id: "reception_yes" });
    expect(bodies(reply)).toEqual([LEAN_HANDOFF]);
    expect((await handoffOf(phone)).human_handoff).toBe(true);
  });

  it("motivo na mesma mensagem: não pergunta de novo, responde", async () => {
    const phone = "+5584991337077";
    await say(phone, "Oi");
    const reply = await say(phone, "atendente, qual o endereço?");
    expect(reply[0].body).toContain("Rua A, 1");
    expect(reply.at(-1)!.body).toBe(AFTER_RECEPTION);
  });

  it("pedido de fluxo na mesma mensagem: o link do Agendar (resolver primeiro)", async () => {
    const phone = "+5584991337078";
    await say(phone, "Oi");
    const reply = await say(phone, "atendente, quero marcar uma consulta");
    expect(reply.at(-1)!.body).toMatch(BOOK_LINK);
    expect((await handoffOf(phone)).human_handoff).toBe(false);
  });

  it("fora do horário: a transferência diz quando a recepção responde", async () => {
    const phone = "+5584991337080";
    await setReceptionHours(Array.from({ length: 7 }, () => null));
    await say(phone, "Oi");
    await say(phone, "atendente");
    const reply = await say(phone, { id: "reception_yes" });
    expect(reply[0].body).toBe(`${LEAN_HANDOFF}\n\nA recepção está fora do horário de atendimento e responde assim que abrir.`);
    await setReceptionHours(ALWAYS_OPEN);
  });

  it("dúvida respondida no menu e depois o pedido de recepção: a transferência fica ligada à dúvida", async () => {
    const phone = "+5584991337095";
    const a = await say(phone, "Oi, qual o endereço?");
    await say(phone, "atendente");
    const b2 = await say(phone, { id: "reception_yes" });
    expect(bodies(a).at(-1)).toEqual(LEAN);
    expect(bodies(b2)).toEqual([LEAN_HANDOFF]);
    expect((await handoffOf(phone)).human_handoff).toBe(true);
  });

});

describe("Métricas: resolução sem a recepção a partir das conversas acima (EA)", () => {
  const reportFor = async (phones: string[]) => {
    const start = new Date(Date.now() - 24 * 60 * 60_000);
    const later = new Date(Date.now() + 60 * 60_000);
    const sessions = (await listFunnelSessions(asDb(f.admin), f.clinicId, start, later)).filter((s) => phones.includes(s.phone));
    return buildResolutionReport(sessions, later, (d) => d.toISOString().slice(0, 10));
  };
  const type = (r: Awaited<ReturnType<typeof reportFor>>, t: string) => r.byType.find((x) => x.type === t)!;

  it("dúvida no menu sem pedido de recepção: resolvida depois dos 30 minutos", async () => {
    const r = await reportFor(["+5584991337060", "+5584991337061"]);
    expect(type(r, "duvida")).toMatchObject({ total: 2, resolved: 2, inconclusive: 0 });
    expect(r).toMatchObject({ unconfirmed: 0, rate: 1 });
  });

  it("dúvida no menu seguida do pedido de recepção em 30 minutos: recepção, contada uma vez", async () => {
    const r = await reportFor(["+5584991337095"]);
    expect(type(r, "duvida")).toMatchObject({ total: 1, human: 1 });
    expect(type(r, "recepcao").total).toBe(0);
  });

  it("resolvida no pedido de recepção: sem transferência; \"Falar com a recepção\" depois da resposta: recepção, contada uma vez", async () => {
    const r = await reportFor(["+5584991337072", "+5584991337073"]);
    expect(type(r, "duvida")).toMatchObject({ total: 2, resolved: 1, human: 1 });
    expect(type(r, "recepcao").total).toBe(0);
  });

  it("pedidos de recepção sem resposta da base: com a recepção", async () => {
    const r = await reportFor(["+5584991337071", "+5584991337075"]);
    expect(type(r, "recepcao")).toMatchObject({ total: 2, human: 2 });
    expect(r.rate).toBe(0);
  });

  it("isolamento: quem não é da clínica não lê nada", async () => {
    const outsider = await createUser("ea-fora");
    try {
      expect(await listFunnelSessions(asDb(outsider), f.clinicId, new Date(Date.now() - 86_400_000), new Date(Date.now() + 3_600_000))).toEqual([]);
    } finally {
      await deleteUsers([outsider]);
    }
  });
});
