import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

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
  it("pergunta da base: boas-vindas, a resposta e o menu (cliente, 31/out/2026)", async () => {
    const reply = await say("+5584991337001", "Oi, vocês aceitam Unimed?");
    expect(bodies(reply)).toEqual(["Olá! 👋 Aqui é da Clínica Base.", "Sim, atendemos *Unimed*.", MENU]);
  });

  it("só \"oi\": boas-vindas e menu, como hoje", async () => {
    const reply = await say("+5584991337002", "Oi");
    expect(bodies(reply)).toEqual(["Olá! 👋 Aqui é da Clínica Base.", MENU]);
  });
});

describe("no menu", () => {
  const phone = "+5584991337010";

  it("responde e repete o menu, sem \"não entendi\" e sem contar", async () => {
    await say(phone, "Oi");
    const reply = await say(phone, "qual o endereço?");
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
    expect(reply.at(-1)).toMatchObject({ kind: "buttons", body: "Sim, fazemos *Exame*." });
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

  it("com a Lista de espera: abre o \"Encaixe ou antecipar\"", async () => {
    await say(phone, "Oi");
    const reply = await say(phone, "Preciso de um encaixe");
    // Número sem atendimento marcado: a resposta de hoje do encaixe, com Marcar.
    expect(reply.at(-1)!.body).toContain("A lista de espera serve para antecipar um horário já marcado");
    await reset(phone);
    const other = await say(phone, "consigo um encaixe?");
    expect(other.at(-1)!.body).toContain("A lista de espera serve para antecipar");
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
