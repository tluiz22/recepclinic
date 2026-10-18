import { isCalendarDate } from "../clinicTime";
import type { DbClient } from "./clients";
import type { AppointmentStatus } from "./agenda/appointments";
import { cleanText, unwrap, unwrapOne, Validation } from "./errors";
import { effectivePayer, FINANCE_MESSAGES, getContactCpf, getPatientFinance, type Payer } from "./finance";
import type { Contact, Patient } from "./patients";
import { normalizeCpf } from "../cpf";

// Pagamentos do atendimento (F11.2, cliente, 12/out/2026), no Módulo
// financeiro. Vários por atendimento; só marcado, confirmado ou que
// compareceu recebe pagamento novo. Quem pagou vem do responsável financeiro
// do paciente e pode ser trocado só naquele pagamento; nome e CPF ficam
// gravados no pagamento. O CPF não é obrigatório aqui (a nota, F11.4, é que
// exige). Corrigir é excluir (fica guardado como excluído) e registrar de
// novo. O Administrador e a Recepção gravam; o Suporte só lê (RLS).

export type PaymentMethod = "pix" | "cash" | "credit_card" | "debit_card";

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "pix", label: "Pix" },
  { value: "cash", label: "Dinheiro" },
  { value: "credit_card", label: "Crédito" },
  { value: "debit_card", label: "Débito" },
];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.value, m.label])) as Record<
  PaymentMethod,
  string
>;

export type Payment = {
  id: string;
  appointmentId: string;
  patientId: string;
  amountCents: number;
  method: PaymentMethod;
  /** Data do pagamento (calendário da clínica). */
  paidOn: string;
  payer: Payer;
  payerName: string;
  /** 11 dígitos, ou null (falta para a nota). */
  payerCpf: string | null;
  createdAt: Date;
  /** Excluído (correção): fica guardado, fora das somas. */
  deletedAt: Date | null;
};

export const PAYMENT_MESSAGES = {
  amount: "Informe um valor maior que zero.",
  /** Valor que não é número (U-08 da auditoria, cliente, 17/out/2026). */
  amountFormat: "Informe o valor em reais, ex.: 150,00.",
  method: "Escolha a forma de pagamento.",
  paidOn: "Informe a data do pagamento (hoje ou antes).",
  status: "Atendimento cancelado ou com falta não recebe pagamento novo.",
} as const;

/** Situações que recebem pagamento novo (cliente, 12/out/2026). */
export function canReceivePayment(status: AppointmentStatus): boolean {
  return status === "scheduled" || status === "confirmed" || status === "completed";
}

export type PaymentSummary = {
  /** Preço do atendimento (null = sem preço). */
  priceCents: number | null;
  paidCents: number;
  /** O que falta (0 se já pagou tudo); null sem preço. */
  remainingCents: number | null;
  /** A soma passou do preço. */
  overPrice: boolean;
};

/** Soma dos pagamentos que valem (os excluídos ficam de fora) contra o preço. */
export function summarizePayments(priceCents: number | null, payments: Pick<Payment, "amountCents" | "deletedAt">[]): PaymentSummary {
  const paidCents = payments.filter((p) => !p.deletedAt).reduce((sum, p) => sum + p.amountCents, 0);
  return {
    priceCents,
    paidCents,
    remainingCents: priceCents === null ? null : Math.max(priceCents - paidCents, 0),
    overPrice: priceCents !== null && paidCents > priceCents,
  };
}

export type PaymentState = "paid" | "partial" | "none";

/** Selo da Agenda: pago (tudo, ou algo num atendimento sem preço), em parte ou nada. */
export function paymentState(priceCents: number | null, paidCents: number): PaymentState {
  if (paidCents <= 0) return "none";
  return priceCents === null || paidCents >= priceCents ? "paid" : "partial";
}

type PaymentRow = {
  id: string;
  appointment_id: string;
  patient_id: string;
  amount_cents: number;
  method: string;
  paid_on: string;
  payer: string;
  payer_name: string;
  payer_cpf: string | null;
  created_at: string;
  deleted_at: string | null;
};

