import type { DbClient } from "./clients";
import { unwrap } from "./errors";

// Data de nascimento a conferir (F2c; R2 e R4): no portal, o paciente disse que é um cadastro existente, mas informou
// outra data. A recepção confere com ele: "Corrigir para {data}" (o cadastro passa a ter a informada) ou "Manter
// {data}"; resolvido, some da ficha, do atendimento aberto e (F5b) do Meu dia.

export type BirthdateCheck = { id: string; patientId: string; registered: string; informed: string; createdAt: Date };

/** As pendências abertas dos pacientes (a mais recente de cada um). */
export async function listOpenBirthdateChecks(db: DbClient, clinicId: string, patientIds: string[]): Promise<Map<string, BirthdateCheck>> {
  const result = new Map<string, BirthdateCheck>();
  const ids = [...new Set(patientIds)];
  if (!ids.length) return result;
  const rows = unwrap(
    await db
      .from("portal_birthdate_checks")
      .select("id, patient_id, registered_birthdate, informed_birthdate, created_at")
      .eq("clinic_id", clinicId)
      .in("patient_id", ids)
      .is("resolved_at", null)
      .order("created_at", { ascending: false }),
    "Datas a conferir",
  );
  for (const row of rows) {
    if (result.has(row.patient_id)) continue;
    result.set(row.patient_id, {
      id: row.id,
      patientId: row.patient_id,
      registered: row.registered_birthdate,
      informed: row.informed_birthdate,
      createdAt: new Date(row.created_at),
    });
  }
  return result;
}

/** Corrigir (o cadastro passa a ter a data informada) ou manter a cadastrada. */
export async function resolveBirthdateCheck(db: DbClient, checkId: string, action: "corrected" | "kept"): Promise<void> {
  unwrap(await db.rpc("resolve_portal_birthdate_check", { p_check_id: checkId, p_action: action }), "Data a conferir");
}
