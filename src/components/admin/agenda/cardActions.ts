// Ações do cartão de atendimento (redesign R2; cliente, 15/out/2026). Quais
// ações existem e quando aparecem é o mesmo de antes (F4.5 a F11.2); muda só
// onde ficam, pela tabela "ações por situação" do canvas aprovado:
// - principal (botão cheio): Confirmar presença no futuro sem confirmação;
//   Compareceu no que já passou sem registro;
// - à vista: Remarcar, Pagamento, Faltou e a ação que resolve um sinal
//   (Reenviar lembrete, preparo ou orientações);
// - "Mais": as raras (lista de espera, correções, série, Trilha);
// - à parte, à direita e em vermelho: Cancelar.
// Toda ação de formulário pede confirmação (cliente, 05/out/2026).
import type { IconName } from "../Icon.astro";
import type { AgendaAppointment } from "../../../lib/data/agenda/view";
import { canReceivePayment, type PaymentState } from "../../../lib/data/payments";
import type { ReminderAction } from "../../../lib/data/whatsapp/reminders";
import { confirmedByReminder } from "../../../lib/reminderResponse";
import { withReturn } from "../../../lib/returnPath";

export type CardAction =
  | {
      kind: "form";
      acao: string;
      label: string;
      icon: IconName;
      danger?: boolean;
      title: string;
      message: string;
      confirm: string;
    }
  | { kind: "link"; href: string; label: string; icon: IconName };

export type CardActions = {
  primary?: CardAction;
  visible: CardAction[];
  more: CardAction[];
  aside?: CardAction;
};

export type CardActionInput = {
  appointment: Pick<AgendaAppointment, "id" | "status" | "scheduledAt" | "patientConfirmedAt" | "reminderResponse" | "seriesId">;
  now: Date;
  /** "Ana Souza, 23/10 às 14:00", para o texto da confirmação. */
  who: string;
  /** Termo do contato no vocabulário da clínica ("responsável"/"contato"). */
  contact: string;
  returnTo: string;
  reminderAction?: ReminderAction;
  preparationResendable: boolean;
  guidanceResendable: boolean;
  waitlistOn: boolean;
  onWaitlist: boolean;
  /** Sem ela (módulo financeiro desligado ou sem acesso), não há "Pagamento". */
  payment?: PaymentState;
};

