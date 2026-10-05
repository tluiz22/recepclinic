import type { APIRoute } from "astro";
import { localDateOf, localTimeOf } from "../../../../../lib/clinicTime";
import { parseSlot } from "../../../../../lib/agendaSlot";
import { isUuid } from "../../../../../lib/clinicAccess";
import {
  bookAppointment,
  cancelAppointment,
  recordAttendance,
  rescheduleAppointment,
  setPresenceConfirmed,
} from "../../../../../lib/data/agenda/appointments";
import { createUserClient } from "../../../../../lib/data/clients";
import { DataError } from "../../../../../lib/data/errors";
import { runFormAction } from "../../../../../lib/data/formAction";
import { joinWaitlist, leaveWaitlist } from "../../../../../lib/data/waitlist/entries";
import { panelPreparationSender, panelReminderSender, SENDING_NOT_READY } from "../../../../../lib/data/whatsapp/panelSender";
import { PREPARATION_RESEND_MESSAGES, resendPreparation } from "../../../../../lib/data/whatsapp/preparation";
import { RESEND_MESSAGES, sendReminderFromPanel } from "../../../../../lib/data/whatsapp/reminders";
import { formChecked, formInt, formOptionalText, formText } from "../../../../../lib/forms";
import { changeSeriesFrom, createSeries, endSeriesFrom } from "../../../../../lib/data/agenda/series";

// Ações da Agenda (F4.5) num atendimento: marcar (`novo`), remarcar,
// cancelar, presença confirmada, comparecimento, lembrete, preparo e lista
// de espera. Volta para a tela de onde saiu (só telas da Agenda). Os avisos
// ao paciente pelo WhatsApp (marcado, remarcado, cancelado) entram com o bot
// (F6), como no plano.

const safeReturn = (value: string | null, fallback: string) =>
  value && /^\/admin\/agenda(\/[a-z-]+)?(\?[^\s]*)?$/.test(value) ? value : fallback;

