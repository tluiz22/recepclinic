import type { DbClient } from "./clients";
import { DataError, fromDbError, unwrap, unwrapOne, Validation, cleanText } from "./errors";
import { isCalendarDate } from "../clinicTime";

// Preços da Meta e contagem das mensagens por categoria (CU2; plano da Central, seção 14; tela P1, cliente,
// 05/nov/2026). Desde 01/out/2026 a Meta cobra cada mensagem que sai pela API: modelos (utilidade) sempre, e as de
// serviço (assistente, avisos) acima da franquia do mês; respostas pelo app do WhatsApp são grátis. Tudo aqui é
// estimativa: a fatura oficial fica no Gerenciador do WhatsApp da clínica.

export type MetaPriceVersion = {
  id: string;
  /** "YYYY-MM-DD": a partir de quando vale. */
  validFrom: string;
  utilityBrl: number;
  authenticationBrl: number;
  serviceBrl: number;
  freeServicePerMonth: number;
  /** Reais por dólar (só a calculadora usa). */
  usdBrl: number;
  source: string;
  createdAt: Date;
  createdBy: string | null;
};

export type MetaPriceInput = {
  validFrom: string;
  utilityBrl: string;
  authenticationBrl: string;
  serviceBrl: string;
  freeServicePerMonth: string;
  usdBrl: string;
  source: string;
};

export type MessageCounts = {
  clinicId: string;
  /** "YYYY-MM-01", no fuso da clínica. */
  month: string;
  /** Modelos (confirmação, lembrete, teste…): cobrados pelo preço de utilidade. */
  templates: number;
  /** Texto livre do RecepClinic (assistente, avisos): cobrado acima da franquia. */
  service: number;
  /** Respostas pelo app do WhatsApp: grátis. */
  appReplies: number;
};

export type MonthEstimate = {
  /** Mensagens de serviço acima da franquia. */
  chargedService: number;
  /** Valor estimado em reais; null = mês antes da primeira vigência. */
  totalBrl: number | null;
};

/** Vigências, da mais nova para a mais antiga. */
export async function listMetaPriceVersions(db: DbClient): Promise<MetaPriceVersion[]> {
  const rows = unwrap(
    await db
      .from("meta_price_versions")
      .select("id, valid_from, utility_brl, authentication_brl, service_brl, free_service_per_month, usd_brl, source, created_at, created_by")
      .order("valid_from", { ascending: false }),
    "Preços da Meta",
  );
  return rows.map((row) => ({
    id: row.id,
    validFrom: row.valid_from,
    utilityBrl: Number(row.utility_brl),
    authenticationBrl: Number(row.authentication_brl),
    serviceBrl: Number(row.service_brl),
    freeServicePerMonth: row.free_service_per_month,
    usdBrl: Number(row.usd_brl),
    source: row.source,
    createdAt: new Date(row.created_at),
    createdBy: row.created_by,
  }));
}

/** Número digitado com vírgula ou ponto ("0,0350", "5.15"); NaN se não for número. */
export function parseDecimal(raw: string): number {
  const text = raw.trim();
  if (!/^\d+([.,]\d+)?$/.test(text)) return Number.NaN;
  return Number(text.replace(",", "."));
}

/** Confere a vigência nova (o mês mínimo, o atual, o banco também confere). */
export function validateMetaPrice(input: MetaPriceInput, today: string) {
  const currentMonth = `${today.slice(0, 7)}-01`;
  const v = new Validation();
  const price = (raw: string) => parseDecimal(raw);
  const values = {
    // A tela manda o mês ("YYYY-MM"); a vigência começa no dia 1º.
    validFrom: /^\d{4}-\d{2}$/.test(input.validFrom.trim()) ? `${input.validFrom.trim()}-01` : input.validFrom.trim(),
    utilityBrl: price(input.utilityBrl),
    authenticationBrl: price(input.authenticationBrl),
    serviceBrl: price(input.serviceBrl),
    freeServicePerMonth: Number(input.freeServicePerMonth.trim()),
    usdBrl: price(input.usdBrl),
    source: cleanText(input.source) ?? "",
  };
  v.check(isCalendarDate(values.validFrom) && values.validFrom.endsWith("-01"), "valid_from", "Informe o mês.");
  v.check(!isCalendarDate(values.validFrom) || values.validFrom >= currentMonth, "valid_from", "A vigência começa no mês atual ou depois: os meses passados ficam com o preço da época.");
  for (const [field, value] of [
    ["utility_brl", values.utilityBrl],
    ["authentication_brl", values.authenticationBrl],
    ["service_brl", values.serviceBrl],
  ] as const) {
    v.check(Number.isFinite(value) && value >= 0 && value < 1000000, field, "Informe o preço em reais (ex.: 0,0350).");
  }
  v.check(Number.isInteger(values.freeServicePerMonth) && values.freeServicePerMonth >= 0 && input.freeServicePerMonth.trim() !== "", "free_service_per_month", "Informe um número inteiro (ex.: 1000).");
  v.check(Number.isFinite(values.usdBrl) && values.usdBrl > 0 && values.usdBrl < 10000, "usd_brl", "Informe o câmbio (ex.: 5,15).");
  v.check(values.source.length >= 3 && values.source.length <= 300, "source", "Informe a fonte (de 3 a 300 caracteres).");
  v.throwIfInvalid("Preços da Meta");
  return values;
}

