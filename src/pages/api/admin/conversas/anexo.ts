import type { APIRoute } from "astro";
import { isUuid } from "../../../../lib/clinicAccess";
import { createUserClient } from "../../../../lib/data/clients";
import { createClinicServiceClient } from "../../../../lib/data/clinicService";
import { sendMediaFromCentral, sendMessageText } from "../../../../lib/data/centralSend";
import { DataError, unwrap } from "../../../../lib/data/errors";
import { describeDataError } from "../../../../lib/data/formAction";
import { checkOutboundFile, createOutboundUploadUrl, outboundPath } from "../../../../lib/data/whatsapp/media";
import { clinicSenderFor } from "../../../../lib/data/whatsapp/clinicSender";
import { setFlash } from "../../../../lib/flash";
import { logError } from "../../../../lib/log";
import { safeReturnPath } from "../../../../lib/returnPath";

// Enviar foto ou PDF pela Central (CN6; seção 6 e decisão 8b, cliente, 05/nov/2026). Chamado por código (JSON), em
// dois passos, como os documentos do paciente: "preparar" confere o acesso à conversa e o arquivo escolhido e devolve
// o link de envio de uso único (o navegador sobe direto ao bucket: as funções da Vercel limitam o corpo a poucos MB);
// "enviar" confere o arquivo que chegou (tipo pelo conteúdo e tamanho), grava a mensagem e envia pelo WhatsApp.
const PHONE = /^\+\d{10,15}$/;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Body = {
  acao?: string;
  telefone?: string;
  chave?: string;
  tipo?: string;
  tamanho?: number;
  nome?: string;
  legenda?: string;
  responsavel_visto?: string;
  return_to?: string;
};

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const clinic = locals.clinic!;
  const body = (await request.json().catch(() => null)) as Body | null;
  const back = safeReturnPath(body?.return_to ?? null, "/admin/conversas");
  const phone = String(body?.telefone ?? "");
  const clientKey = String(body?.chave ?? "");
  if (!clinic.features.includes("central_attendance")) return json(403, { error: "A Central de atendimento não está liberada nesta clínica." });
  if (!PHONE.test(phone) || !isUuid(clientKey)) return json(400, { error: "Conversa não encontrada." });
  const db = createUserClient(request, cookies);
  const serviceDb = createClinicServiceClient(clinic.clinicId);
  try {
    if (body?.acao === "preparar") {
      const check = checkOutboundFile(String(body.tipo ?? ""), Number(body.tamanho) || 0);
      if (!check.ok) return json(400, { error: check.message });
      // Mesmo acesso de abrir a conversa (o envio confere de novo quem pode responder).
      unwrap(await db.rpc("central_conversation_media", { p_clinic_id: clinic.clinicId, p_contact_phone: phone, p_media_ids: [] }), "Conversas");
      const path = outboundPath(clinic.clinicId, phone, clientKey, check.mimeType);
      return json(200, { uploadUrl: await createOutboundUploadUrl(serviceDb, path) });
    }
    if (body?.acao === "enviar") {
      const types = ["image/jpeg", "image/png", "application/pdf"];
      const declared = String(body.tipo ?? "");
      if (!types.includes(declared)) return json(400, { error: "Envie uma foto (JPG ou PNG) ou um PDF." });
      const seen = String(body.responsavel_visto ?? "");
      const result = await sendMediaFromCentral(
        { db, serviceDb, sender: await clinicSenderFor(clinic.clinicId, request.url) },
        clinic.clinicId,
        {
          phone,
          clientKey,
          path: outboundPath(clinic.clinicId, phone, clientKey, declared),
          fileName: String(body.nome ?? ""),
          caption: body.legenda ? String(body.legenda).slice(0, 1100) : null,
          expectedAssigned: isUuid(seen) ? seen : null,
        },
      );
      const message = sendMessageText(result);
      // Não saiu pelo WhatsApp: a mensagem já está na conversa, com "Tentar de novo".
      if (result.kind === "failed") {
        setFlash(cookies, { tone: "error", text: message.text, noRestore: true });
        return json(200, { redirectTo: back });
      }
      // Arquivo fora da regra, outra pessoa assumiu ou passou das 24 h: nada foi gravado; a janela continua aberta.
      if (message.tone === "error") return json(409, { error: message.text });
      setFlash(cookies, { tone: "success", text: result.kind === "sent" ? "Arquivo enviado." : message.text });
      return json(200, { redirectTo: back });
    }
    return json(400, { error: "Ação desconhecida." });
  } catch (error) {
    if (error instanceof DataError) return json(error.code === "forbidden" ? 403 : 400, { error: describeDataError(error) });
    logError("central: enviar anexo", error, { clinica: clinic.clinicId });
    return json(500, { error: "Não enviamos por uma falha do sistema, já registrada para o suporte. Tente de novo em instantes." });
  }
};
