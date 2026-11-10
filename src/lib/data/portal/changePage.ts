import type { AstroGlobal } from "astro";
import { portalHref } from "../../portal";
import { readSession, type PortalSession } from "./identity";
import { sessionLinkFor, type PortalLink } from "./links";
import { findMyAppointment, leadHoursOf, outsideLead, type MyAppointment } from "./myAppointments";
import { openPortalPage, type PortalPage } from "./page";

// Abertura das telas de remarcar e cancelar (F3c): a clínica, a sessão com o celular comprovado (senão, Minhas
// consultas pede o celular), o atendimento do endereço (`a`) se é deste celular, e o que o link do bot libera (sem a
// antecedência no Remarcar do bot e do lembrete, F3-4; marcar de novo o cancelado pela clínica, F3-3).

export type ChangePage =
  | { kind: "page"; page: PortalPage }
  | { kind: "redirect"; response: Response }
  | {
      kind: "open";
      page: Extract<PortalPage, { kind: "open" }>;
      session: PortalSession & { phone: string };
      item: MyAppointment;
      /** Antecedência que vale (null = não vale: link do bot). */
      leadHours: number | null;
      rebook: boolean;
      /** O link do bot desta sessão para este atendimento (remarcar), se ainda vale. */
      link: PortalLink | null;
      base: string;
      listHref: string;
    };

export async function openChangePage(Astro: AstroGlobal, action: "remarcar" | "cancelar"): Promise<ChangePage> {
  const page = await openPortalPage(Astro);
  if (page.kind !== "open") {
    if (page.kind === "not_found") Astro.response.status = 404;
    return { kind: "page", page };
  }
  const { db, portal, base } = page;
  const listHref = `${base}/minhas-consultas`;
  const id = Astro.url.searchParams.get("a") ?? "";
  const session = await readSession(db, portal.clinicId, Astro.cookies);
  if (!session?.verified || !session.phone) return { kind: "redirect", response: Astro.redirect(listHref) };
  const allowed = await sessionLinkFor(db, portal.clinicId, session, id);
  // Cancelar o cancelado pela clínica não existe: o link de remarcação só remarca.
  const rebook = allowed.rebook && action === "remarcar";
  const item = await findMyAppointment(db, portal.clinicId, session.phone, id, { canceledByClinic: rebook });
  if (!item || (action === "remarcar" && !item.canReschedule)) return { kind: "redirect", response: Astro.redirect(portalHref(listHref, { aviso: "mudou" })) };
  // O link do bot dispensa a antecedência só para remarcar (F3-4); cancelar pelo portal segue a regra (RD10).
  const leadHours = allowed.noLead && action === "remarcar" ? null : await leadHoursOf(db, portal.clinicId);
  if (!rebook && leadHours !== null && !outsideLead(item.start, leadHours)) return { kind: "redirect", response: Astro.redirect(portalHref(listHref, { aviso: "prazo" })) };
  return { kind: "open", page, session: { ...session, phone: session.phone }, item, leadHours, rebook, link: allowed.link, base, listHref };
}
