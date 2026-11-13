import { normalizeCpf } from "../cpf";
import { normalizePhone } from "../phone";
import type { DbClient } from "./clients";
import { cleanText, fromDbError, unwrap, Validation } from "./errors";
import { listPatientsPage, type Contact, type Page, type Patient, type PatientWithContact } from "./patients";

// Módulo financeiro (F11.1, cliente, 12/out/2026): CPF e responsável
// financeiro, guardados fora do cadastro (contact_finance e patient_finance),
// só com o item "finance" liberado. O Administrador e a Recepção leem e
// gravam; o Suporte só lê; o Profissional e o bot não veem (RLS).
//
// Responsável financeiro (quem paga e em nome de quem sai a nota): por padrão
// o contato do WhatsApp (que é o próprio paciente quando ele fala por si);
// pode ser o próprio paciente ou outra pessoa, com nome e CPF. Só o CPF do
// responsável será exigido para emitir a nota (F11.4); o do paciente é
// opcional. O paciente que fala por si é o
// próprio contato: o CPF dele fica uma vez só, no contato.

export type Payer = "contact" | "patient" | "other";

export type PatientFinance = {
  /** 11 dígitos, ou null. Sempre null no paciente que é o próprio contato. */
  cpf: string | null;
  payer: Payer;
  /** Só com payer "other". */
  payerName: string | null;
  payerCpf: string | null;
};

export const DEFAULT_PATIENT_FINANCE: PatientFinance = { cpf: null, payer: "contact", payerName: null, payerCpf: null };

/** Quem paga, já resolvido: nome e CPF (null = falta cadastrar). */
export type ResolvedPayer = { payer: Payer; name: string; cpf: string | null };

export const FINANCE_MESSAGES = {
  invalidCpf: "CPF inválido: confira os 11 dígitos.",
  payerName: "Informe o nome do responsável financeiro.",
  payerCpf: "Informe o CPF do responsável financeiro.",
  invoicePhone: "WhatsApp das notas inválido: informe DDD + número, ex.: (84) 98188-0777.",
  invoiceEmail: "E-mail das notas inválido.",
} as const;

type PatientFinanceRow = { patient_id: string; cpf: string | null; payer: string; payer_name: string | null; payer_cpf: string | null };

const toPatientFinance = (row: PatientFinanceRow): PatientFinance => ({
  cpf: row.cpf,
  payer: row.payer as Payer,
  payerName: row.payer_name,
  payerCpf: row.payer_cpf,
});

/** O paciente que fala por si não tem "contato" separado: o responsável padrão é ele. */
export function effectivePayer(patient: Pick<Patient, "isContactSelf">, payer: Payer): Payer {
  return patient.isContactSelf && payer === "patient" ? "contact" : payer;
}

/** Nome e CPF de quem paga, pelos dados do paciente, do contato e do módulo. */
export function resolvePayer(
  patient: Pick<Patient, "fullName" | "isContactSelf">,
  contact: Pick<Contact, "fullName">,
  finance: PatientFinance,
  contactCpf: string | null,
): ResolvedPayer {
  const payer = effectivePayer(patient, finance.payer);
  if (payer === "other") return { payer, name: finance.payerName ?? "", cpf: finance.payerCpf };
  if (payer === "patient") return { payer, name: patient.fullName, cpf: finance.cpf };
  return { payer, name: contact.fullName, cpf: contactCpf };
}

/** CPF opcional digitado: vazio vira null; inválido entra na validação. */
function optionalCpf(v: Validation, field: string, input: string | null | undefined): string | null {
  const text = cleanText(input);
  if (!text) return null;
  const cpf = normalizeCpf(text);
  v.check(cpf !== null, field, FINANCE_MESSAGES.invalidCpf);
  return cpf;
}

export async function getPatientFinance(db: DbClient, clinicId: string, patientId: string): Promise<PatientFinance> {
  const row = unwrap(
    await db.from("patient_finance").select("patient_id, cpf, payer, payer_name, payer_cpf").eq("clinic_id", clinicId).eq("patient_id", patientId).maybeSingle(),
    "Dados financeiros do paciente",
  ) as PatientFinanceRow | null;
  return row ? toPatientFinance(row) : { ...DEFAULT_PATIENT_FINANCE };
}

