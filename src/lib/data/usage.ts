import type { DbClient } from "./clients";
import { unwrap } from "./errors";

// Contadores de uso por clínica e mês (F9.5, L49): sem cobrança, só para o
// Suporte acompanhar. Gravados pelos gatilhos (clinic_usage_monthly); o RLS
// deixa o Suporte e o Administrador da clínica lerem.

export type MonthlyUsage = {
  clinicId: string;
  /** "YYYY-MM-01", no fuso da clínica. */
  month: string;
  appointmentsCreated: number;
  /** Mensagens que saíram (aceitas pela Meta). */
  messagesSent: number;
  /** Dessas, os templates: a Meta cobra da clínica. */
  templatesSent: number;
  /** Vezes que um limite do contato barrou o bot (F9.6a). */
  botLimitHits: number;
};

/** Meses desde `fromMonth` ("YYYY-MM-01"), de todas as clínicas que o login vê. */
export async function listMonthlyUsage(db: DbClient, fromMonth: string): Promise<MonthlyUsage[]> {
  const rows = unwrap(
    await db
      .from("clinic_usage_monthly")
      .select("clinic_id, month, appointments_created, messages_sent, templates_sent, bot_limit_hits")
      .gte("month", fromMonth)
      .order("month", { ascending: false }),
    "Uso por clínica",
  );
  return rows.map((row) => ({
    clinicId: row.clinic_id,
    month: row.month,
    appointmentsCreated: row.appointments_created,
    messagesSent: row.messages_sent,
    templatesSent: row.templates_sent,
    botLimitHits: row.bot_limit_hits,
  }));
}

/** Os últimos `count` meses, do atual para trás ("YYYY-MM-01"). */
export function lastMonths(today: string, count: number): string[] {
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
  });
}
