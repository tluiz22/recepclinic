import { isAdult, isOverConsultationAgeLimit } from "../age";
import { isCalendarDate } from "../clinicTime";
import { normalizePhone } from "../phone";
import type { DbClient } from "./clients";
import { cleanText, DataError, fromDbError, unwrap, unwrapOne, Validation } from "./errors";

// Contatos e pacientes (D4a, D10). O contato é quem conversa no WhatsApp
// (antigo "responsável"); o paciente é cuidado por um contato, e pode ser o
// próprio contato. Telefone único por clínica. Toda a equipe vê e cadastra
// (D6); ninguém apaga pela tela: sai por desativação, como no piloto.
//
// Regras do cadastro herdadas do piloto (Fase 21):
//   - nascimento entre 01/01/1900 e hoje, no fuso da clínica, e data que
//     existe (achados 1 e 2 da F1, corrigidos aqui e no banco);
//   - só maior de 18 anos pode ser o próprio contato, inclusive ao editar;
//   - telefone já cadastrado reaproveita o contato (reativando, se preciso);
//     sendo o próprio paciente, pede antes a confirmação de que é a mesma pessoa;
//   - no máximo um "próprio paciente" por contato;
//   - mesmo contato e mesma data de nascimento: avisa de possível duplicado;
//   - idade limite da consulta: só avisa, não bloqueia.

export const MIN_BIRTHDATE = "1900-01-01";

export type Contact = {
  id: string;
  fullName: string;
  /** E.164 (+55…). */
  phone: string;
  defaultHomeAddress: string | null;
  isActive: boolean;
};

export type PatientInsurance = {
  planId: string;
  cardNumber: string | null;
  /** "YYYY-MM-DD". */
  cardValidUntil: string | null;
};

export type Patient = {
  id: string;
  contactId: string;
  fullName: string;
  birthdate: string;
  /** O paciente é o próprio contato (fala por si no WhatsApp). */
  isContactSelf: boolean;
  notes: string | null;
  /** null = particular (D10). */
  insurance: PatientInsurance | null;
  isActive: boolean;
};

export type PatientWithContact = Patient & { contact: Contact };

const CONTACT_COLUMNS = "id, full_name, phone, default_home_address, is_active";
const PATIENT_COLUMNS =
  "id, contact_id, full_name, birthdate, is_contact_self, notes, insurance_plan_id, insurance_card_number, insurance_card_valid_until, is_active";

type ContactRow = { id: string; full_name: string; phone: string; default_home_address: string | null; is_active: boolean };
type PatientRow = {
  id: string;
  contact_id: string;
  full_name: string;
  birthdate: string;
  is_contact_self: boolean;
  notes: string | null;
  insurance_plan_id: string | null;
  insurance_card_number: string | null;
  insurance_card_valid_until: string | null;
  is_active: boolean;
};

const toContact = (row: ContactRow): Contact => ({
  id: row.id,
  fullName: row.full_name,
  phone: row.phone,
  defaultHomeAddress: row.default_home_address,
  isActive: row.is_active,
});

const toPatient = (row: PatientRow): Patient => ({
  id: row.id,
  contactId: row.contact_id,
  fullName: row.full_name,
  birthdate: row.birthdate,
  isContactSelf: row.is_contact_self,
  notes: row.notes,
  insurance: row.insurance_plan_id
    ? { planId: row.insurance_plan_id, cardNumber: row.insurance_card_number, cardValidUntil: row.insurance_card_valid_until }
    : null,
  isActive: row.is_active,
});

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

export const PATIENT_MESSAGES = {
  invalidBirthdate: "Data de nascimento inválida.",
  minorNeedsContact: "Paciente menor de 18 anos precisa de um responsável (outra pessoa).",
  invalidPhone: "Telefone inválido: informe DDD + número.",
  selfExists: "Esse contato já tem um cadastro como próprio paciente.",
  invalidCardValidUntil: "Validade da carteirinha inválida.",
} as const;

/** Nascimento válido: data que existe, de 01/01/1900 até hoje (no fuso da clínica). */
export function isValidBirthdate(birthdate: string, today: string): boolean {
  return isCalendarDate(birthdate) && birthdate >= MIN_BIRTHDATE && birthdate <= today;
}

/** Só maior de idade pode ser o próprio contato. */
export function canBeOwnContact(birthdate: string, today: string): boolean {
  return isAdult(birthdate, today);
}

