import type { APIRoute } from "astro";
import { createClinicServiceClient } from "../../../lib/data/clinicService";
import { resolveClinicByPhoneNumberId, resolveClinicsByWabaId } from "../../../lib/data/platform";
import { clinicSenderFor } from "../../../lib/data/whatsapp/clinicSender";
import { isValidMetaSignature, processWebhook } from "../../../lib/data/whatsapp/webhook";
import { platformEnv } from "../../../lib/env";
import { logError, logWarn } from "../../../lib/log";

// Webhook do app RecepClinic na Meta (F6.1): um endereço para todas as
// clínicas; a clínica vem do número que recebeu cada evento (ou da conta, na
// situação dos templates).

// GET: verificação exigida pela Meta ao cadastrar o endereço do webhook no app.
export const GET: APIRoute = async ({ url }) => {
  const whatsapp = platformEnv().whatsapp;
  if (
    whatsapp &&
    url.searchParams.get("hub.mode") === "subscribe" &&
    url.searchParams.get("hub.verify_token") === whatsapp.webhookVerifyToken
  ) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
};

// POST: eventos. Assinatura conferida antes de tudo; a Meta espera 200 rápido
// (senão reenvia), então erro de um evento só vai para o log.
export const POST: APIRoute = async ({ request, url }) => {
  const whatsapp = platformEnv().whatsapp;
  if (!whatsapp) {
    logError("whatsapp webhook: WHATSAPP_APP_SECRET não configurada, evento recusado");
    return new Response("webhook não configurado", { status: 500 });
  }
  const rawBody = await request.text();
  if (!isValidMetaSignature(whatsapp.appSecret, rawBody, request.headers.get("x-hub-signature-256"))) {
    return new Response("assinatura inválida", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(null, { status: 200 });
  }

  const summary = await processWebhook(payload, {
    resolveClinic: (phoneNumberId) => resolveClinicByPhoneNumberId(phoneNumberId),
    clientFor: (clinicId) => createClinicServiceClient(clinicId),
    resolveClinicsByWaba: (wabaId) => resolveClinicsByWabaId(wabaId),
    senderFor: (clinicId) => clinicSenderFor(clinicId, url),
  });
  if (summary.errors || summary.unknownNumbers) logWarn("whatsapp webhook", { ...summary });
  return new Response(null, { status: 200 });
};
