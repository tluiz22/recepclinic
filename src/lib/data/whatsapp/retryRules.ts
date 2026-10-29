import { GraphRequestError } from "./graph";

// Reenvio automático de envios com falha técnica (cliente, 23/out/2026): o que
// conta como falha técnica e quando sai a próxima tentativa. Quem reenvia é
// `retries.ts`; quem grava é `recordOutboundMessage`.

/** A primeira tentativa e mais duas. */
export const MAX_ATTEMPTS = 3;

/** Minutos até a próxima tentativa, depois da falha da 1ª e da 2ª: 10 e 30 minutos depois da primeira falha. */
export const RETRY_DELAYS_MINUTES = [10, 20] as const;

/**
 * Códigos da Meta de falha passageira: instabilidade, manutenção ou limite de
 * vazão. Os outros (número sem WhatsApp, template, pagamento, permissão,
 * parâmetro) dão o mesmo erro de novo e não são reenviados.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
export const TECHNICAL_META_CODES: ReadonlySet<number> = new Set([
  1, // erro desconhecido da API
  2, // serviço da API indisponível
  4, // limite de chamadas do app
  17, // limite de chamadas do usuário
  341, // limite do app
  80007, // limite de vazão da conta (WABA)
  130429, // limite de vazão do número
  131000, // "algo deu errado"
  131016, // serviço indisponível
  131056, // muitas mensagens para o mesmo número em pouco tempo
  131057, // conta em manutenção
  133004, // servidor temporariamente indisponível
]);

/** Envios automáticos com reenvio (cliente, 23/out): o bot fica de fora (a resposta chegaria fora de contexto). */
export const RETRYABLE_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "appointment_reminder",
  "appointment_confirmation",
  "appointment_reschedule",
  "appointment_cancellation",
  "appointment_mass_cancellation",
  "exam_preparation",
  "exam_preparation_file",
  "consultation_guidance",
  "daily_summary_consultas",
  "daily_summary_exames",
  "waitlist_offer",
  "nfse_document",
]);

/** Falha do envio: o código da Meta (null = sem código) e se é técnica. */
export type SendFailure = { code: number | null; technical: boolean };

/** Falha avisada pela Meta (código), na hora ou depois pelo webhook. */
export function isTechnicalCode(code: number | null | undefined): boolean {
  return code !== null && code !== undefined && TECHNICAL_META_CODES.has(code);
}

/**
 * Erro do envio na hora: código técnico da Meta; resposta sem código com HTTP
 * 5xx ou 429 (Meta fora do ar ou sobrecarregada); ou erro de rede e tempo
 * esgotado (o pedido nem chegou à Meta).
 */
export function classifySendError(error: unknown): SendFailure {
  if (error instanceof GraphRequestError) {
    const { code, httpStatus } = error.graph;
    if (code !== null) return { code, technical: isTechnicalCode(code) };
    return { code: null, technical: httpStatus !== null && httpStatus !== undefined && (httpStatus >= 500 || httpStatus === 429) };
  }
  // fetch: TypeError ("fetch failed"), AbortError ou TimeoutError.
  return { code: null, technical: error instanceof Error && ["TypeError", "AbortError", "TimeoutError"].includes(error.name) };
}

/** O que conferir antes de reenviar (o atendimento não mudou, a oferta segue de pé, o resumo ainda vale). */
export type RetryContext = {
  /** Data do atendimento no envio: remarcado ou cancelado depois, não reenvia. */
  scheduledAt?: string;
  /** Até quando o envio faz sentido (resumo: o fim do dia do resumo). */
  until?: string;
  offerId?: string;
  invoiceId?: string;
};

/** Hora da próxima tentativa depois da falha da tentativa `attempt`; null = não há. */
export function nextRetryAt(attempt: number, failedAt: Date): Date | null {
  if (attempt >= MAX_ATTEMPTS) return null;
  const minutes = RETRY_DELAYS_MINUTES[attempt - 1];
  return minutes === undefined ? null : new Date(failedAt.getTime() + minutes * 60_000);
}

/** Falta para a última tentativa possível de uma falha agora (a oferta de vaga fica reservada até lá). */
export function lastRetryWithin(attempt: number): number {
  return RETRY_DELAYS_MINUTES.slice(attempt - 1).reduce((total, minutes) => total + minutes, 0) * 60_000;
}
