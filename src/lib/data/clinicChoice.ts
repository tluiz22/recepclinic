import type { ClinicRole } from "../clinicAccess";
import type { Enums } from "../supabase/database.types";
import type { DbClient } from "./clients";
import { unwrap } from "./errors";

// Escolha da clínica (F4.1): quem é membro de várias escolhe entre as suas; o
// Suporte escolhe qualquer uma (cada leitura dele fica registrada, D6).

export type SelectableClinic = {
  id: string;
  name: string;
  status: Enums<"clinic_status">;
  /** Papéis da pessoa na clínica; vazio = Suporte sem ser membro. */
  roles: ClinicRole[];
};

export async function isPlatformStaff(db: DbClient, userId: string): Promise<boolean> {
  const row = unwrap(await db.from("platform_staff").select("user_id").eq("user_id", userId).maybeSingle(), "Suporte");
  return row !== null;
}

/** Clínicas que a pessoa pode abrir, por nome. */
export async function listSelectableClinics(db: DbClient, userId: string): Promise<SelectableClinic[]> {
  const [members, staff] = await Promise.all([
    unwrap(await db.from("clinic_members").select("clinic_id, roles").eq("user_id", userId), "Clínicas"),
    isPlatformStaff(db, userId),
  ]);
  const rolesByClinic = new Map(members.filter((m) => m.roles.length > 0).map((m) => [m.clinic_id, m.roles]));

  let query = db.from("clinics").select("id, name, status").order("name");
  if (!staff) query = query.in("id", [...rolesByClinic.keys()]);
  const clinics = rolesByClinic.size === 0 && !staff ? [] : unwrap(await query, "Clínicas");
  return clinics.map((clinic) => ({ id: clinic.id, name: clinic.name, status: clinic.status, roles: rolesByClinic.get(clinic.id) ?? [] }));
}