function validatePatientFields(
  input: { fullName: string; birthdate: string; isContactSelf: boolean },
  today: string,
  v: Validation,
): void {
  v.check((cleanText(input.fullName) ?? "").length > 0, "fullName", "Informe o nome do paciente");
  const birthdateOk = isValidBirthdate(input.birthdate, today);
  v.check(birthdateOk, "birthdate", PATIENT_MESSAGES.invalidBirthdate);
  if (birthdateOk && input.isContactSelf) {
    v.check(canBeOwnContact(input.birthdate, today), "isContactSelf", PATIENT_MESSAGES.minorNeedsContact);
  }
}

export type PatientInsuranceInput = { planId: string; cardNumber?: string | null; cardValidUntil?: string | null } | null;

/** Plano do paciente: null = particular (e sem carteirinha). */
export function normalizeInsurance(input: PatientInsuranceInput, v: Validation) {
  if (!input) return { insurance_plan_id: null, insurance_card_number: null, insurance_card_valid_until: null };
  const validUntil = cleanText(input.cardValidUntil);
  v.check(validUntil === null || isCalendarDate(validUntil), "cardValidUntil", PATIENT_MESSAGES.invalidCardValidUntil);
  return {
    insurance_plan_id: input.planId,
    insurance_card_number: cleanText(input.cardNumber),
    insurance_card_valid_until: validUntil,
  };
}

// ---------------------------------------------------------------------------
// Contatos
// ---------------------------------------------------------------------------

export async function findContactByPhone(db: DbClient, clinicId: string, rawPhone: string): Promise<Contact | null> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;
  const row = unwrap(
    await db.from("contacts").select(CONTACT_COLUMNS).eq("clinic_id", clinicId).eq("phone", phone).maybeSingle(),
    "Contato",
  );
  return row ? toContact(row) : null;
}

export async function getContact(db: DbClient, clinicId: string, id: string): Promise<Contact> {
  return toContact(
    unwrapOne(await db.from("contacts").select(CONTACT_COLUMNS).eq("clinic_id", clinicId).eq("id", id).maybeSingle(), "Contato"),
  );
}

/** Busca de contatos ativos por nome ou telefone (4+ dígitos), como no piloto. */
export async function searchContacts(db: DbClient, clinicId: string, query: string): Promise<Contact[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  let request = db.from("contacts").select(CONTACT_COLUMNS).eq("clinic_id", clinicId).eq("is_active", true);
  request = digits.length >= 4 ? request.ilike("phone", `%${digits}%`) : request.ilike("full_name", `%${escapeLike(q)}%`);
  return unwrap(await request.order("full_name").limit(10), "Busca de contatos").map(toContact);
}

export async function updateContact(
  db: DbClient,
  clinicId: string,
  id: string,
  input: { fullName: string; phone: string; defaultHomeAddress?: string | null },
): Promise<Contact> {
  const v = new Validation();
  const fullName = cleanText(input.fullName) ?? "";
  const phone = normalizePhone(input.phone ?? "");
  v.check(fullName.length > 0, "fullName", "Informe o nome do contato");
  v.check(phone !== null, "phone", PATIENT_MESSAGES.invalidPhone);
  v.throwIfInvalid("Contato");
  const row: { full_name: string; phone: string; default_home_address?: string | null } = { full_name: fullName, phone: phone! };
  if ("defaultHomeAddress" in input) row.default_home_address = cleanText(input.defaultHomeAddress);
  return toContact(
    unwrapOne(await db.from("contacts").update(row).eq("clinic_id", clinicId).eq("id", id).select(CONTACT_COLUMNS).maybeSingle(), "Contato"),
  );
}

export async function setContactActive(db: DbClient, clinicId: string, id: string, isActive: boolean): Promise<void> {
  unwrapOne(
    await db.from("contacts").update({ is_active: isActive }).eq("clinic_id", clinicId).eq("id", id).select("id").maybeSingle(),
    "Contato",
  );
}

/** Contato pelo telefone: o existente (reativado, se preciso) ou um novo. */
async function contactForPhone(db: DbClient, clinicId: string, phone: string, fullName: string): Promise<Contact> {
  const existing = await findContactByPhone(db, clinicId, phone);
  if (existing) {
    if (!existing.isActive) await setContactActive(db, clinicId, existing.id, true);
    return { ...existing, isActive: true };
  }
  const { data, error } = await db
    .from("contacts")
    .insert({ clinic_id: clinicId, full_name: fullName, phone })
    .select(CONTACT_COLUMNS)
    .single();
  if (!error) return toContact(data);
  // Outro cadastro com o mesmo telefone entrou ao mesmo tempo (bot e tela).
  const raced = (error as { code?: string }).code === "23505" ? await findContactByPhone(db, clinicId, phone) : null;
  if (raced) return raced;
  throw fromDbError(error, "Contato");
}

