import type { APIRoute } from "astro";
import { isUuid } from "../../../../../../lib/clinicAccess";
import { createUserClient } from "../../../../../../lib/data/clients";
import { getLatestNotice } from "../../../../../../lib/data/whatsapp/undeliverable";
import { formatPhoneBR } from "../../../../../../lib/phone";
import { describeSendFailure } from "../../../../../../lib/whatsappErrors";
import { logError } from "../../../../../../lib/log";

// Situação da confirmação (ou da remarcação) de um atendimento, para o aviso do topo da Agenda depois de marcar
// (cliente, 05/nov/2026, opção C): enviando, entregue, enviada (celular sem receber ainda) ou não chegou, com o motivo.
// Só leitura, pela credencial de quem está na tela.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const GET: APIRoute = async ({ params, request, cookies, locals }) => {
  const id = params.id ?? "";
  if (!isUuid(id)) return json({ error: "not_found" }, 404);
  try {
    const notice = await getLatestNotice(createUserClient(request, cookies), locals.clinic!.clinicId, id);
    if (!notice) return json({ state: "none" });
    const failed = notice.status === "failed" || notice.status === "skipped_no_template";
    const state = notice.status === "delivered" || notice.status === "read" ? "delivered" : failed ? (notice.retrying ? "retrying" : "failed") : "sent";
    const failure = state === "failed" ? describeSendFailure(notice.failureCode, notice.failureReason) : null;
    return json({
      state,
      reschedule: notice.messageType === "appointment_reschedule",
      messageId: notice.messageId,
      phone: formatPhoneBR(notice.phone),
      phoneRaw: notice.phone,
      contactName: notice.contactName,
      sentAt: notice.createdAt.toISOString(),
      failure: failure ? { title: failure.title, action: failure.action, code: notice.failureCode, numberProblem: notice.failureCode === 131026 } : null,
    });
  } catch (error) {
    logError("envio do atendimento", error, { atendimento: id });
    return json({ error: "unexpected" }, 500);
  }
};
