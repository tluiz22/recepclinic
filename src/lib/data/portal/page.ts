import type { AstroGlobal } from "astro";
import { PORTAL_PREFIX, portalBase } from "../../portal";
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

/**
 * Minhas consultas pelo link do profissional (validação da F3, cliente 10/nov): "/{clínica}/{profissional}/minhas-consultas/…"
 * abre as mesmas telas de "/{clínica}/minhas-consultas/…", com o profissional no parâmetro `profissional` (o endereço
 * no navegador não muda). Nele: só as consultas dele, o cartão dele no alto, e Voltar, Remarcar, Cancelar e "Agendar
 * consulta" dentro do endereço dele. Pelo link da clínica: todas, separadas por profissional.
 */
export const MINE_PROFESSIONAL_PARAM = "profissional";

export type MineScope = { professional: PortalProfessional | null; listHref: string; home: string };

export function mineScope(Astro: AstroGlobal, page: Extract<PortalPage, { kind: "open" }>): MineScope {
  const found = professionalOf(page.portal, Astro.url.searchParams.get(MINE_PROFESSIONAL_PARAM) ?? undefined);
  const professional = found && !found.exam ? found : null;
  const home = professional ? `${page.base}/${professional.slug}` : page.base;
  return { professional, listHref: `${home}/minhas-consultas`, home };
}

/** Endereço interno da tela de Minhas consultas da clínica, para a página do profissional reescrever (`sub`: "", "/remarcar"…). */
export function mineRewriteTarget(Astro: AstroGlobal, sub: "" | "/remarcar" | "/confirmar" | "/cancelar"): string {
  const params = new URLSearchParams(Astro.url.searchParams);
  params.set(MINE_PROFESSIONAL_PARAM, (Astro.params.profissional ?? "").toLowerCase());
  return `${PORTAL_PREFIX}/${(Astro.params.clinica ?? "").toLowerCase()}/minhas-consultas${sub}?${params}`;
}