export function cardActions(input: CardActionInput): CardActions {
  const { appointment: a, now, who, contact, returnTo } = input;
  const isActive = a.status === "scheduled" || a.status === "confirmed";
  const isPast = a.scheduledAt.getTime() <= now.getTime();
  const isFuture = isActive && !isPast;
  const result: CardActions = { visible: [], more: [] };

  // Presença: cheia quando falta confirmar; confirmado pelo lembrete fica no
  // "Mais" (já está garantido); confirmada pela recepção, o desfazer também.
  if (isFuture) {
    if (a.patientConfirmedAt) {
      result.more.push({ kind: "form", acao: "desfazer_presenca", label: "Desfazer presença", icon: "x-mark", title: "Desfazer a presença confirmada?", message: who, confirm: "Desfazer" });
    } else {
      const confirmPresence: CardAction = {
        kind: "form",
        acao: "confirmar_presenca",
        label: "Confirmar presença",
        icon: "check",
        title: "Confirmar a presença?",
        message: `${who}. Use quando o ${contact} confirmou por mensagem ou ligação.`,
        confirm: "Confirmar presença",
      };
      // O lembrete respondido com "confirmo" já garante o atendimento (10/out).
      if (confirmedByReminder(a.reminderResponse)) result.more.push(confirmPresence);
      else result.primary = confirmPresence;
    }
  }
  if (isActive && isPast) {
    result.primary = { kind: "form", acao: "compareceu", label: "Compareceu", icon: "check", title: "Registrar que compareceu?", message: who, confirm: "Compareceu" };
  }

  // Sinais: a ação que resolve sai do "Mais" e fica à vista.
  if (input.reminderAction) {
    const label = input.reminderAction === "send" ? "Enviar lembrete" : "Reenviar lembrete";
    result.visible.push({ kind: "form", acao: "lembrete", label, icon: "paper-airplane", title: `${label}?`, message: `${who}. O lembrete vai pelo WhatsApp.`, confirm: label });
  }
  if (input.preparationResendable) {
    result.visible.push({
      kind: "form",
      acao: "preparo",
      label: "Reenviar preparo",
      icon: "paper-airplane",
      title: "Reenviar o preparo do exame?",
      message: `${who}. O preparo vai pelo WhatsApp.`,
      confirm: "Reenviar preparo",
    });
  }
  if (input.guidanceResendable) {
    result.visible.push({
      kind: "form",
      acao: "orientacoes",
      label: "Reenviar orientações",
      icon: "paper-airplane",
      title: "Reenviar as orientações gerais?",
      message: `${who}. As orientações vão pelo WhatsApp.`,
      confirm: "Reenviar orientações",
    });
  }
  if (isActive && isPast) {
    result.visible.push({ kind: "form", acao: "faltou", label: "Faltou", icon: "x-mark", danger: true, title: "Registrar a falta?", message: who, confirm: "Faltou" });
  }
  if (isFuture) {
    result.visible.push({ kind: "link", href: `/admin/agenda/remarcar?id=${a.id}&return_to=${encodeURIComponent(returnTo)}`, label: "Remarcar", icon: "arrow-path" });
  }

  // Pagamento (F11.2): à vista, menos quando a ação do momento é confirmar a presença.
  if (input.payment !== undefined && canReceivePayment(a.status)) {
    const payment: CardAction = { kind: "link", href: withReturn(`/admin/financeiro/pagamento/${a.id}`, returnTo), label: "Pagamento", icon: "banknotes" };
    if (result.primary?.kind === "form" && result.primary.acao === "confirmar_presenca") result.more.unshift(payment);
    else result.visible.push(payment);
  }

  // Lista de espera (só para atendimento avulso, no futuro).
  if (input.waitlistOn && isFuture && a.seriesId === null) {
    result.more.push(
      input.onWaitlist
        ? {
            kind: "form",
            acao: "sair_lista_espera",
            label: "Tirar da lista de espera",
            icon: "clock",
            danger: true,
            title: "Tirar da lista de espera?",
            message: `${who}. Deixa de receber oferta de horário antes.`,
            confirm: "Tirar da lista",
          }
        : {
            kind: "form",
            acao: "entrar_lista_espera",
            label: "Pôr na lista de espera",
            icon: "clock",
            title: "Pôr na lista de espera?",
            message: `${who}. Se abrir um horário antes, o ${contact} recebe a oferta para antecipar.`,
            confirm: "Pôr na lista",
          },
    );
  }

  // Correções do comparecimento já registrado.
  if (isPast && a.status === "no_show") {
    result.more.push({ kind: "form", acao: "compareceu", label: "Corrigir: compareceu", icon: "check", title: "Registrar que compareceu?", message: who, confirm: "Compareceu" });
  }
  if (isPast && a.status === "completed") {
    result.more.push({ kind: "form", acao: "faltou", label: "Corrigir: faltou", icon: "x-mark", danger: true, title: "Registrar a falta?", message: who, confirm: "Faltou" });
  }

  if (a.seriesId) result.more.push({ kind: "link", href: withReturn(`/admin/agenda/serie/${a.seriesId}`, returnTo), label: "Ver série", icon: "calendar" });

  // Trilha: à vista no cancelado (é a única ação dele); nos outros, no "Mais".
  const trail: CardAction = { kind: "link", href: `/admin/agenda/trilha/${a.id}?volta=${encodeURIComponent(returnTo)}`, label: "Trilha", icon: "queue-list" };
  if (a.status === "canceled") result.visible.push(trail);
  else result.more.push(trail);

  // Sessão de série: "esta e as próximas" (D9).
  if (a.seriesId !== null && isFuture) {
    result.more.push({
      kind: "form",
      acao: "encerrar_serie",
      label: "Encerrar a série",
      icon: "x-mark",
      danger: true,
      title: "Encerrar a série a partir desta sessão?",
      message: `${who}. Esta sessão e as próximas são canceladas; as que já passaram ficam como estão. O paciente é avisado pelo WhatsApp do cancelamento da primeira.`,
      confirm: "Encerrar a série",
    });
  }

  if (isFuture) {
    result.aside = {
      kind: "form",
      acao: "cancelar",
      label: a.seriesId ? "Cancelar só esta" : "Cancelar",
      icon: "x-mark",
      danger: true,
      title: a.seriesId ? "Cancelar só esta sessão?" : "Cancelar o atendimento?",
      message: `${who}. O horário fica livre de novo.${a.seriesId ? " A série continua nas próximas." : ""} O paciente é avisado pelo WhatsApp.`,
      confirm: a.seriesId ? "Cancelar só esta" : "Cancelar atendimento",
    };
  }
  return result;
}

