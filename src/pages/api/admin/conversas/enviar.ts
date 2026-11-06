import type { APIRoute } from "astro";
import { isUuid } from "../../../../lib/clinicAccess";
import { createUserClient } from "../../../../lib/data/clients";
import { createClinicServiceClient } from "../../../../lib/data/clinicService";
import { listConversations } from "../../../../lib/data/central";
import { resumeFromCentral, retryFromCentral, sendFromCentral, sendMessageText, type SendResult } from "../../../../lib/data/centralSend";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { clinicSenderFor } from "../../../../lib/data/whatsapp/clinicSender";
import { formOptionalText, formText } from "../../../../lib/forms";
import { safeReturnPath } from "../../../../lib/returnPath";

// Responder pela Central (CN4a; decisões 5 e 7, cliente, 05/nov/2026): "enviar" (com a chave da tela, o mesmo envio
// não sai duas vezes; quem responde assume), "tentar" (a mensagem que não saiu) e "retomar" (CN4b: fora das 24 h, o
// modelo "Retomar conversa"). O banco confere quem pode, a janela de 24 h e o responsável que a tela mostrou.
const PHONE = /^\+\d{10,15}$/;

export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const clinic = locals.clinic!;
  const form = await request.formData().catch(() => null);
  const back = safeReturnPath(formOptionalText(form, "return_to"), "/admin/conversas");
  return runFormAction(
    context,
    async () => {
      if (!clinic.features.includes("central_attendance")) throw new DataError("not_enabled", "Conversas: sem a Central de atendimento");
      const db = createUserClient(request, cookies);
      const deps = { db, serviceDb: createClinicServiceClient(clinic.clinicId), sender: await clinicSenderFor(clinic.clinicId, request.url) };
      const action = formText(form, "acao");
      const seen = formOptionalText(form, "responsavel_visto");
      const expectedAssigned = isUuid(seen) ? seen : null;
      let result: SendResult | { kind: "already" };
      if (action === "tentar") {
        const id = formText(form, "mensagem");
        if (!isUuid(id)) throw new DataError("not_found", "Conversas: mensagem não encontrada");
        result = await retryFromCentral(deps, clinic.clinicId, id);
      } else if (action === "enviar" || action === "retomar") {
        const phone = formText(form, "telefone");
        const clientKey = formText(form, "chave");
        if (!PHONE.test(phone) || !isUuid(clientKey)) throw new DataError("not_found", "Conversas: conversa não encontrada");
        if (action === "enviar") {
          const body = (form?.get("texto") ?? "").toString();
          if (!body.trim()) throw new DataError("invalid", "Conversas: escreva a mensagem antes de enviar", { texto: "Escreva a mensagem." });
          result = await sendFromCentral(deps, clinic.clinicId, { phone, clientKey, body, expectedAssigned });
        } else {
          // Dia da última mensagem do paciente pela lista da Central.
          const digits = phone.replace(/\D/g, "");
          const [open, finished] = await Promise.all([
            listConversations(db, clinic.clinicId, { search: digits }),
            listConversations(db, clinic.clinicId, { search: digits, finished: true }),
          ]);
          const conversation = [...open, ...finished].find((item) => item.phone === phone);
          if (!conversation) throw new DataError("not_found", "Conversas: conversa não encontrada");
          result = await resumeFromCentral(deps, clinic.clinicId, {
            phone,
            clientKey,
            expectedAssigned,
            lastPatientAt: conversation.lastPatientAt ?? conversation.lastMessageAt,
            timeZone: clinic.timezone,
          });
        }
      } else {
        throw new DataError("invalid", "Conversas: ação desconhecida");
      }
      const message = sendMessageText(result);
      // Não saiu pelo WhatsApp: a mensagem já está na conversa, com "Tentar de novo" (o campo volta vazio).
      if (result.kind === "failed") return { redirectTo: back, message: message.text, tone: "error" as const };
      // Outra pessoa assumiu ou passou das 24 h: nada foi gravado, o texto volta ao campo.
      if (message.tone === "error") throw new DataError("conflict", `Conversas: ${message.text}`);
      return { redirectTo: back, message: message.text };
    },
    back,
  );
};
