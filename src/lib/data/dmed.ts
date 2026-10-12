import { normalizeCpf } from "../cpf";
import { buildDmed, groupDmed, type DmedPayment, type DmedResponsible } from "../dmed";
import type { DbClient } from "./clients";
import { cleanText, DataError, fromDbError, unwrap, Validation } from "./errors";
import { getFiscalSettings } from "./fiscal";
import type { Payer } from "./finance";

// DMED do ano (F11.6, cliente, 12/out/2026), no menu Financeiro, só para o
// Administrador da clínica. Entram os pagamentos do ano (pela data do
// pagamento) que não foram excluídos e têm o CPF de quem pagou; os sem CPF (e
// os de paciente anonimizado, sem nome nem nascimento) ficam de fora, numa
// lista. O responsável pelo preenchimento, o CPF do responsável perante o
// CNPJ e o CNES ficam guardados para o ano seguinte.

export type DmedSettings = {
  fillerCpf: string;
  fillerName: string;
  fillerDdd: string;
  fillerPhone: string;
  fillerExtension: string | null;
  fillerEmail: string | null;
  legalResponsibleCpf: string;
  cnes: string | null;
};

export const DMED_MESSAGES = {
  fillerCpf: "CPF do responsável pelo preenchimento inválido.",
  fillerName: "Informe o nome do responsável pelo preenchimento.",
  fillerDdd: "DDD com 2 dígitos.",
  fillerPhone: "Telefone com 8 ou 9 dígitos, sem o DDD.",
  fillerExtension: "Ramal: até 6 dígitos.",
  fillerEmail: "E-mail inválido.",
  legalResponsibleCpf: "CPF do responsável perante o CNPJ inválido.",
  cnes: "CNES: 7 dígitos.",
  year: "Escolha um ano já começado.",
  fiscal: "Preencha antes os dados fiscais da clínica (CNPJ e razão social) em Configurações › Nota fiscal.",
  settings: "Preencha e salve antes os responsáveis da DMED.",
} as const;

type SettingsRow = {
  filler_cpf: string;
  filler_name: string;
  filler_ddd: string;
  filler_phone: string;
  filler_extension: string | null;
  filler_email: string | null;
  legal_responsible_cpf: string;
  cnes: string | null;
};

export async function getDmedSettings(db: DbClient, clinicId: string): Promise<DmedSettings | null> {
  const row = unwrap(
    await db
      .from("clinic_dmed_settings")
      .select("filler_cpf, filler_name, filler_ddd, filler_phone, filler_extension, filler_email, legal_responsible_cpf, cnes")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    "DMED",
  ) as SettingsRow | null;
  if (!row) return null;
  return {
    fillerCpf: row.filler_cpf,
    fillerName: row.filler_name,
    fillerDdd: row.filler_ddd,
    fillerPhone: row.filler_phone,
    fillerExtension: row.filler_extension,
    fillerEmail: row.filler_email,
    legalResponsibleCpf: row.legal_responsible_cpf,
    cnes: row.cnes,
  };
}

export type DmedSettingsInput = { [K in keyof DmedSettings]?: string | null };

const digits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

export async function saveDmedSettings(db: DbClient, clinicId: string, input: DmedSettingsInput): Promise<void> {
  const v = new Validation();
  const fillerCpf = normalizeCpf(input.fillerCpf);
  v.check(fillerCpf !== null, "filler_cpf", DMED_MESSAGES.fillerCpf);
  const fillerName = cleanText(input.fillerName);
  v.check(fillerName !== null, "filler_name", DMED_MESSAGES.fillerName);
  const ddd = digits(input.fillerDdd);
  v.check(/^[1-9]\d$/.test(ddd), "filler_ddd", DMED_MESSAGES.fillerDdd);
  const phone = digits(input.fillerPhone);
  v.check(/^\d{8,9}$/.test(phone), "filler_phone", DMED_MESSAGES.fillerPhone);
  const extension = digits(input.fillerExtension) || null;
  v.check(extension === null || /^\d{1,6}$/.test(extension), "filler_extension", DMED_MESSAGES.fillerExtension);
  const email = cleanText(input.fillerEmail);
  v.check(email === null || /^[^@|\s]+@[^@|\s]+\.[^@|\s]+$/.test(email), "filler_email", DMED_MESSAGES.fillerEmail);
  const legalCpf = normalizeCpf(input.legalResponsibleCpf);
  v.check(legalCpf !== null, "legal_responsible_cpf", DMED_MESSAGES.legalResponsibleCpf);
  const cnes = digits(input.cnes) || null;
  v.check(cnes === null || /^\d{7}$/.test(cnes), "cnes", DMED_MESSAGES.cnes);
  v.throwIfInvalid("DMED");

  unwrap(
    await db.from("clinic_dmed_settings").upsert(
      {
        clinic_id: clinicId,
        filler_cpf: fillerCpf!,
        filler_name: fillerName!,
        filler_ddd: ddd,
        filler_phone: phone,
        filler_extension: extension,
        filler_email: email,
        legal_responsible_cpf: legalCpf!,
        cnes,
      },
      { onConflict: "clinic_id" },
    ),
    "DMED",
  );
}

export type DmedLeftOut = {
  paymentId: string;
  appointmentId: string;
  paidOn: string;
  amountCents: number;
  payerName: string;
  patientName: string;
  reason: "no_cpf" | "anonymized";
};

export type DmedYear = { payments: DmedPayment[]; leftOut: DmedLeftOut[]; responsibles: DmedResponsible[]; totalCents: number };

