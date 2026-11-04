import type { FeatureKey } from "../features";
import { GUIDE_AUTOMATIONS_ANCHOR, GUIDE_BEFORE_CONNECT_PATH, GUIDE_META_PAYMENT_PATH } from "../guides";
import type { DbClient } from "./clients";
import { loadSetupStatus } from "./config/setup";
import { DataError, unwrap } from "./errors";
import { getWhatsappConnection, listWhatsappTemplates } from "./whatsapp/connection";
import { getDeliveredConnectionTest, getLatestConnectionTest } from "./whatsapp/connectionTest";
import { APP_AUTO_REPLY_TYPE } from "./whatsapp/conversations";
import { templateApproval, templatesInUse, describeTemplateApproval } from "./whatsapp/templates";
import { describeSendFailure } from "../whatsappErrors";

// Checklist de implantação (IS3; cliente, 03/nov/2026; docs/implantacao-segura.md): o que precisa estar pronto para
// ativar a clínica, na Situação (Sistema › Clínicas › clínica). Itens que o sistema confere sozinho e itens que o
// Suporte marca (`clinic_onboarding_checks`). Obrigatórios bloqueiam "Ativar a clínica" (tela, rota e banco:
// app.clinic_activation_missing); recomendados não. O teste do bot fica para depois de ativar: em implantação o bot
// não responde.

export type ManualItemKey =
  | "contract"
  | "facebook_login"
  | "whatsapp_business"
  | "automations_off"
  | "card_default"
  | "agenda_import"
  | "business_verification"
  | "support_number";

export type ChecklistGroup = "Antes da conexão" | "Clínica no sistema" | "WhatsApp e Meta" | "Depois de ativar";

export type ChecklistItem = {
  key: string;
  group: ChecklistGroup;
  label: string;
  /** "manual" = o Suporte marca; "auto" = o sistema confere. */
  kind: "manual" | "auto";
  required: boolean;
  done: boolean;
  /** Situação ou motivo (ex.: "2 em análise", o motivo da falha do teste). */
  detail?: string;
  /** Quando o Suporte marcou. */
  checkedAt?: Date | null;
  /** Guia com o passo a passo. */
  link?: { label: string; href: string };
};

type ManualDefinition = { key: ManualItemKey; group: ChecklistGroup; label: string; required: boolean; link?: ChecklistItem["link"] };

export const MANUAL_ITEMS: ManualDefinition[] = [
  { key: "contract", group: "Antes da conexão", label: "Contrato e termo de tratamento de dados assinados; implantação paga ou isenta", required: true },
  { key: "facebook_login", group: "Antes da conexão", label: "Login do Facebook do Administrador funcionando (senha e código)", required: true },
  { key: "whatsapp_business", group: "Antes da conexão", label: "Número no app WhatsApp Business, atualizado, com perfil comercial", required: true },
  {
    key: "automations_off",
    group: "Antes da conexão",
    label: "Mensagens automáticas do app desligadas (saudação, ausência e Meta Business Suite, inclusive as do horário comercial), conferidas por print",
    required: true,
    link: { label: "Guia", href: `${GUIDE_BEFORE_CONNECT_PATH}#${GUIDE_AUTOMATIONS_ANCHOR}` },
  },
  { key: "agenda_import", group: "Clínica no sistema", label: "Agenda atual importada (ou a clínica não tinha consultas marcadas)", required: false },
  {
    key: "card_default",
    group: "WhatsApp e Meta",
    label: "Cartão cadastrado e definido como padrão na conta do WhatsApp da clínica",
    required: true,
    link: { label: "Guia", href: GUIDE_META_PAYMENT_PATH },
  },
  {
    key: "business_verification",
    group: "WhatsApp e Meta",
    label: "Verificação da empresa iniciada na Meta (sem ela, ~250 conversas iniciadas pela clínica por dia)",
    required: false,
    link: { label: "Guia", href: `${GUIDE_BEFORE_CONNECT_PATH}#verificacao` },
  },
  {
    key: "support_number",
    group: "Depois de ativar",
    label: "Número do Suporte do RecepClinic explicado à clínica (ele não fala com o bot: testar de outro número)",
    required: false,
  },
];

export const MANUAL_KEYS = new Set<string>(MANUAL_ITEMS.map((i) => i.key));

export const CHECKLIST_GROUPS: ChecklistGroup[] = ["Antes da conexão", "Clínica no sistema", "WhatsApp e Meta", "Depois de ativar"];

export type OnboardingChecklist = { items: ChecklistItem[]; missingRequired: ChecklistItem[] };

/** Ordem de cada item dentro do grupo: os do Suporte e os automáticos na ordem do roteiro. */
const ORDER = [
  "contract",
  "facebook_login",
  "whatsapp_business",
  "automations_off",
  "invite_accepted",
  "setup_complete",
  "agenda_import",
  "whatsapp_connected",
  "templates_approved",
  "card_default",
  "test_delivered",
  "business_verification",
  "bot_test",
  "support_number",
];

/** IS4: mensagem automática do app depois da conexão (o teste do bot não fica feito). */
async function automaticEchoSince(db: DbClient, clinicId: string, since: Date | null): Promise<boolean> {
  let query = db.from("whatsapp_messages").select("id").eq("clinic_id", clinicId).eq("message_type", APP_AUTO_REPLY_TYPE).limit(1);
  if (since) query = query.gte("created_at", since.toISOString());
  return unwrap(await query, "Mensagens do WhatsApp").length > 0;
}

