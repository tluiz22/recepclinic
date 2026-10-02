// Respostas ao lembrete com botões (Fase 19 · etapa 5) — funções puras, lidas
// de `whatsapp_messages`: cada lembrete enviado (`appointment_reminder`) e
// cada toque válido num botão (`reminder_confirm|reschedule|cancel`, marcado
// pelo bot na mensagem recebida, com o `appointment_id`). Não usa
// `appointments.reminder_response`, que a remarcação zera.

export interface ReminderSentRow {
  appointment_id: string | null;
  created_at: string;
}

export interface ReminderTapRow {
  appointment_id: string | null;
  message_type: string; // "reminder_confirm" | "reminder_reschedule" | "reminder_cancel"
  created_at: string;
}

export type ReminderOutcome = "confirmed" | "reschedule" | "cancel" | "noResponse";

export interface ReminderResponseItem {
  appointmentId: string;
  sentAt: string;
  outcome: ReminderOutcome;
}

export interface ReminderResponseReport {
  sent: number;
  confirmed: number;
  reschedule: number;
  cancel: number;
  noResponse: number;
  // Um por atendimento lembrado, com a resposta (lista ao tocar num cartão,
  // Fase 23 · etapa 4).
  items: ReminderResponseItem[];
}

const OUTCOME_BY_TYPE: Record<string, "confirmed" | "reschedule" | "cancel"> = {
  reminder_confirm: "confirmed",
  reminder_reschedule: "reschedule",
  reminder_cancel: "cancel",
};

// Uma linha por atendimento lembrado no período (Fase 23: o mesmo
// atendimento pode receber mais de um lembrete no dia — automático e
// "Enviar/Reenviar lembrete" — e deve aparecer uma vez só, com a situação
// mais recente). Resposta = último toque no atendimento depois do primeiro
// lembrete do período e antes de um lembrete seguinte fora dele (remarcado
// para outro dia recebe outro lembrete). Sem toque = não respondeu (o bot já
// recusa toques depois do horário do atendimento, então não há corte extra
// por data). `reminders` = os do período; `allReminders` inclui os
// posteriores, só para saber onde termina a janela.
export function buildReminderResponseReport(
  reminders: ReminderSentRow[],
  allReminders: ReminderSentRow[],
  taps: ReminderTapRow[]
): ReminderResponseReport {
  const report: ReminderResponseReport = {
    sent: 0,
    confirmed: 0,
    reschedule: 0,
    cancel: 0,
    noResponse: 0,
    items: [],
  };

  const remindersInPeriod = groupByAppointment(reminders);
  const remindersByAppointment = groupByAppointment(allReminders);
  const tapsByAppointment = groupByAppointment(taps);

  for (const [appointmentId, sentRows] of remindersInPeriod) {
    report.sent += 1;

    const firstSentAt = Date.parse(sentRows[0].created_at);
    const lastSent = sentRows[sentRows.length - 1];
    const lastSentAt = Date.parse(lastSent.created_at);
    const nextReminder = (remindersByAppointment.get(appointmentId) ?? [])
      .map((row) => Date.parse(row.created_at))
      .find((time) => time > lastSentAt);
    const windowEnd = nextReminder ?? Number.POSITIVE_INFINITY;

    const lastTap = (tapsByAppointment.get(appointmentId) ?? [])
      .filter((tap) => {
        const time = Date.parse(tap.created_at);
        return time > firstSentAt && time < windowEnd && OUTCOME_BY_TYPE[tap.message_type];
      })
      .at(-1);

    const outcome: ReminderOutcome = lastTap ? OUTCOME_BY_TYPE[lastTap.message_type] : "noResponse";
    report[outcome] += 1;
    report.items.push({ appointmentId, sentAt: lastSent.created_at, outcome });
  }

  return report;
}

function groupByAppointment<T extends { appointment_id: string | null; created_at: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    if (!row.appointment_id) continue;
    const list = map.get(row.appointment_id) ?? [];
    list.push(row);
    map.set(row.appointment_id, list);
  }
  return map;
}