export async function getContactCpf(db: DbClient, clinicId: string, contactId: string): Promise<string | null> {
  const row = unwrap(
    await db.from("contact_finance").select("cpf").eq("clinic_id", clinicId).eq("contact_id", contactId).maybeSingle(),
    "Dados financeiros do contato",
  ) as { cpf: string | null } | null;
  return row?.cpf ?? null;
}

export async function saveContactCpf(db: DbClient, clinicId: string, contactId: string, input: string | null | undefined): Promise<void> {
  const v = new Validation();
  const cpf = optionalCpf(v, "cpf", input);
  v.throwIfInvalid("CPF");
  unwrap(
    await db.from("contact_finance").upsert({ clinic_id: clinicId, contact_id: contactId, cpf }, { onConflict: "contact_id" }),
    "Dados financeiros do contato",
  );
}

export type PatientFinanceInput = {
  cpf?: string | null;
  payer: string;
  payerName?: string | null;
  payerCpf?: string | null;
  /**
   * CPF do contato, editado na mesma tela: o do próprio paciente, quando ele é
   * o contato, ou o do contato responsável.
   */
  contactCpf?: string | null;
  /**
   * Envio da nota (F11.5): outro WhatsApp e e-mail para as notas, e "enviar
   * sempre" junto com o contato. Ausentes = não mexe.
   */
  invoicePhone?: string | null;
  invoiceEmail?: string | null;
  invoiceAutoSend?: boolean;
};

/**
 * Grava CPF e responsável financeiro do paciente. O CPF do contato vale para
 * todos os pacientes dele; o paciente que é o próprio contato só tem esse.
 */
export async function savePatientFinance(
  db: DbClient,
  clinicId: string,
  patient: Pick<Patient, "id" | "contactId" | "isContactSelf">,
  input: PatientFinanceInput,
): Promise<void> {
  const v = new Validation();
  const payer = effectivePayer(patient, (["contact", "patient", "other"] as const).find((p) => p === input.payer) ?? "contact");
  const cpf = patient.isContactSelf ? null : optionalCpf(v, "cpf", input.cpf);
  const payerName = payer === "other" ? cleanText(input.payerName) : null;
  const payerCpf = payer === "other" ? optionalCpf(v, "payer_cpf", input.payerCpf) : null;
  if (payer === "other") {
    v.check(payerName !== null, "payer_name", FINANCE_MESSAGES.payerName);
    v.check(payerCpf !== null, "payer_cpf", FINANCE_MESSAGES.payerCpf);
  }
  const editsContact = input.contactCpf !== undefined;
  const contactCpf = editsContact ? optionalCpf(v, "contact_cpf", input.contactCpf) : null;
  const editsDelivery = input.invoicePhone !== undefined || input.invoiceEmail !== undefined;
  const phoneText = cleanText(input.invoicePhone);
  const invoicePhone = phoneText ? normalizePhone(phoneText) : null;
  v.check(!phoneText || invoicePhone !== null, "invoice_phone", FINANCE_MESSAGES.invoicePhone);
  const invoiceEmail = cleanText(input.invoiceEmail)?.toLowerCase() ?? null;
  v.check(!invoiceEmail || (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(invoiceEmail) && invoiceEmail.length <= 200), "invoice_email", FINANCE_MESSAGES.invoiceEmail);
  v.throwIfInvalid("Dados financeiros");
  const delivery = editsDelivery
    ? { invoice_phone: invoicePhone, invoice_email: invoiceEmail, invoice_auto_send: !!input.invoiceAutoSend && (!!invoicePhone || !!invoiceEmail) }
    : {};

  unwrap(
    await db
      .from("patient_finance")
      .upsert({ clinic_id: clinicId, patient_id: patient.id, cpf, payer, payer_name: payerName, payer_cpf: payerCpf, ...delivery }, { onConflict: "patient_id" }),
    "Dados financeiros do paciente",
  );
  if (editsContact) {
    unwrap(
      await db.from("contact_finance").upsert({ clinic_id: clinicId, contact_id: patient.contactId, cpf: contactCpf }, { onConflict: "contact_id" }),
      "Dados financeiros do contato",
    );
  }
}