type YearRow = {
  id: string;
  appointment_id: string;
  amount_cents: number;
  paid_on: string;
  payer: string;
  payer_name: string;
  payer_cpf: string | null;
  patients: { id: string; full_name: string; birthdate: string; is_contact_self: boolean; contact_id: string; anonymized_at: string | null };
};

const PAGE = 1000;

/** Pagamentos do ano-calendário (sem os excluídos), separados em os que entram e os que ficam de fora. */
export async function loadDmedYear(db: DbClient, clinicId: string, year: number): Promise<DmedYear> {
  const rows: YearRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = unwrap(
      await db
        .from("payments")
        .select("id, appointment_id, amount_cents, paid_on, payer, payer_name, payer_cpf, patients ( id, full_name, birthdate, is_contact_self, contact_id, anonymized_at )")
        .eq("clinic_id", clinicId)
        .is("deleted_at", null)
        .gte("paid_on", `${year}-01-01`)
        .lte("paid_on", `${year}-12-31`)
        .order("paid_on")
        .order("id")
        .range(from, from + PAGE - 1),
      "DMED",
    ) as unknown as YearRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  // CPF dos pacientes (beneficiários): o do módulo; o de quem fala por si fica no contato.
  const patientIds = [...new Set(rows.map((r) => r.patients.id))];
  const contactIds = [...new Set(rows.filter((r) => r.patients.is_contact_self).map((r) => r.patients.contact_id))];
  const patientCpf = new Map<string, string | null>();
  const contactCpf = new Map<string, string | null>();
  for (let i = 0; i < patientIds.length; i += PAGE) {
    const chunk = patientIds.slice(i, i + PAGE);
    const found = unwrap(await db.from("patient_finance").select("patient_id, cpf").eq("clinic_id", clinicId).in("patient_id", chunk), "DMED") as {
      patient_id: string;
      cpf: string | null;
    }[];
    for (const row of found) patientCpf.set(row.patient_id, row.cpf);
  }
  for (let i = 0; i < contactIds.length; i += PAGE) {
    const chunk = contactIds.slice(i, i + PAGE);
    const found = unwrap(await db.from("contact_finance").select("contact_id, cpf").eq("clinic_id", clinicId).in("contact_id", chunk), "DMED") as {
      contact_id: string;
      cpf: string | null;
    }[];
    for (const row of found) contactCpf.set(row.contact_id, row.cpf);
  }

  const payments: DmedPayment[] = [];
  const leftOut: DmedLeftOut[] = [];
  for (const row of rows) {
    const patient = row.patients;
    const base = { paymentId: row.id, appointmentId: row.appointment_id, paidOn: row.paid_on, amountCents: row.amount_cents, payerName: row.payer_name, patientName: patient.full_name };
    if (!row.payer_cpf) {
      leftOut.push({ ...base, reason: "no_cpf" });
      continue;
    }
    const payer = row.payer as Payer;
    const selfPaid = payer === "patient" || (payer === "contact" && patient.is_contact_self);
    if (patient.anonymized_at && !selfPaid) {
      leftOut.push({ ...base, reason: "anonymized" });
      continue;
    }
    payments.push({
      amountCents: row.amount_cents,
      payerCpf: row.payer_cpf,
      payerName: row.payer_name,
      selfPaid,
      patientKey: patient.id,
      patientName: patient.full_name,
      patientCpf: (patient.is_contact_self ? contactCpf.get(patient.contact_id) : patientCpf.get(patient.id)) ?? null,
      patientBirthdate: patient.birthdate,
    });
  }
  return { payments, leftOut, responsibles: groupDmed(payments), totalCents: payments.reduce((sum, p) => sum + p.amountCents, 0) };
}

/** Anos que dá para escolher: do atual para trás, até 5 anos. */
export function dmedYears(currentYear: number): number[] {
  return Array.from({ length: 6 }, (_, i) => currentYear - i);
}

/** Monta o arquivo do ano e registra na trilha fiscal (ano e totais, sem CPF). */
export async function generateDmed(
  db: DbClient,
  clinicId: string,
  year: number,
  currentYear: number,
): Promise<{ fileName: string; content: string; data: DmedYear }> {
  if (!dmedYears(currentYear).includes(year)) throw new DataError("invalid", `DMED: ${DMED_MESSAGES.year}`, { year: DMED_MESSAGES.year });
  const [fiscal, settings] = await Promise.all([getFiscalSettings(db, clinicId), getDmedSettings(db, clinicId)]);
  if (!fiscal) throw new DataError("invalid", `DMED: ${DMED_MESSAGES.fiscal}`, { fiscal: DMED_MESSAGES.fiscal });
  if (!settings) throw new DataError("invalid", `DMED: ${DMED_MESSAGES.settings}`, { settings: DMED_MESSAGES.settings });
  const data = await loadDmedYear(db, clinicId, year);
  const content = buildDmed({
    year,
    filler: {
      cpf: settings.fillerCpf,
      name: settings.fillerName,
      ddd: settings.fillerDdd,
      phone: settings.fillerPhone,
      extension: settings.fillerExtension,
      email: settings.fillerEmail,
    },
    declarant: { cnpj: fiscal.cnpj, legalName: fiscal.legalName, cnes: settings.cnes, legalResponsibleCpf: settings.legalResponsibleCpf },
    responsibles: data.responsibles,
  });
  const { error } = await db.rpc("log_dmed_generated", {
    p_clinic_id: clinicId,
    p_year: year,
    p_responsibles: data.responsibles.length,
    p_total_cents: data.totalCents,
    p_left_out: data.leftOut.length,
  });
  if (error) throw fromDbError(error, "DMED");
  return { fileName: `DMED_${year}_${fiscal.cnpj}.txt`, content, data };
}
