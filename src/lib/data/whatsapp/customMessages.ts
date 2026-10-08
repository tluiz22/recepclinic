import type { DbClient } from "../clients";
import { DataError, unwrap, unwrapOne, Validation } from "../errors";
import { getWhatsappAccessToken, getWhatsappConnection, listWhatsappTemplates, type TemplateKey, type WhatsappTemplate } from "./connection";
import { createTemplate, GraphRequestError, type Fetcher } from "./graph";
import { DEFAULT_TEMPLATES, defaultTemplate, TEMPLATE_LANGUAGE, templateCreationPayload } from "./templates";

// Mensagens personalizadas (F6.6; D3b revista, cliente 05 e 07/out/2026),
// com o item "Mensagens personalizadas" da matriz, só pelo Administrador da
// clínica:
// - conversa do bot: texto próprio com marcadores ({nome}, {paciente}…), vale
//   na hora; sem texto próprio (ou sem o item), o padrão;
// - templates: o Administrador propõe o texto com as mesmas variáveis, na
//   mesma ordem (marcadores); o Suporte aprova e envia à Meta como versão
//   nova (pela API) ou recusa com o motivo. O envio usa a versão aprovada
//   mais nova (getApprovedTemplate).

// ---------------------------------------------------------------------------
// Marcadores dos templates ({{1}}, {{2}}… na ordem do padrão)
// ---------------------------------------------------------------------------

const APPOINTMENT_MARKERS = ["nome", "clinica", "servico", "paciente", "data", "local"];

export const TEMPLATE_MARKERS: Partial<Record<TemplateKey, string[]>> = {
  confirmation: APPOINTMENT_MARKERS,
  reschedule: APPOINTMENT_MARKERS,
  reminder: APPOINTMENT_MARKERS,
  cancellation: APPOINTMENT_MARKERS.slice(0, 5),
  clinic_cancellation: ["nome", "clinica", "paciente", "servico", "data", "link"],
  exam_preparation: ["nome", "clinica", "exame", "link"],
  consultation_guidance: ["nome", "clinica", "paciente", "link"],
  daily_summary_consultations: ["nome", "clinica", "data", "lista"],
  daily_summary_exams: ["nome", "clinica", "data", "lista"],
  daily_summary_consultations_today: ["nome", "clinica", "data", "lista"],
  daily_summary_exams_today: ["nome", "clinica", "data", "lista"],
  waitlist_offer: ["nome", "clinica", "tipo", "paciente", "vaga", "atual"],
};

export const MARKER_LABELS: Record<string, string> = {
  nome: "primeiro nome de quem recebe",
  clinica: '"da/do" e o nome da clínica',
  servico: "serviço (com o profissional)",
  paciente: "nome do paciente",
  data: "dia e hora",
  local: "local e endereço",
  link: "link",
  exame: "nome do exame",
  atendimento: '"a consulta", "o retorno", "o exame…"',
  lista: "lista dos atendimentos (uma linha)",
  tipo: '"consulta", "retorno" ou "exame…"',
  vaga: "dia, hora e local da vaga",
  atual: "dia e hora marcados hoje",
};

/** Texto do template com marcadores ({nome}…) para editar. */
export function templateToMarkers(key: TemplateKey, body: string): string {
  const markers = TEMPLATE_MARKERS[key] ?? [];
  return body.replace(/\{\{(\d+)\}\}/g, (match, n: string) => (markers[Number(n) - 1] ? `{${markers[Number(n) - 1]}}` : match));
}

/**
 * Texto proposto → corpo do template ({{1}}…). Cada marcador do padrão uma
 * vez, na mesma ordem (D3b), sem outros marcadores; a Meta recusa corpo que
 * começa ou termina com variável.
 */