// ---------------------------------------------------------------------------
// Pacientes
// ---------------------------------------------------------------------------

export async function getPatient(db: DbClient, clinicId: string, id: string): Promise<Patient> {
  return toPatient(
    unwrapOne(await db.from("patients").select(PATIENT_COLUMNS).eq("clinic_id", clinicId).eq("id", id).maybeSingle(), "Paciente"),
  );
}

export async function listContactPatients(
  db: DbClient,
  clinicId: string,
  contactId: string,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<Patient[]> {
  let query = db.from("patients").select(PATIENT_COLUMNS).eq("clinic_id", clinicId).eq("contact_id", contactId).order("full_name");
  if (!includeInactive) query = query.eq("is_active", true);
  return unwrap(await query, "Pacientes do contato").map(toPatient);
}

/** Pacientes ativos por nome, ou pelo telefone do contato (4+ dígitos), como no piloto. */
export async function searchPatients(db: DbClient, clinicId: string, query: string): Promise<PatientWithContact[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  const byPhone = digits.length >= 4;
  let request = db
    .from("patients")
    .select(`${PATIENT_COLUMNS}, contacts!${byPhone ? "inner" : "left"} ( ${CONTACT_COLUMNS} )`)
    .eq("clinic_id", clinicId)
    .eq("is_active", true);
  request = byPhone ? request.ilike("contacts.phone", `%${digits}%`) : request.ilike("full_name", `%${escapeLike(q)}%`);
  const rows = unwrap(await request.order("full_name").limit(10), "Busca de pacientes") as unknown as (PatientRow & {
    contacts: ContactRow;
  })[];
  return rows.map((row) => ({ ...toPatient(row), contact: toContact(row.contacts) }));
}

export type ContactChoice =
  /** O próprio paciente, maior de idade, com o telefone dele. */
  | { mode: "self"; phone: string; confirmedContactId?: string }
  /** Contato já cadastrado, escolhido na busca. */
  | { mode: "existing"; contactId: string }
  /** Contato novo (telefone já cadastrado reaproveita o contato). */
  | { mode: "new"; fullName: string; phone: string };

export type RegisterPatientInput = {
  fullName: string;
  birthdate: string;
  notes?: string | null;
  insurance?: PatientInsuranceInput;
  contact: ContactChoice;
  /** A equipe viu o aviso de possível duplicado e confirmou. */
  confirmDuplicate?: boolean;
};

export type RegisterPatientResult =
  | { status: "created"; patient: Patient; contact: Contact; overConsultationAgeLimit: boolean }
  /** Telefone já é de um contato: confirmar que é a mesma pessoa (modo "self"). */
  | { status: "confirm_same_person"; contact: Contact }
  /** O contato já tem paciente ativo com a mesma data de nascimento. */
  | { status: "possible_duplicate"; contact: Contact; existingNames: string[] };

/**
 * Cadastra um paciente (tela ou bot). `today` é a data de hoje no fuso da
 * clínica (todayIn(context.timezone)).
 */
export async function registerPatient(
  db: DbClient,
  clinicId: string,
  input: RegisterPatientInput,
  today: string,
): Promise<RegisterPatientResult> {
  const v = new Validation();
  const isContactSelf = input.contact.mode === "self";
  validatePatientFields({ fullName: input.fullName, birthdate: input.birthdate, isContactSelf }, today, v);
  const insurance = normalizeInsurance(input.insurance ?? null, v);
  const phone = input.contact.mode === "existing" ? null : normalizePhone(input.contact.phone ?? "");
  if (input.contact.mode !== "existing") v.check(phone !== null, "phone", PATIENT_MESSAGES.invalidPhone);
  if (input.contact.mode === "new") v.check((cleanText(input.contact.fullName) ?? "").length > 0, "contactFullName", "Informe o nome do responsável");
  v.throwIfInvalid("Paciente");

  const fullName = cleanText(input.fullName)!;
  let contact: Contact;
  let contactExisted: boolean;

  if (input.contact.mode === "existing") {
    contact = await getContact(db, clinicId, input.contact.contactId);
    contactExisted = true;
  } else if (input.contact.mode === "self") {
    const existing = await findContactByPhone(db, clinicId, phone!);
    if (existing && input.contact.confirmedContactId !== existing.id) return { status: "confirm_same_person", contact: existing };
    contact = existing ?? (await contactForPhone(db, clinicId, phone!, fullName));
    contactExisted = existing !== null;
    if (existing) {
      const { data: currentSelf } = await db
        .from("patients")
        .select("id")
        .eq("clinic_id", clinicId)
        .eq("contact_id", existing.id)
        .eq("is_contact_self", true)
        .maybeSingle();
      if (currentSelf) throw new DataError("duplicate", `Paciente: ${PATIENT_MESSAGES.selfExists}`, { isContactSelf: PATIENT_MESSAGES.selfExists });
      if (!existing.isActive) await setContactActive(db, clinicId, existing.id, true);
    }
  } else {
    const existing = await findContactByPhone(db, clinicId, phone!);
    contact = await contactForPhone(db, clinicId, phone!, cleanText(input.contact.fullName)!);
    contactExisted = existing !== null;
  }

  if (contactExisted && !input.confirmDuplicate) {
    const { data: twins } = await db
      .from("patients")
      .select("full_name")
      .eq("clinic_id", clinicId)
      .eq("contact_id", contact.id)
      .eq("is_active", true)
      .eq("birthdate", input.birthdate);
    if (twins?.length) return { status: "possible_duplicate", contact, existingNames: twins.map((t) => t.full_name) };
  }

  const { data, error } = await db
    .from("patients")
    .insert({
      clinic_id: clinicId,
      contact_id: contact.id,
      full_name: fullName,
      birthdate: input.birthdate,
      is_contact_self: isContactSelf,
      notes: cleanText(input.notes),
      ...insurance,
    })
    .select(PATIENT_COLUMNS)
    .single();
  if (error && (error as { code?: string }).code === "23505") {
    throw new DataError("duplicate", `Paciente: ${PATIENT_MESSAGES.selfExists}`, { isContactSelf: PATIENT_MESSAGES.selfExists });
  }
  const patient = toPatient(unwrap({ data, error }, "Paciente"));

  const settings = unwrapOne(
    await db.from("clinic_settings").select("consultation_age_limit_years").eq("clinic_id", clinicId).maybeSingle(),
    "Configuração da clínica",
  );
  const limit = settings.consultation_age_limit_years;
  return {
    status: "created",
    patient,
    contact: { ...contact, isActive: true },
    overConsultationAgeLimit: limit !== null && isOverConsultationAgeLimit(input.birthdate, today, limit),
  };
}

/** Edita nome, nascimento e observações. Sendo o próprio contato, o nome do contato acompanha. */
export async function updatePatient(
  db: DbClient,
  clinicId: string,
  id: string,
  input: { fullName: string; birthdate: string; notes?: string | null },
  today: string,
): Promise<Patient> {
  const current = await getPatient(db, clinicId, id);
  const v = new Validation();
  validatePatientFields({ ...input, isContactSelf: current.isContactSelf }, today, v);
  v.throwIfInvalid("Paciente");
  const fullName = cleanText(input.fullName)!;
  const patient = toPatient(
    unwrapOne(
      await db
        .from("patients")
        .update({ full_name: fullName, birthdate: input.birthdate, notes: cleanText(input.notes) })
        .eq("clinic_id", clinicId)
        .eq("id", id)
        .select(PATIENT_COLUMNS)
        .maybeSingle(),
      "Paciente",
    ),
  );
  if (patient.isContactSelf) {
    unwrapOne(
      await db.from("contacts").update({ full_name: fullName }).eq("clinic_id", clinicId).eq("id", patient.contactId).select("id").maybeSingle(),
      "Contato",
    );
  }
  return patient;
}

/** Plano do paciente (D10); null = particular. */
export async function setPatientInsurance(
  db: DbClient,
  clinicId: string,
  id: string,
  insurance: PatientInsuranceInput,
): Promise<Patient> {
  const v = new Validation();
  const row = normalizeInsurance(insurance, v);
  v.throwIfInvalid("Plano do paciente");
  return toPatient(
    unwrapOne(
      await db.from("patients").update(row).eq("clinic_id", clinicId).eq("id", id).select(PATIENT_COLUMNS).maybeSingle(),
      "Plano do paciente",
    ),
  );
}

export async function setPatientActive(db: DbClient, clinicId: string, id: string, isActive: boolean): Promise<void> {
  unwrapOne(
    await db.from("patients").update({ is_active: isActive }).eq("clinic_id", clinicId).eq("id", id).select("id").maybeSingle(),
    "Paciente",
  );
}

/** `%` e `_` digitados viram texto, não curinga, na busca por nome. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
