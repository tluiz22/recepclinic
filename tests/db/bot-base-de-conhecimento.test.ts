import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { listFunnelSessions } from "../../src/lib/data/botFunnel";
import { buildResolutionReport } from "../../src/lib/data/botResolution";
import { asDb, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
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
type Sent = { to: string; kind: "text" | "list" | "buttons"; body: string; options: { id: string; title: string }[] };

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
  list: async (to: string, body: string, _button: string, sections: ListSection[]) => (
    sent.push({ to, kind: "list", body, options: sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title }))) }),
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
const MENU = "Escolha uma opção abaixo (ou digite o número).";
const WELCOME = "Olá! 👋 Aqui é da Clínica Base.\n\nSou a assistente virtual e estou aqui para ajudar.\nVocê pode escrever o que precisa ou escolher uma das opções abaixo.";
const RESOLVED_Q = "Isso resolve sua dúvida?";
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
  f = await setupAgendaClinic("Clínica Base", "+55849913370");
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "bc-waba", status: "connected" });
  await adminClient().from("clinic_settings").update({ bot_payment_info: "PIX ou cartão." }).eq("clinic_id", f.clinicId);
  await adminClient().from("insurance_plans").insert({ clinic_id: f.clinicId, name: "Unimed" });
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
  it("pergunta da base: boas-vindas, a resposta e \"Isso resolve sua dúvida?\" no lugar do menu (EA, 02/nov/2026)", async () => {
    const reply = await say("+5584991337001", "Oi, vocês aceitam Unimed?");
    expect(bodies(reply)).toEqual([WELCOME, "Sim, atendemos *Unimed*.", RESOLVED_Q]);
    // Sem recepção no app: sem o botão da recepção.
    expect(titles(reply)).toEqual(["Resolvido", "Voltar ao menu"]);
  });

  it("só \"oi\": boas-vindas (convidando a escrever) e o menu", async () => {
    const reply = await say("+5584991337002", "Oi");
    expect(bodies(reply)).toEqual([WELCOME, MENU]);
  });

  it("pedido claro na 1ª mensagem: abre o fluxo, sem o menu", async () => {
    const reply = await say("+5584991337003", "quero marcar uma consulta");
    expect(bodies(reply)).toEqual([WELCOME, "O que você precisa sobre consultas?"]);
  });
});