const PAYMENT_COLUMNS = "id, appointment_id, patient_id, amount_cents, method, paid_on, payer, payer_name, payer_cpf, created_at, deleted_at";

const toPayment = (row: PaymentRow): Payment => ({
  id: row.id,
  appointmentId: row.appointment_id,
  patientId: row.patient_id,
  amountCents: row.amount_cents,
  method: row.method as PaymentMethod,
  paidOn: row.paid_on,
  payer: row.payer as Payer,
  payerName: row.payer_name,
  payerCpf: row.payer_cpf,
  createdAt: new Date(row.created_at),
  deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
});

/** Pagamentos do atendimento, os excluídos inclusive, do mais antigo ao mais novo. */
export async function listAppointmentPayments(db: DbClient, clinicId: string, appointmentId: string): Promise<Payment[]> {
  const rows = unwrap(
    await db.from("payments").select(PAYMENT_COLUMNS).eq("clinic_id", clinicId).eq("appointment_id", appointmentId).order("created_at"),
    "Pagamentos",
  ) as PaymentRow[];
  return rows.map(toPayment);
}

/** Preço gravado no atendimento (null = sem preço). */
export async function getAppointmentPrice(db: DbClient, clinicId: string, appointmentId: string): Promise<number | null> {
  const row = unwrapOne(
    await db.from("appointments").select("price_cents").eq("clinic_id", clinicId).eq("id", appointmentId).maybeSingle(),
    "Atendimento",
  ) as { price_cents: number | null };
  return row.price_cents;
}

/** Para os selos da Agenda: preço e total pago (sem os excluídos) de cada atendimento. */
export async function listPaymentStates(
  db: DbClient,
  clinicId: string,
  appointmentIds: string[],
): Promise<Map<string, PaymentState>> {
  if (!appointmentIds.length) return new Map();
  const [paid, prices] = await Promise.all([
    db.from("payments").select("appointment_id, amount_cents").eq("clinic_id", clinicId).in("appointment_id", appointmentIds).is("deleted_at", null),
    db.from("appointments").select("id, price_cents").eq("clinic_id", clinicId).in("id", appointmentIds),
  ]);
  const totals = new Map<string, number>();
  for (const row of unwrap(paid, "Pagamentos") as { appointment_id: string; amount_cents: number }[]) {
    totals.set(row.appointment_id, (totals.get(row.appointment_id) ?? 0) + row.amount_cents);
  }
  const states = new Map<string, PaymentState>();
  for (const row of unwrap(prices, "Atendimentos") as { id: string; price_cents: number | null }[]) {
    states.set(row.id, paymentState(row.price_cents, totals.get(row.id) ?? 0));
  }
  return states;
}

export type PatientPayment = Payment & { appointmentAt: Date; serviceName: string };

/** Últimos pagamentos do paciente (cartão Financeiro), os excluídos inclusive. */
export async function listPatientPayments(db: DbClient, clinicId: string, patientId: string, limit = 20): Promise<PatientPayment[]> {
  const rows = unwrap(
    await db
      .from("payments")
      .select(`${PAYMENT_COLUMNS}, appointments ( scheduled_at, services ( name ) )`)
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit),
    "Pagamentos",
  ) as unknown as (PaymentRow & { appointments: { scheduled_at: string; services: { name: string } } })[];
  return rows.map((row) => ({ ...toPayment(row), appointmentAt: new Date(row.appointments.scheduled_at), serviceName: row.appointments.services.name }));
}

export type PaymentInput = {
  /** Centavos (NaN = inválido). */
  amountCents: number;
  method: string;
  paidOn: string;
  payer: string;
  /** Só com payer "other". */
  payerName?: string | null;
  /** CPF digitado: o de outra pessoa, ou o que faltava no contato ou no paciente. */
  payerCpf?: string | null;
};