export function markersToTemplate(key: TemplateKey, text: string): string {
  const markers = TEMPLATE_MARKERS[key];
  const v = new Validation();
  const clean = text.replace(/\r\n/g, "\n").trim();
  v.check(!!markers, "key", "Esta mensagem não pode ser personalizada");
  v.check(clean.length > 0 && clean.length <= 1024, "text", "Escreva o texto (até 1024 caracteres)");
  const found = [...clean.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
  const unknown = found.filter((m) => !markers?.includes(m));
  v.check(unknown.length === 0, "text", `Marcador desconhecido: ${unknown.map((m) => `{${m}}`).join(", ")}`);
  const missing = (markers ?? []).filter((m) => !found.includes(m));
  v.check(missing.length === 0, "text", `Falta: ${missing.map((m) => `{${m}}`).join(", ")}`);
  const repeated = (markers ?? []).filter((m) => found.filter((f) => f === m).length > 1);
  v.check(repeated.length === 0, "text", `Use cada marcador uma vez só: ${repeated.map((m) => `{${m}}`).join(", ")}`);
  v.check(
    unknown.length > 0 || missing.length > 0 || repeated.length > 0 || found.join(",") === (markers ?? []).join(","),
    "text",
    `Os marcadores precisam ficar nesta ordem: ${(markers ?? []).map((m) => `{${m}}`).join(", ")}`,
  );
  v.check(!/^\{/.test(clean) && !/\}$/.test(clean), "text", "O texto não pode começar nem terminar com um marcador (regra da Meta)");
  v.throwIfInvalid("Mensagem");
  return clean.replace(/\{([^{}]*)\}/g, (_match, m: string) => `{{${markers!.indexOf(m) + 1}}}`);
}

// ---------------------------------------------------------------------------
// Conversa do bot
// ---------------------------------------------------------------------------

export type BotMessageKey = "welcome" | "menu" | "not_understood" | "handoff" | "booking_link" | "cancel_done" | "presence_confirmed" | "idle_closed";

export type BotMessageDef = {
  key: BotMessageKey;
  label: string;
  /** Marcadores que o texto pode usar. */
  markers: string[];
  /** Marcadores obrigatórios (ex.: o link na mensagem do link). */
  required: string[];
  /** Texto padrão com marcadores, para começar a edição. */
  defaultText: string;
};

export const BOT_MESSAGES: BotMessageDef[] = [
  { key: "welcome", label: "Boas-vindas", markers: ["clinica"], required: [], defaultText: "Olá! 👋 Aqui é {clinica}." },
  { key: "menu", label: "Menu", markers: [], required: [], defaultText: "Como podemos ajudar? Escolha uma opção abaixo (ou digite o número)." },
  {
    key: "not_understood",
    label: "Não entendi",
    markers: [],
    required: [],
    defaultText: "Não entendi sua resposta 🙏 Escolha uma das opções abaixo (ou digite 0 para voltar ao menu principal).",
  },
  {
    key: "handoff",
    label: "Falar com a recepção",
    markers: [],
    required: [],
    defaultText: "Combinado! Vou te transferir para a recepção, que responde por aqui assim que possível. O atendimento automático fica pausado até lá.",
  },
  {
    key: "booking_link",
    label: "Link para marcar",
    markers: ["servico", "paciente", "link"],
    required: ["link"],
    defaultText: "Prontinho! Escolha o melhor dia e horário para *{servico}* de {paciente} neste link:\n{link}\n\nO link vale por 30 minutos.",
  },
  {
    key: "cancel_done",
    label: "Cancelamento confirmado",
    markers: ["atendimento", "paciente", "data"],
    required: [],
    defaultText: "Prontinho, cancelamos {atendimento} de {paciente} marcado(a) para {data}. Se precisar marcar de novo, é só me chamar.",
  },
  {
    key: "presence_confirmed",
    label: "Presença confirmada",
    markers: ["paciente", "data"],
    required: [],
    defaultText: "Presença confirmada ✓\n\n👤 Paciente: {paciente}\n📅 {data}\n\nObrigado! Qualquer dúvida, é só chamar por aqui.",
  },
  {
    key: "idle_closed",
    label: "Conversa parada (15 minutos)",
    markers: [],
    required: [],
    defaultText: "Como não tivemos resposta nos últimos minutos, encerramos este atendimento. Quando quiser, é só mandar uma mensagem que começamos de novo. 😊",
  },
];

export const botMessageDef = (key: string) => BOT_MESSAGES.find((m) => m.key === key) ?? null;

/** Confere o texto da conversa: só os marcadores dele, com os obrigatórios. */
export function validateBotMessage(key: BotMessageKey, text: string): string {
  const def = botMessageDef(key);
  const v = new Validation();
  const clean = text.replace(/\r\n/g, "\n").trim();
  v.check(!!def, "key", "Mensagem desconhecida");
  v.check(clean.length > 0 && clean.length <= 1024, "text", "Escreva o texto (até 1024 caracteres)");
  const found = [...clean.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
  const unknown = found.filter((m) => !def?.markers.includes(m));
  v.check(unknown.length === 0, "text", `Marcador desconhecido: ${unknown.map((m) => `{${m}}`).join(", ")}`);
  const missing = (def?.required ?? []).filter((m) => !found.includes(m));
  v.check(missing.length === 0, "text", `Falta: ${missing.map((m) => `{${m}}`).join(", ")}`);
  v.throwIfInvalid("Mensagem");
  return clean;
}

/** Texto próprio com os valores no lugar dos marcadores. */
export function renderMarkers(text: string, values: Record<string, string>): string {
  return text.replace(/\{([^{}]*)\}/g, (match, m: string) => values[m] ?? match);
}

export async function listBotMessages(db: DbClient, clinicId: string): Promise<Map<BotMessageKey, string>> {
  const rows = unwrap(await db.from("bot_messages").select("message_key, body").eq("clinic_id", clinicId), "Mensagens do bot");
  return new Map(rows.map((r) => [r.message_key as BotMessageKey, r.body]));
}

export async function saveBotMessage(db: DbClient, clinicId: string, key: BotMessageKey, text: string, actorId: string | null): Promise<void> {
  const body = validateBotMessage(key, text);
  unwrap(
    await db.from("bot_messages").upsert({ clinic_id: clinicId, message_key: key, body, updated_by: actorId }, { onConflict: "clinic_id,message_key" }),
    "Mensagem do bot",
  );
}

export async function resetBotMessage(db: DbClient, clinicId: string, key: BotMessageKey): Promise<void> {
  unwrap(await db.from("bot_messages").delete().eq("clinic_id", clinicId).eq("message_key", key), "Mensagem do bot");
}

// ---------------------------------------------------------------------------
// Orientações gerais da consulta (cliente, 08/out/2026): texto da clínica,
// fora da matriz e sempre editável pelo Administrador; guardado com as falas
// do bot. O envio é ligado em Configurações › WhatsApp (guidance.ts envia).
// ---------------------------------------------------------------------------

export const GUIDANCE_KEY = "consultation_guidance";
export const GUIDANCE_MAX_LENGTH = 3500;

export async function getGuidance(db: DbClient, clinicId: string): Promise<string | null> {
  const row = unwrap(
    await db.from("bot_messages").select("body").eq("clinic_id", clinicId).eq("message_key", GUIDANCE_KEY).maybeSingle(),
    "Orientações gerais",
  );
  return row?.body ?? null;
}

export async function saveGuidance(db: DbClient, clinicId: string, text: string, actorId: string | null): Promise<void> {
  const body = text.replace(/\r\n/g, "\n").trim();
  const v = new Validation();
  v.check(body.length > 0, "text", "Escreva as orientações");
  v.check(body.length <= GUIDANCE_MAX_LENGTH, "text", `As orientações vão até ${GUIDANCE_MAX_LENGTH} caracteres`);
  v.throwIfInvalid("Orientações gerais");
  unwrap(
    await db.from("bot_messages").upsert({ clinic_id: clinicId, message_key: GUIDANCE_KEY, body, updated_by: actorId }, { onConflict: "clinic_id,message_key" }),
    "Orientações gerais",
  );
}

/** Apaga o texto; com o envio ligado, não deixa (o envio ficaria sem texto). */
export async function clearGuidance(db: DbClient, clinicId: string): Promise<void> {
  const settings = unwrapOne(await db.from("clinic_settings").select("guidance_enabled").eq("clinic_id", clinicId).maybeSingle(), "Configuração da clínica");
  if (settings.guidance_enabled) {
    throw new DataError("invalid", "Orientações gerais: desligue o envio em Configurações › WhatsApp antes de apagar o texto", {
      text: "Desligue o envio em Configurações › WhatsApp antes de apagar o texto.",
    });
  }
  unwrap(await db.from("bot_messages").delete().eq("clinic_id", clinicId).eq("message_key", GUIDANCE_KEY), "Orientações gerais");
}

// ---------------------------------------------------------------------------
// Propostas de template
// ---------------------------------------------------------------------------

/** Versões de um template, da mais nova para a mais antiga. */
export async function templateVersions(db: DbClient, clinicId: string, key: TemplateKey): Promise<WhatsappTemplate[]> {
  return (await listWhatsappTemplates(db, clinicId)).filter((t) => t.key === key).sort((a, b) => b.version - a.version);
}

/** Administrador: propõe um texto (versão nova "aguardando o Suporte"); uma proposta aberta por vez. */
export async function proposeTemplate(db: DbClient, clinicId: string, key: TemplateKey, text: string, actorId: string | null, now: Date = new Date()): Promise<void> {
  const body = markersToTemplate(key, text);
  const versions = await templateVersions(db, clinicId, key);
  if (versions.some((t) => t.stage === "proposed")) {
    throw new DataError("conflict", "Mensagem: já há uma proposta aguardando o Suporte; retire-a antes de propor outra", {
      text: "Já há uma proposta aguardando o Suporte.",
    });
  }
  const version = Math.max(1, ...versions.map((t) => t.version)) + 1;
  const base = defaultTemplate(key)?.name.replace(/_v\d+$/, "") ?? `rc_${key}`;
  unwrap(
    await db.from("whatsapp_templates").insert({
      clinic_id: clinicId,
      template_key: key,
      // Único na conta da Meta: prefixo da clínica e a versão.
      name: `${base}_${clinicId.replace(/-/g, "").slice(0, 6)}_v${version}`,
      language: TEMPLATE_LANGUAGE,
      status: "pending",
      stage: "proposed",
      version,
      body,
      proposed_by: actorId,
      proposed_at: now.toISOString(),
    }),
    "Proposta de mensagem",
  );
}

/** Administrador: retira a proposta que ainda não foi revisada. */
export async function withdrawProposal(db: DbClient, clinicId: string, key: TemplateKey): Promise<void> {
  unwrap(
    await db.from("whatsapp_templates").update({ stage: "declined", support_note: "Retirada pela clínica" }).eq("clinic_id", clinicId).eq("template_key", key).eq("stage", "proposed"),
    "Proposta de mensagem",
  );
}

/** Administrador: volta ao texto padrão (as versões próprias deixam de ser usadas). */
export async function resetTemplateToDefault(db: DbClient, clinicId: string, key: TemplateKey): Promise<void> {
  unwrap(
    await db.from("whatsapp_templates").update({ status: "disabled" }).eq("clinic_id", clinicId).eq("template_key", key).gt("version", 1).eq("stage", "meta"),
    "Mensagem",
  );
  await withdrawProposal(db, clinicId, key);
}

/** Suporte: recusa a proposta, com o motivo para o Administrador. */
export async function declineProposal(db: DbClient, clinicId: string, id: string, note: string): Promise<void> {
  const clean = note.trim();
  if (!clean) throw new DataError("invalid", "Proposta: escreva o motivo para a clínica", { note: "Escreva o motivo para a clínica." });
  unwrapOne(
    await db.from("whatsapp_templates").update({ stage: "declined", support_note: clean }).eq("clinic_id", clinicId).eq("id", id).eq("stage", "proposed").select("id").maybeSingle(),
    "Proposta de mensagem",
  );
}

/**
 * Suporte: aprova a proposta e cria a versão na conta da clínica (pela API,
 * como o "Criar na Meta"), com a credencial da clínica (só ela lê o token).
 * null = enviada; senão, o motivo.
 */
export async function approveAndSendProposal(serviceDb: DbClient, clinicId: string, id: string, fetcher: Fetcher = fetch): Promise<string | null> {
  const proposal = (await listWhatsappTemplates(serviceDb, clinicId)).find((t) => t.id === id && t.stage === "proposed");
  if (!proposal?.body) return "Proposta não encontrada (já revisada?).";
  const connection = await getWhatsappConnection(serviceDb, clinicId);
  const token = await getWhatsappAccessToken(serviceDb);
  if (!connection || !token) return "Cadastre a conexão e o token antes.";
  const standard = DEFAULT_TEMPLATES.find((t) => t.key === proposal.key)!;
  try {
    const created = await createTemplate(connection.wabaId, templateCreationPayload({ ...standard, name: proposal.name, body: proposal.body }), token, fetcher);
    unwrap(
      await serviceDb
        .from("whatsapp_templates")
        .update({ stage: "meta", status: "pending", meta_template_id: created.id || null })
        .eq("clinic_id", clinicId)
        .eq("id", id),
      "Proposta de mensagem",
    );
    return null;
  } catch (error) {
    if (error instanceof GraphRequestError) return error.message;
    throw error;
  }
}
