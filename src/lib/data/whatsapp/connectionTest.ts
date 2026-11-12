import { normalizePhone } from "../../phone";
import type { DbClient } from "../clients";
import { DataError, unwrap } from "../errors";
import { getApprovedTemplate } from "./connection";
import { recordOutboundMessage } from "./messages";
import type { ClinicSender } from "./send";
import { cleanParam, fillTemplate, firstName } from "./templates";

// Mensagem de teste (IS2; cliente, 03/nov/2026; docs/arquivo/modulos/implantacao-segura.md): o Administrador ou o Suporte manda o
// modelo `rc_teste_envio_v1` para o próprio celular e vê se a Meta entrega. Prova o cartão na Meta e o modelo
// aprovado antes do primeiro paciente (o incidente de 03/nov: a "forma de pagamento conferida" era só visual).
// Sai também com a clínica em implantação, e nunca para pacientes (o número é digitado por quem testa). A situação
// chega pelo webhook (enviada → entregue → lida, ou falhou com o código da Meta). A ativação da clínica exige um
// teste entregue ou lido.

export const CONNECTION_TEST_MESSAGE_TYPE = "connection_test";

export type ConnectionTest = {
  at: Date;
  phone: string;
  /** sent, delivered, read ou failed. */
  status: string;
  failureCode: number | null;
  failureReason: string | null;
};

const DELIVERED = ["delivered", "read"];

/** Entregue ou lida no celular. */
export const connectionTestDelivered = (test: Pick<ConnectionTest, "status"> | null) => !!test && DELIVERED.includes(test.status);

/** Envia o teste. Erro (DataError) quando não dá para tentar: número inválido, WhatsApp sem conexão ou modelo não aprovado. */
export async function sendConnectionTest(
  db: DbClient,
  clinicId: string,
  input: { phone: string; name?: string | null },
  sender: ClinicSender | null,
  now: Date = new Date(),
): Promise<ConnectionTest> {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new DataError("invalid", "Mensagem de teste: telefone inválido", { telefone: "Informe um celular com DDD, ex.: (61) 99999-9999." });
  if (!sender) throw new DataError("invalid", "Mensagem de teste: WhatsApp não conectado", { telefone: "Conecte o WhatsApp da clínica antes do teste." });
  const template = await getApprovedTemplate(db, clinicId, "connection_test");
  if (!template) {
    throw new DataError("invalid", "Mensagem de teste: modelo não aprovado", {
      telefone: "O modelo da mensagem de teste ainda não foi aprovado pela Meta (a análise leva de minutos a algumas horas).",
    });
  }
  const params = [firstName(input.name?.trim() || "equipe"), sender.clinicLabel].map(cleanParam);
  let outcome;
  try {
    outcome = await sender.template(phone, "connection_test", template, params);
  } catch (error) {
    outcome = { sent: false as const, reason: error instanceof Error ? error.message : String(error) };
  }
  const id = await recordOutboundMessage(
    db,
    clinicId,
    {
      phone,
      contactId: null,
      messageType: CONNECTION_TEST_MESSAGE_TYPE,
      templateName: template.name,
      body: outcome.body ?? fillTemplate(template.body ?? "", params),
      status: outcome.sent ? "sent" : "failed",
      waMessageId: outcome.sent ? outcome.messageId : null,
    },
    now,
  );
  const failureCode = !outcome.sent && "failure" in outcome ? (outcome.failure?.code ?? null) : null;
  const failureReason = !outcome.sent ? outcome.reason.slice(0, 300) : null;
  // Recusado na hora: o motivo fica na mensagem, como os da Meta pelo webhook (sem reenvio automático).
  if (!outcome.sent) {
    unwrap(
      await db.from("whatsapp_messages").update({ failure_code: failureCode, failure_reason: failureReason }).eq("clinic_id", clinicId).eq("id", id),
      "Mensagem do WhatsApp",
    );
  }
  return { at: now, phone, status: outcome.sent ? "sent" : "failed", failureCode, failureReason };
}

type Row = { created_at: string; contact_phone: string; status: string | null; failure_code: number | null; failure_reason: string | null };
const toTest = (row: Row): ConnectionTest => ({
  at: new Date(row.created_at),
  phone: row.contact_phone,
  status: row.status ?? "sent",
  failureCode: row.failure_code,
  failureReason: row.failure_reason,
});

/** O último teste da clínica (null = nenhum). */
export async function getLatestConnectionTest(db: DbClient, clinicId: string): Promise<ConnectionTest | null> {
  const rows = unwrap(
    await db
      .from("whatsapp_messages")
      .select("created_at, contact_phone, status, failure_code, failure_reason")
      .eq("clinic_id", clinicId)
      .eq("direction", "outbound")
      .eq("message_type", CONNECTION_TEST_MESSAGE_TYPE)
      .order("created_at", { ascending: false })
      .limit(1),
    "Mensagem de teste",
  ) as Row[];
  return rows.length ? toTest(rows[0]) : null;
}

/** O último teste entregue ou lido (null = nenhum): a ativação da clínica exige um. */
export async function getDeliveredConnectionTest(db: DbClient, clinicId: string): Promise<ConnectionTest | null> {
  const rows = unwrap(
    await db
      .from("whatsapp_messages")
      .select("created_at, contact_phone, status, failure_code, failure_reason")
      .eq("clinic_id", clinicId)
      .eq("direction", "outbound")
      .eq("message_type", CONNECTION_TEST_MESSAGE_TYPE)
      .in("status", DELIVERED)
      .order("created_at", { ascending: false })
      .limit(1),
    "Mensagem de teste",
  ) as Row[];
  return rows.length ? toTest(rows[0]) : null;
}
