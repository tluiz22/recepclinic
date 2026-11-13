import type { AsaasFiscalApi, AsaasInvoice } from "../asaas/fiscalApi";
import { formatInstant } from "../clinicTime";
import { logError } from "../log";
import { formatCentsBRL } from "../money";
import type { DbClient } from "./clients";
import { createClinicServiceClient } from "./clinicService";
import { getClinicSettings } from "./config/clinic";
import { platformInvoiceFiles, type PlatformInvoiceFiles } from "./platform";
import { getApprovedTemplate } from "./whatsapp/connection";
import { clinicSenderFor } from "./whatsapp/clinicSender";
import { isCustomerServiceWindowOpen, recordOutboundMessage, type SendOutcome } from "./whatsapp/messages";
import type { ClinicSender } from "./whatsapp/send";
import { clinicLabel, defaultTemplate, fillTemplate, firstName } from "./whatsapp/templates";

// Arquivos e entrega automática das notas do Asaas (N4; planejamento seções 5,
// 13.6 e 13.8). Emitida a nota (pela tela, pelo webhook ou pela conciliação),
// o PDF e o XML são copiados para os buckets privados e a entrega automática
// (só em Produção) fica pendente. A rotina manda o PDF pelo WhatsApp do
// contato e dos números com "enviar sempre", uma vez por destino, com novas
// tentativas. O e-mail da nota é o do Asaas ao tomador (decisão de 30/out).

export type AutoDeliveryDeps = {
  files: PlatformInvoiceFiles;
  senderFor: (clinicId: string) => Promise<ClinicSender | null>;
  serviceDb: (clinicId: string) => DbClient;
};

export function defaultAutoDeliveryDeps(siteUrl: string): AutoDeliveryDeps {
  return { files: platformInvoiceFiles(), senderFor: (clinicId) => clinicSenderFor(clinicId, siteUrl), serviceDb: (clinicId) => createClinicServiceClient(clinicId) };
}

/** Copia o PDF e o XML do Asaas (falhou um, guarda o outro; a rotina tenta de novo). */
export async function copyInvoiceFiles(files: PlatformInvoiceFiles, clinicId: string, invoiceId: string, remote: AsaasInvoice, fiscal: AsaasFiscalApi): Promise<void> {
  const grab = async (url: string | null) => {
    if (!url) return null;
    try {
      return await fiscal.download(url);
    } catch (error) {
      logError("nota fiscal: arquivo do Asaas", error, { nota: invoiceId });
      return null;
    }
  };
  const [pdf, xml] = await Promise.all([grab(remote.pdfUrl), grab(remote.xmlUrl)]);
  if (!pdf && !xml) return;
  await files.store(clinicId, invoiceId, { pdf, xml });
}

/** Manda a nota pelo WhatsApp (automático); true = todos os destinos saíram. */
export async function deliverAutomatically(invoiceId: string, deps: AutoDeliveryDeps): Promise<boolean> {
  const facts = await deps.files.deliveryFacts(invoiceId);
  if (!facts || facts.status !== "issued" || !facts.pdfPath || !facts.nfseNumber) return true;
  const db = deps.serviceDb(facts.clinicId);
  const sender = await deps.senderFor(facts.clinicId);
  const settings = await getClinicSettings(db, facts.clinicId);
  const template = await getApprovedTemplate(db, facts.clinicId, "nfse_document");
  const pdf = await deps.files.pdf(facts.pdfPath);
  const filename = `NFSe_${facts.nfseNumber}.pdf`;
  const label = clinicLabel(settings.name, settings.messageArticle);
  const values = (recipient: string) => [
    firstName(recipient),
    label,
    facts.nfseNumber!,
    formatCentsBRL(facts.amountCents),
    facts.patientName,
    formatInstant(new Date(facts.scheduledAt), settings.timezone, "dd/MM/yyyy"),
  ];
  const targets: { phone: string; name: string; target: "contact" | "other" }[] = [{ phone: facts.contactPhone, name: facts.contactName, target: "contact" }];
  if (facts.autoSend && facts.savedPhone && facts.savedPhone !== facts.contactPhone) targets.push({ phone: facts.savedPhone, name: facts.payerName, target: "other" });

  let mediaId: string | null = null;
  let allOk = true;
  for (const t of targets) {
    if (await deps.files.alreadySent(invoiceId, t.phone)) continue;
    let outcome: SendOutcome;
    if (!sender?.uploadDocument || !sender.documentTemplate || !sender.document) {
      outcome = { sent: false, reason: "WhatsApp da clínica não conectado" };
    } else {
      try {
        mediaId ??= await sender.uploadDocument({ bytes: pdf, filename });
        if (template) outcome = await sender.documentTemplate(t.phone, "nfse_document", template, values(t.name), { mediaId, filename });
        else if (await isCustomerServiceWindowOpen(db, facts.clinicId, t.phone)) outcome = await sender.document(t.phone, { mediaId, filename }, fillTemplate(defaultTemplate("nfse_document")!.body, values(t.name)));
        else outcome = { sent: false, reason: "o template da nota ainda não foi aprovado na Meta e a conversa com este número está fechada" };
      } catch (error) {
        logError("nota fiscal: envio automático", error, { clinica: facts.clinicId, nota: invoiceId });
        outcome = { sent: false, reason: error instanceof Error ? error.message : "falha no envio" };
      }
    }
    const messageId = await recordOutboundMessage(db, facts.clinicId, {
      phone: t.phone,
      appointmentId: facts.appointmentId,
      messageType: "nfse_document",
      templateName: template?.name ?? null,
      body: outcome.body ?? `[${filename}]`,
      status: outcome.sent ? "sent" : "failed",
      waMessageId: outcome.sent ? outcome.messageId : null,
      // Sem fila de reenvio da mensagem: a própria rotina da nota tenta de novo (evita PDF em dobro).
    }).catch((error) => {
      logError("nota fiscal: registro do envio automático", error, { clinica: facts.clinicId, nota: invoiceId });
      return null;
    });
    await deps.files.recordDelivery({ clinicId: facts.clinicId, invoiceId, destination: t.phone, target: t.target, ok: outcome.sent, error: outcome.sent ? null : outcome.reason, whatsappMessageId: messageId });
    if (!outcome.sent) allOk = false;
  }
  return allOk;
}

/** Rotina: arquivos que faltaram e entregas pendentes. */
export async function runInvoiceOutbox(deps: AutoDeliveryDeps, fiscalFor: (issuerId: string) => Promise<AsaasFiscalApi>): Promise<{ files: number; delivered: number; failed: number }> {
  let files = 0;
  for (const m of await deps.files.missingFiles()) {
    try {
      const fiscal = await fiscalFor(m.issuerId);
      await copyInvoiceFiles(deps.files, m.clinicId, m.invoiceId, await fiscal.getInvoice(m.asaasInvoiceId), fiscal);
      files++;
    } catch (error) {
      logError("nota fiscal: arquivos (rotina)", error, { nota: m.invoiceId });
    }
  }
  let delivered = 0;
  let failed = 0;
  for (const c of await deps.files.claimDeliveries()) {
    let ok = false;
    try {
      ok = await deliverAutomatically(c.invoiceId, deps);
    } catch (error) {
      logError("nota fiscal: entrega (rotina)", error, { nota: c.invoiceId });
    }
    await deps.files.finishDelivery(c.invoiceId, ok);
    if (ok) delivered++;
    else failed++;
  }
  return { files, delivered, failed };
}