describe("no menu", () => {
  const phone = "+5584991337010";

  it("responde e pergunta se resolveu (sem repetir o menu), sem \"não entendi\" e sem contar", async () => {
    await say(phone, "Oi");
    const reply = await say(phone, "qual o endereço?");
    expect(reply[0].body).toContain("Rua A, 1");
    expect(reply[0].body).toContain("https://www.google.com/maps/search/");
    expect(reply.at(-1)!.body).toBe(RESOLVED_Q);
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

  it("agradecimento: resposta curta e o menu", async () => {
    await reset(phone);
    expect(bodies(await say(phone, "obrigado!"))).toEqual(["Por nada! Se precisar, é só mandar mensagem por aqui.", MENU]);
  });

  it("pedido de marcação abre o submenu, com marcar, retorno, remarcar e cancelar (cliente, 31/out/2026)", async () => {
    await reset(phone);
    const reply = await say(phone, "quero marcar uma consulta");
    expect(bodies(reply)).toEqual(["O que você precisa sobre consultas?"]);
    expect(reply.at(-1)!.options.map((o) => o.title)).toEqual(expect.arrayContaining(["1. Marcar consulta", "3. Remarcar", "4. Cancelar"]));
    expect((await convo(phone)).state).toBe("CONSULTAS_MENU");
    const exam = await say(phone, "quero marcar um exame");
    expect(bodies(exam)).toEqual(["O que você precisa sobre exames?"]);
    expect((await convo(phone)).state).toBe("EXAMES_MENU");
  });

  it("serviço citado: a resposta com \"Marcar\", que abre a marcação dele", async () => {
    await reset(phone);
    const reply = await say(phone, "vocês fazem exame?");
    expect(bodies(reply)).toEqual(["Sim, fazemos *Exame*.", RESOLVED_Q]);
    expect(titles(reply)).toEqual(["Resolvido", "Marcar", "Voltar ao menu"]);
    const booking = await say(phone, { id: optionId(reply, "Marcar") });
    expect(booking[0].body).toBe("Vamos marcar *Exame*.");
  });
});

describe("no meio da marcação", () => {
  const phone = "+5584991337020";

  it("valor do serviço escolhido e o mesmo passo de novo; depois a marcação segue", async () => {
    await say(phone, "Oi");
    await say(phone, "1"); // Consultas
    const agendas = await say(phone, "1"); // Marcar consulta
    expect(agendas.at(-1)!.body).toBe("Com qual profissional?");
    const reply = await say(phone, "quanto custa?");
    expect(reply[0].body).toContain("*Consulta*\nConsultório: R$ 300,00");
    expect(reply[0].body).not.toContain("Exame");
    expect(reply.at(-1)!.body).toBe("Com qual profissional?");
    expect((await convo(phone)).state).toBe("BOOK_AGENDA");
    const next = await say(phone, { id: optionId(reply, "Dr. Segundo") });
    // Com convênio cadastrado, o passo seguinte de hoje: particular ou convênio.
    expect(next.at(-1)!.body).toContain("particular");
  });
});

describe("\"voltar\" digitado (cliente, 31/out/2026)", () => {
  const phone = "+5584991337025";

  it("na marcação, o submenu de onde veio; no submenu, o menu; nunca o retorno", async () => {
    await say(phone, "Oi");
    await say(phone, "1"); // Consultas
    await say(phone, "1"); // Marcar consulta
    const back = await say(phone, "voltar");
    expect(bodies(back)).toEqual(["O que você precisa sobre consultas?"]);
    expect((await convo(phone)).state).toBe("CONSULTAS_MENU");
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
    // Número sem cadastro: a resposta do fluxo de remarcar de hoje e o menu.
    expect(chosen.at(-1)!.body).toBe(MENU);
  });

  it("\"Nenhuma destas\": o \"não entendi\" de hoje e o passo de novo", async () => {
    await reset(phone);
    const reply = await say(phone, "não vou poder ir");
    const none = await say(phone, { id: optionId(reply, "Nenhuma") });
    expect(none[0].body).toContain("Não entendi");
    expect(none.at(-1)!.body).toBe(MENU);
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

  it("com a Lista de espera: pergunta o tipo (consulta, retorno ou exame) e abre o \"Encaixe ou antecipar\"", async () => {
    await say(phone, "Oi");
    let reply = await say(phone, "Preciso de um encaixe");
    expect(reply.at(-1)).toMatchObject({ kind: "buttons", body: "O encaixe é para qual tipo de atendimento?" });
    expect(reply.at(-1)!.options.map((o) => o.title)).toEqual(["Consulta", "Retorno", "Exame"]);
    // Número sem atendimento marcado: a resposta de hoje do encaixe, com Marcar, do tipo escolhido.
    reply = await say(phone, { id: "waitlist_type_return" });
    expect(reply.at(-1)!.body).toContain("não encontramos um retorno marcado");
    await reset(phone);
    const other = await say(phone, "consigo um encaixe?");
    expect(other.at(-1)!.body).toBe("O encaixe é para qual tipo de atendimento?");
    // Com o tipo na mensagem, não pergunta.
    await reset(phone);
    const exam = await say(phone, "tem encaixe para exame?");
    expect(exam.at(-1)!.body).toContain("A lista de espera serve para antecipar um horário já marcado, e não encontramos um exame marcado");
  });

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
// Evolução do assistente (EA, cliente, 02/nov/2026; docs/evolucao-assistente.md)
// ---------------------------------------------------------------------------

const REASON_Q = "Claro! 😊 Poderia me contar brevemente o que você precisa?\n\nAssim, talvez eu consiga ajudar você agora. Se preferir, toque abaixo e passo para a recepção.";
const AFTER_RECEPTION = "Espero ter ajudado! 😊 Conseguiu resolver ou ainda quer falar com a recepção?";
const SUBJECT_Q = "Para agilizar, poderia me contar brevemente qual assunto deseja tratar com a secretária?";
const NO_SAFE = "Não encontrei uma informação segura para responder sua dúvida. Vou encaminhar sua solicitação para a recepção, que poderá ajudar você.";

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

describe("dúvida respondida: \"Resolvido?\" (EA)", () => {
  it("\"Resolvido\": agradece, volta ao começo, sem pendência para a recepção; o funil registra a resolução", async () => {
    const phone = "+5584991337060";
    await say(phone, "Oi");
    const reply = await say(phone, "qual o endereço?");
    expect(reply.at(-1)!.body).toBe(RESOLVED_Q);
    expect(bodies(await say(phone, { id: "kb_resolved" }))).toEqual(["Que bom! Se precisar, é só escrever por aqui."]);
    expect(await handoffOf(phone)).toMatchObject({ state: "WELCOME", human_handoff: false });
    const steps = await funnel(phone, "info");
    expect(steps.map((s) => s.step)).toEqual(["started", "answered", "resolved"]);
    expect(steps[0].metadata).toMatchObject({ origin: "menu" });
    expect(new Set(steps.map((s) => s.session_id)).size).toBe(1);
  });

  it("\"Voltar ao menu\": o menu; a dúvida fica sem confirmação (inconclusiva)", async () => {
    const phone = "+5584991337061";
    await say(phone, "Oi, qual o endereço?");
    expect(bodies(await say(phone, { id: "kb_menu" }))).toEqual([MENU]);
    expect((await funnel(phone, "info")).map((s) => s.step)).toEqual(["started", "answered"]);
  });

  it("\"obrigado\" digitado depois da resposta conta como resolvido", async () => {
    const phone = "+5584991337062";
    await say(phone, "Oi, qual o endereço?");
    expect(bodies(await say(phone, "obrigada!"))).toEqual(["Que bom! Se precisar, é só escrever por aqui."]);
    expect((await funnel(phone, "info")).at(-1)!.step).toBe("resolved");
  });

  it("outra pergunta depois da resposta: responde de novo, e a primeira fica inconclusiva", async () => {
    const phone = "+5584991337063";
    await say(phone, "Oi, qual o endereço?");
    const reply = await say(phone, "vocês aceitam Unimed?");
    expect(bodies(reply)).toEqual(["Sim, atendemos *Unimed*.", RESOLVED_Q]);
    const steps = await funnel(phone, "info");
    expect(steps.filter((s) => s.step === "started")).toHaveLength(2);
    expect(steps.some((s) => s.step === "resolved")).toBe(false);
  });

  it("no meio de uma marcação: só a resposta e o passo, sem \"Resolvido?\" nem dúvida no funil", async () => {
    const phone = "+5584991337064";
    await say(phone, "Oi");
    await say(phone, "1");
    await say(phone, "1");
    const reply = await say(phone, "qual o endereço?");
    expect(reply.at(-1)!.body).toBe("Com qual profissional?");
    expect(await funnel(phone, "info")).toEqual([]);
  });
});

describe("pedido de recepção: o motivo antes de transferir (EA)", () => {
  beforeAll(async () => {
    await setCoexistence(true);
    await setReceptionHours(ALWAYS_OPEN);
  });
  afterAll(async () => setCoexistence(false));

  it("sem motivo: pergunta o motivo, com \"Falar com a recepção\" a um toque; nada é transferido ainda", async () => {
    const phone = "+5584991337070";
    await say(phone, "Oi");
    const reply = await say(phone, "atendente");
    expect(bodies(reply)).toEqual([REASON_Q]);
    expect(titles(reply)).toEqual(["Falar com a recepção"]);
    expect((await handoffOf(phone)).human_handoff).toBe(false);
    // O toque transfere na hora, e o bot pergunta o assunto como antes.
    const now = await say(phone, { id: "reception_now" });
    expect(now[0].body).toContain("Vou te transferir para a recepção");
    expect(now.at(-1)!.body).toBe(SUBJECT_Q);
    expect((await handoffOf(phone)).human_handoff).toBe(true);
    expect((await funnel(phone, "handoff"))[0].metadata).toMatchObject({ origin: "typed" });
  });

  it("insiste (pede de novo): transfere direto", async () => {
    const phone = "+5584991337071";
    await say(phone, "Oi");
    await say(phone, "atendente");
    const reply = await say(phone, "quero falar com uma pessoa");
    expect(reply[0].body).toContain("Vou te transferir para a recepção");
    expect((await handoffOf(phone)).human_handoff).toBe(true);
  });

  it("situação A: a base responde; \"Resolvido\" encerra sem transferir", async () => {
    const phone = "+5584991337072";
    await say(phone, "Oi");
    await say(phone, "atendente");
    const reply = await say(phone, "quanto custa a consulta?");
    expect(reply[0].body).toContain("R$ 300,00");
    expect(reply.at(-1)!.body).toBe(AFTER_RECEPTION);
    expect(titles(reply)).toEqual(["Resolvido", "Falar com a recepção", "Marcar consulta"]);
    await say(phone, { id: "kb_resolved" });
    expect((await handoffOf(phone)).human_handoff).toBe(false);
    expect(await funnel(phone, "handoff")).toEqual([]);
    const steps = await funnel(phone, "info");
    expect(steps[0].metadata).toMatchObject({ origin: "reception" });
    expect(steps.at(-1)!.step).toBe("resolved");
  });

  it("situação A, ainda quer a recepção: transfere com o motivo como assunto (sem perguntar de novo)", async () => {
    const phone = "+5584991337073";
    await say(phone, "Oi");
    await say(phone, "4"); // Falar com a recepção, pelo menu
    await say(phone, "quanto custa a consulta?");
    const reply = await say(phone, { id: "kb_reception" });
    expect(bodies(reply)).toHaveLength(1);
    expect(reply[0].body).toContain("Vou te transferir para a recepção");
    const convo = await handoffOf(phone);
    expect(convo).toMatchObject({ human_handoff: true, handoff_subject: "quanto custa a consulta?" });
    expect(convo.handoff_subject_asked_at).not.toBeNull();
    expect((await funnel(phone, "info")).at(-1)!.step).toBe("escalated");
    expect((await funnel(phone, "handoff"))[0].metadata).toMatchObject({ origin: "menu" });
  });

  it("situação A, \"Marcar consulta\": a marcação começa e a dúvida conta como resolvida", async () => {
    const phone = "+5584991337074";
    await say(phone, "Oi");
    await say(phone, "atendente");
    const reply = await say(phone, "quanto custa a consulta?");
    const booking = await say(phone, { id: optionId(reply, "Marcar consulta") });
    expect(booking.at(-1)!.body).toBe("Com qual profissional?");
    expect((await funnel(phone, "info")).at(-1)).toMatchObject({ step: "resolved", metadata: { via: "book" } });
  });

  it("situação B: sem resposta segura, transfere dizendo isso, com o motivo como assunto", async () => {
    const phone = "+5584991337075";
    await say(phone, "Oi");
    await say(phone, "atendente");
    const reply = await say(phone, "tem estacionamento?");
    expect(reply).toHaveLength(1);
    expect(reply[0].body.startsWith(NO_SAFE)).toBe(true);
    expect(await handoffOf(phone)).toMatchObject({ human_handoff: true, handoff_subject: "tem estacionamento?" });
  });

  it("situação C: entrada do tipo recepção (resultado de exame) transfere direto, com o assunto", async () => {
    const phone = "+5584991337076";
    await say(phone, "Oi");
    await say(phone, "atendente");
    const reply = await say(phone, "o resultado do meu exame já saiu?");
    expect(reply).toHaveLength(1);
    expect(reply[0].body).toContain("Vou te transferir para a recepção");
    expect(await handoffOf(phone)).toMatchObject({ human_handoff: true, handoff_subject: "o resultado do meu exame já saiu?" });
  });

  it("motivo na mesma mensagem: não pergunta de novo, responde", async () => {
    const phone = "+5584991337077";
    await say(phone, "Oi");
    const reply = await say(phone, "atendente, qual o endereço?");
    expect(reply[0].body).toContain("Rua A, 1");
    expect(reply.at(-1)!.body).toBe(AFTER_RECEPTION);
  });

  it("pedido de fluxo como motivo: abre o fluxo (resolver primeiro)", async () => {
    const phone = "+5584991337078";
    await say(phone, "Oi");
    await say(phone, "atendente");
    const reply = await say(phone, "quero marcar uma consulta");
    expect(reply.at(-1)!.body).toBe("O que você precisa sobre consultas?");
    expect((await handoffOf(phone)).human_handoff).toBe(false);
  });

  it("pergunta clínica como motivo: o aviso de saúde e a transferência", async () => {
    const phone = "+5584991337079";
    await say(phone, "Oi");
    await say(phone, "atendente");
    const reply = await say(phone, "meu filho está com febre, o que eu dou?");
    expect(reply[0].body).toBe("Por aqui não conseguimos dar orientação de saúde.");
    expect((await handoffOf(phone)).human_handoff).toBe(true);
  });

  it("fora do horário: a transferência diz quando a recepção responde", async () => {
    const phone = "+5584991337080";
    await setReceptionHours(Array.from({ length: 7 }, () => null));
    await say(phone, "Oi");
    await say(phone, "atendente");
    const reply = await say(phone, "tem estacionamento?");
    expect(reply[0].body).toBe(`${NO_SAFE} No momento a recepção está fora do horário de atendimento; responderemos assim que possível.`);
    await setReceptionHours(ALWAYS_OPEN);
  });

  it("no meio de uma marcação: a tentativa para (pediu a recepção) e a resposta vem com \"Resolvido?\"", async () => {
    const phone = "+5584991337081";
    await say(phone, "Oi");
    await say(phone, "1");
    await say(phone, "1");
    await say(phone, "atendente");
    const reply = await say(phone, "qual o endereço?");
    expect(reply.at(-1)!.body).toBe(AFTER_RECEPTION);
    const { data } = await adminClient().from("bot_funnel_events").select("step, metadata").eq("clinic_id", f.clinicId).eq("contact_phone", phone).eq("flow", "booking").eq("step", "abandoned");
    expect(data![0].metadata).toMatchObject({ reason: "reception_requested" });
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

  it("dúvida com \"Resolvido\": resolvida; \"Voltar ao menu\": inconclusiva, sem confirmação", async () => {
    const r = await reportFor(["+5584991337060", "+5584991337061"]);
    expect(type(r, "duvida")).toMatchObject({ total: 2, resolved: 1, inconclusive: 1 });
    expect(r).toMatchObject({ unconfirmed: 1, rate: 0.5 });
  });

  it("resolvida no pedido de recepção: sem transferência; \"Falar com a recepção\" depois da resposta: recepção, contada uma vez", async () => {
    const r = await reportFor(["+5584991337072", "+5584991337073"]);
    expect(type(r, "duvida")).toMatchObject({ total: 2, resolved: 1, human: 1 });
    expect(type(r, "recepcao").total).toBe(0);
  });

  it("sem resposta segura e pedido insistente: pedidos de recepção, com a recepção", async () => {
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
