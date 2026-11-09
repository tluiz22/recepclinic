import type { AstroGlobal } from "astro";
import { portalBase } from "../../portal";
import type { DbClient } from "../clients";
import { createClinicServiceClient } from "../clinicService";
import { resolveClinicByPortalSlug } from "../platform";
import { EXAM_SLUG_PREFIX, examProfessional, loadPortal, type PortalClinic, type PortalProfessional } from "./portal";
import type { PublicClinicBrand } from "../config/brand";

// Abertura de toda página do portal (F2a): a clínica pelo apelido do endereço, a credencial limitada a ela e o começo
// dos links ("/{clínica}" no endereço do portal, "/portal/{clínica}" nos outros).

export type PortalPage =
  | { kind: "not_found" }
  | { kind: "unavailable"; brand: PublicClinicBrand }
  | { kind: "open"; portal: PortalClinic; db: DbClient; base: string };

export async function openPortalPage(Astro: AstroGlobal): Promise<PortalPage> {
  const slug = (Astro.params.clinica ?? "").toLowerCase();
  const clinicId = await resolveClinicByPortalSlug(slug);
  if (!clinicId) return { kind: "not_found" };
  const db = createClinicServiceClient(clinicId);
  const portal = await loadPortal(db, clinicId, slug);
  if (portal.status === "unavailable") return { kind: "unavailable", brand: portal.brand };
  return { kind: "open", portal, db, base: portalBase(slug, Astro.url.hostname) };
}

/** O profissional do endereço ("/{clínica}/{profissional}/…"), se aparece no portal. */
export function professionalOf(portal: PortalClinic, slug: string | undefined): PortalProfessional | null {
  const wanted = (slug ?? "").toLowerCase();
  const professional = portal.professionals.find((p) => p.slug === wanted);
  if (professional) return professional;
  // Exame (F2d): "/{clínica}/exame-1a2b3c4d/…".
  const exam = wanted.startsWith(EXAM_SLUG_PREFIX) ? portal.exams.find((e) => e.slug === wanted) : null;
  return exam ? examProfessional(portal, exam) : null;
}

/** Clínica de um profissional só (como o piloto): o endereço da clínica abre direto no início dele. */
export const singleProfessional = (portal: PortalClinic) => (portal.professionals.length === 1 ? portal.professionals[0] : null);
