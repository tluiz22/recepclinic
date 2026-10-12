import { formatInstant } from "../clinicTime";
import { nfseEmail, type EmailSender } from "../email";
import { logError } from "../log";
import { formatCentsBRL } from "../money";
import { buildDanfse } from "../nfse/danfse";
import { normalizePhone } from "../phone";
import type { DbClient } from "./clients";
import { getClinicSettings } from "./config/clinic";
import { cleanText, DataError, unwrap, Validation } from "./errors";
import { getApprovedTemplate } from "./whatsapp/connection";
import { isCustomerServiceWindowOpen, recordOutboundMessage, type SendOutcome } from "./whatsapp/messages";
import type { ClinicSender } from "./whatsapp/send";
import { clinicLabel, fillTemplate, firstName, defaultTemplate } from "./whatsapp/templates";

// Envio da nota fiscal (F11.5, cliente, 12/out/2026): o PDF (DANFSe, gerado do
// XML guardado) pelo WhatsApp do contato, por outro número de WhatsApp e/ou
// por e-mail (com o PDF e o XML). Pelo WhatsApp: o template rc_nota_fiscal_v1
// com o PDF no topo; sem ele aprovado, só dentro da janela de 24h do contato,
// como documento com legenda. Cada envio fica em nfse_deliveries. Ao emitir em
// Produção, vai sozinho para o contato (e para o número e o e-mail guardados
// com "enviar sempre").

export type DeliveryTargets = {
  /** WhatsApp do contato do paciente. */
  contact: boolean;
  /** Outro número de WhatsApp (digitado ou o guardado). */
  phone?: string | null;
  email?: string | null;
  /** Guardar o número e o e-mail no Financeiro do paciente. */
  save?: boolean;
  /** Com `save`: enviar sempre para eles, junto com o contato. */
  autoSend?: boolean;
};

export type DeliveryDeps = { sender: ClinicSender | null; sendEmail: EmailSender };

export type DeliveryLine = { channel: "whatsapp" | "email"; destination: string; ok: boolean; reason: string | null };

export const DELIVERY_MESSAGES = {
  phone: "Outro número: confira o DDD e o número (ex.: (84) 98888-0000).",
  email: "E-mail inválido.",
  nothing: "Escolha pelo menos um destino.",
  notIssued: "Só nota emitida pode ser enviada.",
} as const;

type InvoiceForDelivery = {
  id: string;
  status: string;
  environment: string;
  nfse_number: string | null;
  xml_path: string | null;
  payment_id: string;
  payments: {
    amount_cents: number;
    payer_name: string;
    appointment_id: string;
    patient_id: string;
    appointments: { scheduled_at: string };
    patients: { full_name: string; contact_id: string; contacts: { full_name: string; phone: string } };
  };
};

async function loadInvoice(db: DbClient, clinicId: string, invoiceId: string): Promise<InvoiceForDelivery> {
  const row = unwrap(
    await db
      .from("nfse_invoices")
      .select(
        "id, status, environment, nfse_number, xml_path, payment_id, payments ( amount_cents, payer_name, appointment_id, patient_id, appointments ( scheduled_at ), patients ( full_name, contact_id, contacts ( full_name, phone ) ) )",
      )
      .eq("clinic_id", clinicId)
      .eq("id", invoiceId)
      .maybeSingle(),
    "Nota fiscal",
  ) as unknown as InvoiceForDelivery | null;
  if (!row) throw new DataError("not_found", "Nota fiscal: não encontrada");
  return row;
}

/** XML guardado da nota (bucket privado; a leitura passa pelo RLS do Storage). */
export async function loadInvoiceXml(db: DbClient, path: string): Promise<string> {
  const { data, error } = await db.storage.from("nfse-xml").download(path);
  if (error || !data) throw new DataError("not_found", "XML da nota: não encontrado");
  return data.text();
}

/** PDF (DANFSe) da nota: do XML guardado, com a marca "CANCELADA" se for o caso. */
export async function invoicePdf(db: DbClient, clinicId: string, invoiceId: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const invoice = unwrap(
    await db.from("nfse_invoices").select("status, nfse_number, xml_path").eq("clinic_id", clinicId).eq("id", invoiceId).maybeSingle(),
    "Nota fiscal",
  ) as { status: string; nfse_number: string | null; xml_path: string | null } | null;
  if (!invoice?.xml_path) throw new DataError("not_found", "Nota fiscal: XML não guardado");
  const xml = await loadInvoiceXml(db, invoice.xml_path);
  return { bytes: await buildDanfse(xml, { canceled: invoice.status === "canceled" }), filename: `NFSe_${invoice.nfse_number ?? invoiceId}.pdf` };
}

