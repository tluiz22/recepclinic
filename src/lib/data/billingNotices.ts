import { formatCalendarDate, formatInstant } from "../clinicTime";
import { billingNoticeEmail, EmailNotConfiguredError, type EmailSender } from "../email";
import { formatCentsBRL } from "../money";
import type { BillingNoticeStore } from "./platform";

// Envio dos avisos de cobrança (F12.7; fluxo 6 do planejamento-faturamento-
// saas.md): na hora de enviar, confere de novo (cobrança paga ou cancelada
// cancela o aviso de atraso); e-mail ao financeiro; falha volta até 5 vezes.

const WHAT: Record<string, string> = { monthly: "Mensalidade", setup: "Implantação", other: "Cobrança" };

/** 15º dia de atraso: a partir dele a clínica pode ser suspensa (item 20). */
export function suspendFromDate(dueDate: string): string {
  const day = new Date(`${dueDate}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 15);
  return day.toISOString().slice(0, 10);
}

export type NoticesSummary = { sent: number; canceled: number; failed: number };

export async function sendBillingNotices(
  store: BillingNoticeStore,
  { sendEmail, panelLink }: { sendEmail: EmailSender; panelLink: string },
  limit = 100,
): Promise<NoticesSummary> {
  const summary: NoticesSummary = { sent: 0, canceled: 0, failed: 0 };
  for (const notice of await store.openNotices(limit)) {
    const overdue = notice.kind !== "payment_confirmed";
    if (overdue && notice.chargeStatus !== "pending" && notice.chargeStatus !== "overdue") {
      await store.finishNotice(notice.id, "canceled", null, null);
      summary.canceled++;
      continue;
    }
    if (!notice.financeEmail) {
      await store.finishNotice(notice.id, "failed", null, "sem e-mail financeiro");
      summary.failed++;
      continue;
    }
    const date = (value: string) => formatCalendarDate(value, "dd/MM/yyyy");
    try {
      await sendEmail(
        billingNoticeEmail(notice.financeEmail, {
          kind: notice.kind,
          clinicName: notice.clinicName,
          what: WHAT[notice.chargeKind] ?? "Cobrança",
          amount: formatCentsBRL(notice.valueCents),
          dueDate: date(notice.dueDate),
          suspendFrom: date(suspendFromDate(notice.dueDate)),
          paidOn: notice.paidAt ? formatInstant(new Date(notice.paidAt), "America/Sao_Paulo", "dd/MM/yyyy") : null,
          payLink: notice.invoiceUrl,
          panelLink,
        }),
      );
      await store.finishNotice(notice.id, "sent", notice.financeEmail, null);
      summary.sent++;
    } catch (error) {
      const reason = error instanceof EmailNotConfiguredError ? "envio de e-mail não configurado" : error instanceof Error ? error.message : String(error);
      await store.finishNotice(notice.id, "failed", notice.financeEmail, reason);
      summary.failed++;
    }
  }
  return summary;
}
