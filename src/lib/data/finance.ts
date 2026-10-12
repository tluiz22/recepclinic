import { normalizeCpf } from "../cpf";
import type { DbClient } from "./clients";
import { cleanText, unwrap, Validation } from "./errors";
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
// opcional (na DMED vai a data de nascimento). O paciente que fala por si é o
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
  v.throwIfInvalid("Dados financeiros");

  unwrap(
    await db
      .from("patient_finance")
      .upsert({ clinic_id: clinicId, patient_id: patient.id, cpf, payer, payer_name: payerName, payer_cpf: payerCpf }, { onConflict: "patient_id" }),
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
  options: { query?: string; page?: number } = {},
): Promise<Page<FinancePatientRow>> {
  const page = await listPatientsPage(db, clinicId, options);
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