/** Guardados no Financeiro do paciente para as próximas notas. */
export async function getSavedDestinations(db: DbClient, clinicId: string, patientId: string): Promise<{ phone: string | null; email: string | null; autoSend: boolean }> {
  const row = unwrap(
    await db.from("patient_finance").select("invoice_phone, invoice_email, invoice_auto_send").eq("clinic_id", clinicId).eq("patient_id", patientId).maybeSingle(),
    "Financeiro do paciente",
  ) as { invoice_phone: string | null; invoice_email: string | null; invoice_auto_send: boolean } | null;
  return { phone: row?.invoice_phone ?? null, email: row?.invoice_email ?? null, autoSend: row?.invoice_auto_send ?? false };
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Confere e normaliza os destinos digitados. */
export function parseTargets(input: DeliveryTargets): { contact: boolean; phone: string | null; email: string | null } {
  const v = new Validation();
  const phoneText = cleanText(input.phone);
  const phone = phoneText ? normalizePhone(phoneText) : null;
  v.check(!phoneText || phone !== null, "phone", DELIVERY_MESSAGES.phone);
  const email = cleanText(input.email)?.toLowerCase() ?? null;
  v.check(!email || (EMAIL.test(email) && email.length <= 200), "email", DELIVERY_MESSAGES.email);
  v.check(input.contact || !!phone || !!email, "targets", DELIVERY_MESSAGES.nothing);
  v.throwIfInvalid("Envio da nota");
  return { contact: input.contact, phone, email };
}

/** Grava no Financeiro do paciente o número e o e-mail das notas (vazio apaga). */
export async function saveDestinations(
  db: DbClient,
  clinicId: string,
  patientId: string,
  destinations: { phone: string | null; email: string | null; autoSend: boolean },
): Promise<void> {
  unwrap(
    await db.from("patient_finance").upsert(
      {
        clinic_id: clinicId,
        patient_id: patientId,
        invoice_phone: destinations.phone,
        invoice_email: destinations.email,
        invoice_auto_send: destinations.autoSend && (!!destinations.phone || !!destinations.email),
      },
      { onConflict: "patient_id" },
    ),
    "Financeiro do paciente",
  );
}

/** Manda a nota emitida para os destinos escolhidos e registra cada envio. */
export async function deliverInvoice(
  db: DbClient,
  clinicId: string,
  invoiceId: string,
  input: DeliveryTargets,
  deps: DeliveryDeps,
  { automatic = false }: { automatic?: boolean } = {},
): Promise<DeliveryLine[]> {
  const targets = parseTargets(input);
  const invoice = await loadInvoice(db, clinicId, invoiceId);
  if (invoice.status !== "issued" || !invoice.xml_path || !invoice.nfse_number) throw new DataError("invalid", `Envio da nota: ${DELIVERY_MESSAGES.notIssued}`);
  if (input.save) await saveDestinations(db, clinicId, invoice.payments.patient_id, { phone: targets.phone, email: targets.email, autoSend: !!input.autoSend });

  const [settings, xml] = await Promise.all([getClinicSettings(db, clinicId), loadInvoiceXml(db, invoice.xml_path)]);
  const pdf = await buildDanfse(xml);
  const filename = `NFSe_${invoice.nfse_number}.pdf`;
  const label = clinicLabel(settings.name, settings.messageArticle);
  const payment = invoice.payments;
  const facts = {
    number: invoice.nfse_number,
    amount: formatCentsBRL(payment.amount_cents),
    patientName: payment.patients.full_name,
    appointmentDate: formatInstant(new Date(payment.appointments.scheduled_at), settings.timezone, "dd/MM/yyyy"),
  };
  const params = (recipient: string) => [firstName(recipient), label, facts.number, facts.amount, facts.patientName, facts.appointmentDate];

  const lines: DeliveryLine[] = [];
  const record = async (line: DeliveryLine, target: "contact" | "other", whatsappMessageId: string | null) => {
    lines.push(line);
    unwrap(
      await db.from("nfse_deliveries").insert({
        clinic_id: clinicId,
        invoice_id: invoiceId,
        channel: line.channel,
        destination: line.destination,
        target,
        status: line.ok ? "sent" : "failed",
        error: line.reason,
        whatsapp_message_id: whatsappMessageId,
        automatic,
      }),
      "Envio da nota",
    );
  };

  // WhatsApp: o PDF sobe uma vez para a Meta e vai para cada número.
  let mediaId: string | null = null;
  const template = await getApprovedTemplate(db, clinicId, "nfse_document");
  const whatsapp = async (phone: string, recipient: string, target: "contact" | "other") => {
    let outcome: SendOutcome;
    if (!deps.sender?.uploadDocument || !deps.sender.documentTemplate || !deps.sender.document) {
      outcome = { sent: false, reason: "WhatsApp da clínica não conectado" };
    } else {
      try {
        mediaId ??= await deps.sender.uploadDocument({ bytes: pdf, filename });
        const values = params(recipient);
        if (template) {
          outcome = await deps.sender.documentTemplate(phone, "nfse_document", template, values, { mediaId, filename });
        } else if (await isCustomerServiceWindowOpen(db, clinicId, phone)) {
          outcome = await deps.sender.document(phone, { mediaId, filename }, fillTemplate(defaultTemplate("nfse_document")!.body, values));
        } else {
          outcome = { sent: false, reason: "o template da nota ainda não foi aprovado na Meta e a conversa com este número está fechada" };
        }
      } catch (error) {
        logError("nota fiscal: envio pelo WhatsApp", error, { clinica: clinicId, nota: invoiceId });
        outcome = { sent: false, reason: error instanceof Error ? error.message : "falha no envio" };
      }
    }
    const messageId = await recordOutboundMessage(db, clinicId, {
      phone,
      appointmentId: payment.appointment_id,
      messageType: "nfse_document",
      templateName: template?.name ?? null,
      body: outcome.body ?? `[${filename}]`,
      status: outcome.sent ? "sent" : "failed",
      waMessageId: outcome.sent ? outcome.messageId : null,
    }).catch((error) => {
      logError("nota fiscal: registro do envio", error, { clinica: clinicId, nota: invoiceId });
      return null;
    });
    await record({ channel: "whatsapp", destination: phone, ok: outcome.sent, reason: outcome.sent ? null : outcome.reason }, target, messageId);
  };

  if (targets.contact) await whatsapp(payment.patients.contacts.phone, payment.patients.contacts.full_name, "contact");
  if (targets.phone && !(targets.contact && targets.phone === payment.patients.contacts.phone)) await whatsapp(targets.phone, payment.payer_name, "other");
  if (targets.email) {
    try {
      await deps.sendEmail(nfseEmail(targets.email, { recipient: firstName(payment.payer_name), clinicLabel: label, clinicName: settings.name, ...facts, pdf, xml }));
      await record({ channel: "email", destination: targets.email, ok: true, reason: null }, "other", null);
    } catch (error) {
      logError("nota fiscal: envio por e-mail", error, { clinica: clinicId, nota: invoiceId });
      await record({ channel: "email", destination: targets.email, ok: false, reason: "o e-mail não saiu" }, "other", null);
    }
  }
  return lines;
}

/** Ao emitir em Produção: o contato e, com "enviar sempre", o número e o e-mail guardados. */
export async function deliverAfterIssue(db: DbClient, clinicId: string, invoiceId: string, deps: DeliveryDeps): Promise<DeliveryLine[]> {
  const invoice = await loadInvoice(db, clinicId, invoiceId);
  if (invoice.environment !== "production" || invoice.status !== "issued") return [];
  const saved = await getSavedDestinations(db, clinicId, invoice.payments.patient_id);
  return deliverInvoice(
    db,
    clinicId,
    invoiceId,
    { contact: true, phone: saved.autoSend ? saved.phone : null, email: saved.autoSend ? saved.email : null },
    deps,
    { automatic: true },
  );
}

/** "Enviada pelo WhatsApp para (84) 9…" para o aviso da tela. */
export function describeDelivery(lines: DeliveryLine[]): string {
  if (!lines.length) return "";
  return lines
    .map((l) => `${l.channel === "email" ? "E-mail" : "WhatsApp"} ${l.destination}: ${l.ok ? "enviado" : `não saiu (${l.reason})`}`)
    .join(" · ");
}

export type InvoiceDelivery = {
  id: string;
  invoiceId: string;
  channel: "whatsapp" | "email";
  destination: string;
  target: "contact" | "other";
  status: "sent" | "failed" | "delivered" | "read";
  error: string | null;
  automatic: boolean;
  createdAt: Date;
};

/** Envios das notas, com a entrega do WhatsApp (o webhook atualiza a mensagem). */
export async function listInvoiceDeliveries(db: DbClient, clinicId: string, invoiceIds: string[]): Promise<Map<string, InvoiceDelivery[]>> {
  const map = new Map<string, InvoiceDelivery[]>();
  if (!invoiceIds.length) return map;
  const rows = unwrap(
    await db
      .from("nfse_deliveries")
      .select("id, invoice_id, channel, destination, target, status, error, automatic, created_at, whatsapp_message_id")
      .eq("clinic_id", clinicId)
      .in("invoice_id", invoiceIds)
      .order("created_at", { ascending: false }),
    "Envios da nota",
  ) as { id: string; invoice_id: string; channel: string; destination: string; target: string; status: string; error: string | null; automatic: boolean; created_at: string; whatsapp_message_id: string | null }[];
  const messageIds = rows.map((r) => r.whatsapp_message_id).filter((id): id is string => !!id);
  const statuses = new Map<string, string>();
  if (messageIds.length) {
    const messages = unwrap(await db.from("whatsapp_messages").select("id, status").eq("clinic_id", clinicId).in("id", messageIds), "Mensagens") as { id: string; status: string | null }[];
    for (const m of messages) if (m.status) statuses.set(m.id, m.status);
  }
  for (const r of rows) {
    const live = r.whatsapp_message_id ? statuses.get(r.whatsapp_message_id) : undefined;
    const status = (r.status === "sent" && (live === "delivered" || live === "read") ? live : live === "failed" ? "failed" : r.status) as InvoiceDelivery["status"];
    map.set(r.invoice_id, [
      ...(map.get(r.invoice_id) ?? []),
      {
        id: r.id,
        invoiceId: r.invoice_id,
        channel: r.channel as InvoiceDelivery["channel"],
        destination: r.destination,
        target: r.target as InvoiceDelivery["target"],
        status,
        error: r.error,
        automatic: r.automatic,
        createdAt: new Date(r.created_at),
      },
    ]);
  }
  return map;
}