/**
 * Registra um pagamento do atendimento. Quem pagou: o contato, o próprio
 * paciente (nome do cadastro, CPF do módulo) ou outra pessoa (nome e CPF
 * digitados, só neste pagamento). CPF que faltava no contato ou no paciente,
 * digitado aqui, vai também para o cadastro financeiro dele.
 */
export async function registerPayment(
  db: DbClient,
  clinicId: string,
  target: {
    appointmentId: string;
    status: AppointmentStatus;
    patient: Pick<Patient, "id" | "fullName" | "contactId" | "isContactSelf">;
    contact: Pick<Contact, "fullName">;
    today: string;
  },
  input: PaymentInput,
): Promise<Payment> {
  const { patient } = target;
  const v = new Validation();
  v.check(canReceivePayment(target.status), "status", PAYMENT_MESSAGES.status);
  v.check(Number.isInteger(input.amountCents) && input.amountCents > 0, "amount", Number.isNaN(input.amountCents) ? PAYMENT_MESSAGES.amountFormat : PAYMENT_MESSAGES.amount);
  const method = PAYMENT_METHODS.find((m) => m.value === input.method)?.value;
  v.check(method !== undefined, "method", PAYMENT_MESSAGES.method);
  v.check(isCalendarDate(input.paidOn) && input.paidOn <= target.today, "paid_on", PAYMENT_MESSAGES.paidOn);

  const payer = effectivePayer(patient, (["contact", "patient", "other"] as const).find((p) => p === input.payer) ?? "contact");
  const typedText = cleanText(input.payerCpf);
  const typedCpf = typedText ? normalizeCpf(typedText) : null;
  v.check(!typedText || typedCpf !== null, "payer_cpf", FINANCE_MESSAGES.invalidCpf);

  let payerName: string | null;
  let payerCpf: string | null;
  let saveToRecord: "contact" | "patient" | null = null;
  if (payer === "other") {
    payerName = cleanText(input.payerName);
    v.check(payerName !== null, "payer_name", FINANCE_MESSAGES.payerName);
    payerCpf = typedCpf;
  } else if (payer === "contact") {
    payerName = target.contact.fullName;
    const onRecord = await getContactCpf(db, clinicId, patient.contactId);
    payerCpf = onRecord ?? typedCpf;
    if (!onRecord && typedCpf) saveToRecord = "contact";
  } else {
    payerName = patient.fullName;
    const onRecord = (await getPatientFinance(db, clinicId, patient.id)).cpf;
    payerCpf = onRecord ?? typedCpf;
    if (!onRecord && typedCpf) saveToRecord = "patient";
  }
  v.throwIfInvalid("Pagamento");

  const row = unwrap(
    await db
      .from("payments")
      .insert({
        clinic_id: clinicId,
        appointment_id: target.appointmentId,
        patient_id: patient.id,
        amount_cents: input.amountCents,
        method: method!,
        paid_on: input.paidOn,
        payer,
        payer_name: payerName!,
        payer_cpf: payerCpf,
      })
      .select(PAYMENT_COLUMNS)
      .single(),
    "Pagamento",
  ) as PaymentRow;

  if (saveToRecord === "contact") {
    unwrap(
      await db.from("contact_finance").upsert({ clinic_id: clinicId, contact_id: patient.contactId, cpf: typedCpf }, { onConflict: "contact_id" }),
      "Dados financeiros do contato",
    );
  } else if (saveToRecord === "patient") {
    unwrap(
      await db.from("patient_finance").upsert({ clinic_id: clinicId, patient_id: patient.id, cpf: typedCpf }, { onConflict: "patient_id" }),
      "Dados financeiros do paciente",
    );
  }
  return toPayment(row);
}

/** Exclui (correção): o pagamento sai das somas e fica guardado com quem e quando. */
export async function deletePayment(db: DbClient, clinicId: string, paymentId: string): Promise<void> {
  unwrapOne(
    await db
      .from("payments")
      .update({ deleted_at: new Date().toISOString() })
      .eq("clinic_id", clinicId)
      .eq("id", paymentId)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle(),
    "Pagamento",
  );
}
