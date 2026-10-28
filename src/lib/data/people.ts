import type { DbClient } from "./clients";
import { unwrapAllIn } from "./errors";

// Nomes e telefones lidos em lote para as listas de contato (CRM A2): o
// Retomar contato e a Oportunidade agora das Métricas e as mesmas listas no
// Relacionamento usam a mesma leitura (antes ficava dentro das páginas).

/** Nome de cada contato (os sem cadastro ficam fora do mapa). */
export async function loadContactNames(db: DbClient, clinicId: string, contactIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(contactIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const rows = await unwrapAllIn(
    ids,
    (chunk, from, to) => db.from("contacts").select("id, full_name").eq("clinic_id", clinicId).in("id", chunk).order("id").range(from, to),
    "Nomes dos contatos",
  );
  return new Map(rows.map((c) => [c.id, c.full_name]));
}

export type PatientContact = { fullName: string; contactName: string | null; phone: string | null };

/** Nome do paciente e o contato dele (nome e WhatsApp). */
export async function loadPatientContacts(db: DbClient, clinicId: string, patientIds: string[]): Promise<Map<string, PatientContact>> {
  const ids = [...new Set(patientIds)];
  if (ids.length === 0) return new Map();
  const rows = (await unwrapAllIn(
    ids,
    (chunk, from, to) =>
      db.from("patients").select("id, full_name, contacts ( full_name, phone )").eq("clinic_id", clinicId).in("id", chunk).order("id").range(from, to),
    "Pacientes e contatos",
  )) as unknown as { id: string; full_name: string; contacts: { full_name: string; phone: string } | null }[];
  return new Map(rows.map((row) => [row.id, { fullName: row.full_name, contactName: row.contacts?.full_name ?? null, phone: row.contacts?.phone ?? null }]));
}
