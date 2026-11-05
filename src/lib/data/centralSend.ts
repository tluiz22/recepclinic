import type { ClinicRole } from "../clinicAccess";
import type { DbClient } from "./clients";
import { DataError, unwrap } from "./errors";
import { logError } from "../log";
import type { SendOutcome } from "./whatsapp/messages";
import type { ClinicSender } from "./whatsapp/send";
import { pauseForHuman } from "./whatsapp/conversations";

// Responder, assumir e transferir pela Central (CN4a; plano em docs/planejamento-central-atendimento.md, decisões 5
// e 7 e R2, cliente, 05/nov/2026). O banco confere quem pode, a janela de 24 h e o responsável que a tela mostrou, e
// grava a mensagem antes de enviar (com a chave da tela: o mesmo envio não sai duas vezes). Enviar e gravar o
// resultado é com a credencial da clínica, a única que lê o token do WhatsApp.

export type SendResult =
  | { kind: "sent" }
  | { kind: "failed"; reason: string }
  /** A mesma chave já foi: nada sai de novo. */
  | { kind: "duplicate" }
  /** Outra pessoa assumiu desde que a tela abriu ("Ana assumiu agora"): a mensagem não sai. */
  | { kind: "changed"; name: string | null }
  | { kind: "window_closed" };

export type SendDeps = {
  /** Login de quem envia (confere o acesso e o responsável). */
  db: DbClient;
  /** Credencial da clínica: pausa o bot e grava o resultado. */
  serviceDb: DbClient;
  /** null = WhatsApp da clínica não conectado. */
  sender: ClinicSender | null;
};

type Prepared = {
  outcome: string;
  message_id: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
};

async function prepare(
  db: DbClient,
  clinicId: string,
  input: SendInput,
): Promise<Prepared> {
  const rows = unwrap(
    await db.rpc("central_send_prepare", {
      p_clinic_id: clinicId,
      p_contact_phone: input.phone,
      p_client_key: input.clientKey,
      p_body: input.body,
      p_expected_assigned: input.expectedAssigned,
    }),
    "Conversas",
  );
  return rows[0];
}

export type SendInput = {
  phone: string;
  clientKey: string;
  body: string;
  expectedAssigned: string | null;
};

/** Envia, grava "enviada" ou "não enviada" e devolve o que aconteceu. */
async function deliver(
  deps: SendDeps,
  clinicId: string,
  messageId: string,
  phone: string,
  body: string,
): Promise<SendResult> {
  const outcome: SendOutcome = deps.sender
    ? await deps.sender.text(phone, body)
    : { sent: false, reason: "WhatsApp da clínica não conectado" };
  const update = outcome.sent
    ? { status: "sent", wa_message_id: outcome.messageId }
    : {
        status: "failed",
        failure_reason: outcome.reason.slice(0, 300),
        failure_code: outcome.failure?.code ?? null,
      };
  const { error } = await deps.serviceDb
    .from("whatsapp_messages")
    .update(update)
    .eq("clinic_id", clinicId)
    .eq("id", messageId);
  if (error)
    logError("central: resultado do envio não gravado", error, {
      clinica: clinicId,
      mensagem: messageId,
    });
  return outcome.sent
    ? { kind: "sent" }
    : { kind: "failed", reason: outcome.reason };
}

/**
 * Resposta pela Central: quem responde vira o responsável (decisão 5). Conversa com o bot (Finalizadas): pausa o bot
 * antes, como a resposta pelo app, e responde.
 */
export async function sendFromCentral(
  deps: SendDeps,
  clinicId: string,
  input: SendInput,
): Promise<SendResult> {
  let prepared = await prepare(deps.db, clinicId, input);
  if (prepared.outcome === "bot") {
    await pauseForHuman(deps.serviceDb, clinicId, input.phone, {
      contactId: null,
      reason: "agent_took_over",
    });
    prepared = await prepare(deps.db, clinicId, {
      ...input,
      expectedAssigned: null,
    });
  }
  switch (prepared.outcome) {
    case "ok":
      return deliver(
        deps,
        clinicId,
        prepared.message_id!,
        input.phone,
        input.body.trim(),
      );
    case "duplicate":
      return { kind: "duplicate" };
    case "changed":
      return { kind: "changed", name: prepared.assigned_name };
    case "window_closed":
      return { kind: "window_closed" };
    default:
      throw new DataError(
        "unexpected",
        `Conversas: resposta inesperada do envio (${prepared.outcome})`,
      );
  }
}

/** "Tentar de novo" numa mensagem que não saiu. */
export async function retryFromCentral(
  deps: SendDeps,
  clinicId: string,
  messageId: string,
): Promise<SendResult | { kind: "already" }> {
  const rows = unwrap(
    await deps.db.rpc("central_send_retry", {
      p_clinic_id: clinicId,
      p_message_id: messageId,
    }),
    "Conversas",
  );
  const row = rows[0];
  if (row.outcome === "already") return { kind: "already" };
  if (row.outcome === "window_closed") return { kind: "window_closed" };
  return deliver(deps, clinicId, messageId, row.contact_phone, row.body ?? "");
}

export type AssignResult = {
  kind: "ok" | "same" | "closed" | "changed";
  name: string | null;
};

/** Assumir (`to` null) ou transferir. `expected`: o responsável que a tela mostrou. */
export async function assignConversation(
  db: DbClient,
  clinicId: string,
  phone: string,
  { expected, to = null }: { expected: string | null; to?: string | null },
): Promise<AssignResult> {
  const rows = unwrap(
    await db.rpc("central_assign", {
      p_clinic_id: clinicId,
      p_contact_phone: phone,
      p_expected_assigned: expected,
      p_to: to,
    }),
    "Conversas",
  );
  return {
    kind: rows[0].outcome as AssignResult["kind"],
    name: rows[0].assigned_name,
  };
}

export type TeamOption = { userId: string; name: string; roles: ClinicRole[] };

/** Para quem transferir: Administrador, Recepção e Profissional da clínica. */
export async function listCentralTeam(
  db: DbClient,
  clinicId: string,
): Promise<TeamOption[]> {
  const rows = unwrap(
    await db.rpc("central_team", { p_clinic_id: clinicId }),
    "Equipe",
  );
  return rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    roles: row.roles as ClinicRole[],
  }));
}

/** Aviso da tela depois de enviar. */
export function sendMessageText(result: SendResult | { kind: "already" }): {
  tone: "success" | "error";
  text: string;
} {
  switch (result.kind) {
    case "sent":
      return { tone: "success", text: "Mensagem enviada." };
    case "duplicate":
    case "already":
      return { tone: "success", text: "Essa mensagem já tinha sido enviada." };
    case "failed":
      return {
        tone: "error",
        text: 'A mensagem não saiu pelo WhatsApp. Confira a conexão e use "Tentar de novo" na mensagem.',
      };
    case "changed":
      return {
        tone: "error",
        text: `${result.name ?? "Outra pessoa"} assumiu a conversa agora. A sua mensagem não foi enviada: confira a conversa antes de responder.`,
      };
    case "window_closed":
      return {
        tone: "error",
        text: "Passaram 24 horas desde a última mensagem do paciente. Pelo WhatsApp, a mensagem não pode mais sair como texto livre.",
      };
  }
}