export async function createMetaPriceVersion(db: DbClient, input: MetaPriceInput, today: string): Promise<string> {
  const values = validateMetaPrice(input, today);
  const row = {
    valid_from: values.validFrom,
    utility_brl: values.utilityBrl,
    authentication_brl: values.authenticationBrl,
    service_brl: values.serviceBrl,
    free_service_per_month: values.freeServicePerMonth,
    usd_brl: values.usdBrl,
    source: values.source,
  };
  try {
    return unwrapOne(await db.from("meta_price_versions").insert(row).select("id").maybeSingle(), "Preços da Meta").id;
  } catch (error) {
    if (error instanceof DataError && error.code === "duplicate") {
      throw new DataError("duplicate", "Preços da Meta: já existe uma vigência nesta data", { valid_from: "Já existe uma vigência nesta data." });
    }
    throw error;
  }
}

/** Só uma vigência futura sai (o banco confere). */
export async function deleteMetaPriceVersion(db: DbClient, id: string): Promise<void> {
  unwrapOne(await db.from("meta_price_versions").delete().eq("id", id).select("id").maybeSingle(), "Vigência futura");
}

/** Vigência que vale no mês ("YYYY-MM-01"): a mais nova que começou até ele (vigência sempre no dia 1º). */
export function priceForMonth(versions: MetaPriceVersion[], month: string): MetaPriceVersion | null {
  return [...versions].sort((a, b) => b.validFrom.localeCompare(a.validFrom)).find((version) => version.validFrom <= month) ?? null;
}

/** Valor estimado do mês: modelos × utilidade + serviço acima da franquia × serviço. */
export function estimateMonth(counts: Pick<MessageCounts, "templates" | "service">, price: MetaPriceVersion | null): MonthEstimate {
  if (!price) return { chargedService: 0, totalBrl: null };
  const chargedService = Math.max(0, counts.service - price.freeServicePerMonth);
  const total = counts.templates * price.utilityBrl + chargedService * price.serviceBrl;
  return { chargedService, totalBrl: Math.round(total * 100) / 100 };
}

/** Mensagens por categoria desde `fromMonth`, de todas as clínicas que o login vê (ou de uma). */
export async function listMessageCounts(db: DbClient, fromMonth: string, clinicId: string | null = null): Promise<MessageCounts[]> {
  const rows = unwrap(
    await db.rpc("meta_message_counts", { p_from: fromMonth, ...(clinicId ? { p_clinic_id: clinicId } : {}) }),
    "Mensagens por categoria",
  );
  return rows.map((row) => ({
    clinicId: row.clinic_id,
    month: row.month,
    templates: row.templates,
    service: row.service,
    appReplies: row.app_replies,
  }));
}

/** Mensagens de serviço do mês por origem (CU4, tela W2 "Ver detalhes"): as mesmas regras da `meta_message_counts`. */
export type ServiceSplit = { assistant: number; notices: number; central: number };

const SERVICE_AUTHORS = { assistant: "bot", notices: "system", central: "agent_panel" } as const;

/** Divide as mensagens de serviço de `[start, end)` entre assistente, avisos de texto e Central. */
export async function countServiceByOrigin(db: DbClient, clinicId: string, start: Date, end: Date): Promise<ServiceSplit> {
  const entries = await Promise.all(
    (Object.entries(SERVICE_AUTHORS) as [keyof ServiceSplit, string][]).map(async ([key, author]) => {
      const { count, error } = await db
        .from("whatsapp_messages")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("direction", "outbound")
        .eq("author", author)
        .is("template_name", null)
        .not("message_type", "in", "(agent_reply,app_auto_reply)")
        // Saiu: nem falha, nem pulada (status vazio conta, como no banco).
        .or("status.is.null,and(status.neq.failed,status.not.like.skipped*)")
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString());
      if (error) throw fromDbError(error, "Mensagens por origem");
      return [key, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries) as ServiceSplit;
}