export type FinancePatientRow = PatientWithContact & { finance: PatientFinance; responsible: ResolvedPayer };

/**
 * Lista do menu Financeiro: pacientes ativos (busca e páginas como em
 * Pacientes) com o responsável financeiro e se o CPF dele já está cadastrado.
 */
export async function listFinancePatientsPage(
  db: DbClient,
  clinicId: string,
  options: { query?: string; page?: number; missingCpf?: boolean } = {},
): Promise<Page<FinancePatientRow>> {
  const page = await listPatientsPage(db, clinicId, { query: options.query, page: options.page, missingPayerCpf: options.missingCpf });
  const patientIds = page.items.map((p) => p.id);
  const contactIds = [...new Set(page.items.map((p) => p.contactId))];
  const [financeRows, contactRows] = patientIds.length
    ? await Promise.all([
        db.from("patient_finance").select("patient_id, cpf, payer, payer_name, payer_cpf").eq("clinic_id", clinicId).in("patient_id", patientIds),
        db.from("contact_finance").select("contact_id, cpf").eq("clinic_id", clinicId).in("contact_id", contactIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  const finance = new Map((unwrap(financeRows, "Dados financeiros") as PatientFinanceRow[]).map((row) => [row.patient_id, toPatientFinance(row)]));
  const contactCpf = new Map((unwrap(contactRows, "Dados financeiros") as { contact_id: string; cpf: string | null }[]).map((row) => [row.contact_id, row.cpf]));
  return {
    ...page,
    items: page.items.map((patient) => {
      const data = finance.get(patient.id) ?? { ...DEFAULT_PATIENT_FINANCE };
      return { ...patient, finance: data, responsible: resolvePayer(patient, patient.contact, data, contactCpf.get(patient.contactId) ?? null) };
    }),
  };
}

/** Quantos pacientes ativos ainda não têm o CPF de quem paga (filtro "Falta CPF", R8). */
export async function countPatientsMissingPayerCpf(db: DbClient, clinicId: string): Promise<number> {
  const { error, count } = await db
    .rpc("finance_patients_missing_payer_cpf", { p_clinic_id: clinicId }, { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("is_active", true);
  unwrap({ data: null, error }, "Dados financeiros");
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Tomador da nota pelo Asaas (N3a; planejamento-nfse-asaas.md 13.6): e-mail e
// endereço de quem paga. Não são exigidos para registrar o pagamento; só ao
// emitir a nota. Ficam no Financeiro (contato ou paciente) e no pagamento.
// ---------------------------------------------------------------------------

export type PayerContact = {
  email: string;
  postalCode: string;
  street: string;
  number: string;
  complement: string | null;
  district: string;
};

export type PayerContactInput = { email: string; postalCode: string; street: string; number: string; complement: string; district: string };

export const PAYER_CONTACT_MESSAGES = {
  email: "E-mail de quem paga inválido (o Asaas manda a nota para ele).",
  postalCode: "CEP com 8 dígitos.",
  street: "Informe a rua.",
  number: "Informe o número (ou s/n).",
  district: "Informe o bairro.",
} as const;

/** Valida o e-mail e o endereço; tudo vazio = null (nada a gravar). */
export function parsePayerContact(input: PayerContactInput, { required = false }: { required?: boolean } = {}): PayerContact | null {
  const email = cleanText(input.email)?.toLowerCase() ?? null;
  const postalCode = input.postalCode.replace(/\D/g, "");
  const street = cleanText(input.street);
  const number = cleanText(input.number);
  const district = cleanText(input.district);
  if (!required && !email && !postalCode && !street && !number && !district && !cleanText(input.complement)) return null;
  const v = new Validation();
  v.check(email !== null && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 200, "payer_email", PAYER_CONTACT_MESSAGES.email);
  v.check(postalCode.length === 8, "payer_postal_code", PAYER_CONTACT_MESSAGES.postalCode);
  v.check(street !== null && street.length <= 200, "payer_street", PAYER_CONTACT_MESSAGES.street);
  v.check(number !== null && number.length <= 20, "payer_number", PAYER_CONTACT_MESSAGES.number);
  v.check(district !== null && district.length <= 100, "payer_district", PAYER_CONTACT_MESSAGES.district);
  v.throwIfInvalid("Dados de quem paga");
  return { email: email!, postalCode, street: street!, number: number!, complement: cleanText(input.complement), district: district! };
}

type ContactAddressRow = {
  email: string | null;
  postal_code: string | null;
  street: string | null;
  address_number: string | null;
  address_complement: string | null;
  district: string | null;
};

const fromColumns = (r: ContactAddressRow | null): PayerContact | null =>
  r && r.email && r.postal_code && r.street && r.address_number && r.district
    ? { email: r.email, postalCode: r.postal_code, street: r.street, number: r.address_number, complement: r.address_complement, district: r.district }
    : null;

/** E-mail e endereço guardados do responsável financeiro do paciente (null = falta). */
export async function getPayerContact(db: DbClient, clinicId: string, patient: Pick<Patient, "id" | "contactId" | "isContactSelf">, payer: Payer): Promise<PayerContact | null> {
  if (effectivePayer(patient, payer) === "contact") {
    const row = unwrap(
      await db.from("contact_finance").select("email, postal_code, street, address_number, address_complement, district").eq("clinic_id", clinicId).eq("contact_id", patient.contactId).maybeSingle(),
      "Dados financeiros do contato",
    ) as ContactAddressRow | null;
    return fromColumns(row);
  }
  const row = unwrap(
    await db
      .from("patient_finance")
      .select("payer_email, payer_postal_code, payer_street, payer_address_number, payer_address_complement, payer_district")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patient.id)
      .maybeSingle(),
    "Dados financeiros do paciente",
  ) as { payer_email: string | null; payer_postal_code: string | null; payer_street: string | null; payer_address_number: string | null; payer_address_complement: string | null; payer_district: string | null } | null;
  return row
    ? fromColumns({ email: row.payer_email, postal_code: row.payer_postal_code, street: row.payer_street, address_number: row.payer_address_number, address_complement: row.payer_address_complement, district: row.payer_district })
    : null;
}

/** Grava no Financeiro do responsável (contato ou paciente); null apaga. */
export async function savePayerContact(
  db: DbClient,
  clinicId: string,
  patient: Pick<Patient, "id" | "contactId" | "isContactSelf">,
  payer: Payer,
  contact: PayerContact | null,
): Promise<void> {
  if (effectivePayer(patient, payer) === "contact") {
    unwrap(
      await db.from("contact_finance").upsert(
        {
          clinic_id: clinicId,
          contact_id: patient.contactId,
          email: contact?.email ?? null,
          postal_code: contact?.postalCode ?? null,
          street: contact?.street ?? null,
          address_number: contact?.number ?? null,
          address_complement: contact?.complement ?? null,
          district: contact?.district ?? null,
        },
        { onConflict: "contact_id" },
      ),
      "Dados financeiros do contato",
    );
    return;
  }
  unwrap(
    await db
      .from("patient_finance")
      .update({
        payer_email: contact?.email ?? null,
        payer_postal_code: contact?.postalCode ?? null,
        payer_street: contact?.street ?? null,
        payer_address_number: contact?.number ?? null,
        payer_address_complement: contact?.complement ?? null,
        payer_district: contact?.district ?? null,
      })
      .eq("clinic_id", clinicId)
      .eq("patient_id", patient.id),
    "Dados financeiros do paciente",
  );
}

/** Pagamento sem nota ativa: grava o e-mail e o endereço de quem pagou (e no Financeiro dele). */
export async function setPaymentPayerContact(db: DbClient, paymentId: string, contact: PayerContact): Promise<void> {
  const { error } = await db.rpc("set_payment_payer_contact", {
    p_payment_id: paymentId,
    p_email: contact.email,
    p_postal_code: contact.postalCode,
    p_street: contact.street,
    p_number: contact.number,
    p_complement: (contact.complement ?? null) as string,
    p_district: contact.district,
  });
  if (error) throw fromDbError(error, "Dados de quem paga");
}
