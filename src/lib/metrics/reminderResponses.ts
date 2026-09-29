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

export interface ReminderResponseReport {
  sent: number;
  confirmed: number;
  reschedule: number;
  cancel: number;
  noResponse: number;
}

const OUTCOME_BY_TYPE: Record<string, "confirmed" | "reschedule" | "cancel"> = {
  reminder_confirm: "confirmed",
  reminder_reschedule: "reschedule",
  reminder_cancel: "cancel",
};

// Resposta de um lembrete = último toque no mesmo atendimento depois dele e
// antes do lembrete seguinte desse atendimento (remarcado para dentro da
// janela recebe outro lembrete). Vale o último toque, como em
// `reminder_response`. Sem toque = não respondeu (o bot já recusa toques
// depois do horário do atendimento, então não há corte extra por data).
// `reminders` = os do mês; `allReminders` inclui os posteriores, só para
// saber onde termina a janela de cada um.
export function buildReminderResponseReport(
  reminders: ReminderSentRow[],
  allReminders: ReminderSentRow[],
  taps: ReminderTapRow[]
): ReminderResponseReport {
  const report: ReminderResponseReport = { sent: 0, confirmed: 0, reschedule: 0, cancel: 0, noResponse: 0 };

  const remindersByAppointment = groupByAppointment(allReminders);
  const tapsByAppointment = groupByAppointment(taps);

  for (const reminder of reminders) {
    if (!reminder.appointment_id) continue;
    report.sent += 1;

    const sentAt = Date.parse(reminder.created_at);
    const nextReminder = (remindersByAppointment.get(reminder.appointment_id) ?? [])
      .map((row) => Date.parse(row.created_at))
      .find((time) => time > sentAt);
    const windowEnd = nextReminder ?? Number.POSITIVE_INFINITY;

    const lastTap = (tapsByAppointment.get(reminder.appointment_id) ?? [])
      .filter((tap) => {
        const time = Date.parse(tap.created_at);
        return time > sentAt && time < windowEnd && OUTCOME_BY_TYPE[tap.message_type];
      })
      .at(-1);

    if (lastTap) report[OUTCOME_BY_TYPE[lastTap.message_type]] += 1;
    else report.noResponse += 1;
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