export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const actorId = locals.userId ?? null;
  const db = createUserClient(request, cookies);
  const returnTo = safeReturn(formOptionalText(form, "return_to"), "/admin/agenda");
  const failTo = safeReturn(formOptionalText(form, "back"), returnTo);
  const acao = formText(form, "acao");

  return runFormAction(
    context,
    async () => {
      if (acao !== "marcar" && !isUuid(id)) throw new DataError("not_found", "Atendimento: não encontrado");
      const done = (message: string, to = returnTo) => ({ redirectTo: to, message });
      switch (acao) {
        case "marcar": {
          const slot = parseSlot(formText(form, "slot"));
          if (!slot) throw new DataError("invalid", "Atendimento: escolha o horário", { start: "Escolha o horário." });
          if (formChecked(form, "repetir")) {
            const fim = formText(form, "fim");
            const created = await createSeries(db, clinic.clinicId, {
              patientId: formText(form, "patient_id"),
              serviceId: formText(form, "service_id"),
              agendaId: slot.agendaId,
              locationId: slot.locationId,
              intervalWeeks: formInt(form, "interval_weeks"),
              startsOn: localDateOf(slot.start, clinic.timezone),
              startTime: localTimeOf(slot.start, clinic.timezone),
              endsOn: fim === "data" ? formText(form, "ends_on") || "invalida" : null,
              maxSessions: fim === "sessoes" ? formInt(form, "max_sessions") : null,
              homeVisitAddress: formOptionalText(form, "home_visit_address"),
              actorId,
            });
            const skipped = created.skipped.length ? ` ${created.skipped.length} data(s) pulada(s): veja abaixo.` : "";
            return done(`Série criada: ${created.created.length} sessão(ões) marcada(s).${skipped}`, `/admin/agenda/serie/${created.series.id}`);
          }
          const result = await bookAppointment(db, clinic.clinicId, {
            patientId: formText(form, "patient_id"),
            serviceId: formText(form, "service_id"),
            agendaId: slot.agendaId,
            start: slot.start,
            locationId: slot.locationId,
            homeVisitAddress: formOptionalText(form, "home_visit_address"),
            channel: "admin",
            actorId,
          });
          const date = localDateOf(result.appointment.scheduledAt, clinic.timezone);
          return done(["Atendimento marcado.", ...result.returnWarnings].join(" "), `/admin/agenda?date=${date}`);
        }
        case "remarcar": {
          const slot = parseSlot(formText(form, "slot"));
          if (!slot) throw new DataError("invalid", "Atendimento: escolha o horário", { start: "Escolha o horário." });
          // Sessão de série, "esta e as próximas": a série muda de dia e horário daqui em diante (D9).
          if (formText(form, "modo") === "serie") {
            const changed = await changeSeriesFrom(
              db,
              clinic.clinicId,
              id,
              { startsOn: localDateOf(slot.start, clinic.timezone), startTime: localTimeOf(slot.start, clinic.timezone) },
              actorId,
            );
            if (!changed.next) return done("Série encerrada: não faltavam sessões.");
            const skipped = changed.next.skipped.length ? ` ${changed.next.skipped.length} data(s) pulada(s): veja abaixo.` : "";
            return done(`Série remarcada: ${changed.next.created.length} sessão(ões) no novo dia e horário.${skipped}`, `/admin/agenda/serie/${changed.next.series.id}`);
          }
          const moved = await rescheduleAppointment(db, clinic.clinicId, id, { start: slot.start, locationId: slot.locationId, channel: "admin", actorId });
          return done("Atendimento remarcado.", `/admin/agenda?date=${localDateOf(moved.scheduledAt, clinic.timezone)}`);
        }
        case "cancelar": {
          const canceled = await cancelAppointment(db, clinic.clinicId, id, { channel: "admin", actorId });
          return done(canceled ? "Atendimento cancelado." : "Este atendimento já estava cancelado.");
        }
        case "encerrar_serie": {
          const ended = await endSeriesFrom(db, clinic.clinicId, id, actorId);
          return done(`Série encerrada: ${ended.canceled.length} sessão(ões) cancelada(s) a partir desta.`);
        }
        case "confirmar_presenca":
        case "desfazer_presenca":
          await setPresenceConfirmed(db, clinic.clinicId, id, acao === "confirmar_presenca", actorId);
          return done(acao === "confirmar_presenca" ? "Presença confirmada." : "Presença confirmada desfeita.");
        case "compareceu":
        case "faltou":
          await recordAttendance(db, clinic.clinicId, id, acao === "compareceu" ? "completed" : "no_show", actorId);
          return done(acao === "compareceu" ? "Registrado: compareceu." : "Registrado: faltou.");
        case "lembrete": {
          const sender = panelReminderSender();
          if (!sender) throw new DataError("invalid", SENDING_NOT_READY, { sender: SENDING_NOT_READY });
          const outcome = await sendReminderFromPanel(db, clinic.clinicId, id, actorId, sender);
          if (!RESEND_MESSAGES[outcome].ok) throw new DataError("invalid", RESEND_MESSAGES[outcome].text, { outcome: RESEND_MESSAGES[outcome].text });
          return done(RESEND_MESSAGES[outcome].text);
        }
        case "preparo": {
          const sender = panelPreparationSender();
          if (!sender) throw new DataError("invalid", SENDING_NOT_READY, { sender: SENDING_NOT_READY });
          const outcome = await resendPreparation(db, clinic.clinicId, id, actorId, sender);
          const message = PREPARATION_RESEND_MESSAGES[outcome];
          if (!message.ok) throw new DataError("invalid", message.text, { outcome: message.text });
          return done(message.text);
        }
        case "entrar_lista_espera": {
          const result = await joinWaitlist(db, clinic.clinicId, id, { via: "admin", actorId });
          return done(result === "already" ? "Já estava na lista de espera." : "Na lista de espera: se abrir um horário antes, o paciente recebe a oferta.");
        }
        case "sair_lista_espera": {
          const left = await leaveWaitlist(db, clinic.clinicId, id, { channel: "admin", actorId });
          return done(left ? "Retirado da lista de espera." : "Já não estava na lista de espera.");
        }
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    failTo,
  );
};
