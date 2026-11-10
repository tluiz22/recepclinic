import type { DbClient } from "../clients";
import { DataError, unwrap, Validation } from "../errors";

// Configurações › Portal (F3d; especificação R7): o endereço da clínica (o Suporte define), o link de cada
// profissional com "Mostrar no portal" e a antecedência para remarcar e cancelar pelo portal (RD10). Gravações com a
// credencial de quem está no painel (o banco confere o papel).

export const LEAD_HOURS_MIN = 0;
export const LEAD_HOURS_MAX = 168;

export type PortalProfessionalLink = {
  id: string;
  name: string;
  slug: string;
  showInPortal: boolean;
  specialties: { id: string; name: string }[];
};

export type PortalSettings = {
  slug: string | null;
  leadHours: number;
  professionals: PortalProfessionalLink[];
};

export async function loadPortalSettings(db: DbClient, clinicId: string): Promise<PortalSettings> {
  const [clinic, settings, professionals, specialties] = await Promise.all([
    db.from("clinics").select("portal_slug").eq("id", clinicId).maybeSingle().then((r) => unwrap(r, "Clínica")),
    db.from("clinic_settings").select("portal_cancel_lead_hours").eq("clinic_id", clinicId).maybeSingle().then((r) => unwrap(r, "Configuração da clínica")),
    db
      .from("professionals")
      .select("id, display_name, portal_slug, show_in_portal")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .order("display_name")
      .then((r) => unwrap(r, "Profissionais")),
    db
      .from("professional_specialties")
      .select("professional_id, position, kb_specialties ( id, name )")
      .eq("clinic_id", clinicId)
      .order("position")
      .then((r) => unwrap(r, "Especialidades dos profissionais")),
  ]);
  const byProfessional = new Map<string, { id: string; name: string }[]>();
  for (const row of specialties as unknown as { professional_id: string; kb_specialties: { id: string; name: string } | null }[]) {
    if (!row.kb_specialties) continue;
    byProfessional.set(row.professional_id, [...(byProfessional.get(row.professional_id) ?? []), row.kb_specialties]);
  }
  return {
    slug: clinic?.portal_slug ?? null,
    leadHours: settings?.portal_cancel_lead_hours ?? 24,
    professionals: professionals
      .filter((p) => p.portal_slug)
      .map((p) => ({ id: p.id, name: p.display_name, slug: p.portal_slug!, showInPortal: p.show_in_portal, specialties: byProfessional.get(p.id) ?? [] }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  };
}

export async function setPortalLeadHours(db: DbClient, clinicId: string, hours: number | null): Promise<void> {
  const v = new Validation();
  v.check(hours !== null && Number.isInteger(hours) && hours >= LEAD_HOURS_MIN && hours <= LEAD_HOURS_MAX, "lead_hours", `Use de ${LEAD_HOURS_MIN} a ${LEAD_HOURS_MAX} horas.`);
  v.throwIfInvalid("Antecedência");
  const row = unwrap(
    await db.from("clinic_settings").update({ portal_cancel_lead_hours: hours! }).eq("clinic_id", clinicId).select("clinic_id").maybeSingle(),
    "Configuração da clínica",
  );
  if (!row) throw new DataError("forbidden", "Configuração da clínica: sem permissão");
}

export async function setShowInPortal(db: DbClient, clinicId: string, professionalId: string, show: boolean): Promise<string> {
  const row = unwrap(
    await db.from("professionals").update({ show_in_portal: show }).eq("clinic_id", clinicId).eq("id", professionalId).select("display_name").maybeSingle(),
    "Profissional",
  );
  if (!row) throw new DataError("not_found", "Profissional: não encontrado");
  return row.display_name;
}