/** O teste do bot: o bot respondeu alguém (fora do número do Suporte) depois da conexão. */
async function botAnswered(db: DbClient, clinicId: string, since: Date | null, supportPhone: string | null): Promise<boolean> {
  let query = db
    .from("whatsapp_messages")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("direction", "outbound")
    .like("message_type", "bot_%")
    .limit(1);
  if (since) query = query.gte("created_at", since.toISOString());
  if (supportPhone) query = query.neq("contact_phone", supportPhone);
  return unwrap(await query, "Mensagens do WhatsApp").length > 0;
}

export async function loadOnboardingChecklist(
  db: DbClient,
  clinicId: string,
  features: readonly FeatureKey[],
  { supportPhone = null }: { supportPhone?: string | null } = {},
): Promise<OnboardingChecklist> {
  const [checks, invitations, setup, connection, templates, delivered, lastTest] = await Promise.all([
    db.from("clinic_onboarding_checks").select("item_key, checked_at").eq("clinic_id", clinicId),
    db.from("clinic_invitations").select("roles, accepted_at").eq("clinic_id", clinicId),
    loadSetupStatus(db, clinicId, features),
    getWhatsappConnection(db, clinicId),
    listWhatsappTemplates(db, clinicId),
    getDeliveredConnectionTest(db, clinicId),
    getLatestConnectionTest(db, clinicId),
  ]);
  const marked = new Map((unwrap(checks, "Checklist de implantação") as { item_key: string; checked_at: string }[]).map((c) => [c.item_key, new Date(c.checked_at)]));
  const connected = connection?.status === "connected";
  const approval = templateApproval(templatesInUse(features), templates);
  const templatesText = describeTemplateApproval(approval);
  const adminAccepted = (unwrap(invitations, "Convites") as { roles: string[]; accepted_at: string | null }[]).some(
    (i) => i.roles.includes("admin") && i.accepted_at,
  );
  const failure = !delivered && lastTest?.status === "failed" ? describeSendFailure(lastTest.failureCode, lastTest.failureReason) : null;

  const items: ChecklistItem[] = [
    ...MANUAL_ITEMS.map(
      (def): ChecklistItem => ({ ...def, kind: "manual", done: marked.has(def.key), checkedAt: marked.get(def.key) ?? null }),
    ),
    {
      key: "invite_accepted",
      group: "Clínica no sistema",
      label: "Convite do Administrador aceito (ele já entrou no painel)",
      kind: "auto",
      required: true,
      done: adminAccepted,
    },
    {
      key: "setup_complete",
      group: "Clínica no sistema",
      label: "Configuração mínima: o guia do Início completo (profissional, local, agenda, serviços e horários)",
      kind: "auto",
      required: true,
      done: setup.complete,
    },
    {
      key: "whatsapp_connected",
      group: "WhatsApp e Meta",
      label: "WhatsApp conectado",
      kind: "auto",
      required: true,
      done: connected,
      detail: connection ? undefined : "ainda não conectado",
    },
    {
      key: "templates_approved",
      group: "WhatsApp e Meta",
      label: "Mensagens automáticas aprovadas na Meta",
      kind: "auto",
      required: true,
      done: connected && !templatesText,
      detail: connected && templatesText ? templatesText : undefined,
    },
    {
      key: "test_delivered",
      group: "WhatsApp e Meta",
      label: "Mensagem de teste entregue (Configurações › WhatsApp)",
      kind: "auto",
      required: true,
      done: !!delivered,
      detail: failure ? `${failure.title} ${failure.action}` : !delivered && lastTest ? "enviada, ainda sem confirmação de entrega" : undefined,
      link: failure?.guide ? { label: "Guia", href: failure.guide } : undefined,
    },
    {
      key: "bot_test",
      group: "Depois de ativar",
      label: "Teste do bot de outro número (não o do Suporte): o bot respondeu e nenhuma mensagem do app saiu sozinha",
      kind: "auto",
      required: false,
      ...(await (async () => {
        if (!connected) return { done: false };
        const since = connection?.connectedAt ?? null;
        const [answered, automatic] = await Promise.all([botAnswered(db, clinicId, since, supportPhone), automaticEchoSince(db, clinicId, since)]);
        return automatic
          ? { done: false, detail: "o app mandou uma mensagem automática: desligue a saudação e a ausência" }
          : { done: answered };
      })()),
    },
  ];
  items.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  return { items, missingRequired: items.filter((i) => i.required && !i.done) };
}

/** Suporte: marca ou desmarca um item da checklist (o banco recusa quem não é do Suporte). */
export async function setOnboardingCheck(db: DbClient, clinicId: string, key: string, checked: boolean, actorId: string, now: Date = new Date()): Promise<void> {
  if (!MANUAL_KEYS.has(key)) throw new DataError("invalid", "Checklist: item desconhecido", { item: "Item desconhecido." });
  if (checked) {
    unwrap(
      await db
        .from("clinic_onboarding_checks")
        .upsert({ clinic_id: clinicId, item_key: key, checked_by: actorId, checked_at: now.toISOString() }, { onConflict: "clinic_id,item_key" }),
      "Checklist de implantação",
    );
  } else {
    unwrap(await db.from("clinic_onboarding_checks").delete().eq("clinic_id", clinicId).eq("item_key", key), "Checklist de implantação");
  }
}
