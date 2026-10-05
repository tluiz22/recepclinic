import type { AstroCookies } from "astro";
import { resolveAgendaChoice } from "../../agendaChoice";
import type { DbClient } from "../clients";
import { listAgendas } from "../config/agendas";
import type { AgendaScope } from "./view";

/** Agendas da tela da Agenda (F4.5): as que a pessoa vê (RLS) e a escolhida. */
export async function loadAgendaScope(db: DbClient, clinicId: string, url: URL, cookies: AstroCookies): Promise<AgendaScope> {
  const agendas = await listAgendas(db, clinicId, { includeInactive: true });
  const selectable = agendas.filter((a) => a.isActive);
  const selectedAgendaId = resolveAgendaChoice(url, cookies, clinicId, selectable);
  return {
    agendas,
    selectable,
    selectedAgendaId,
    agendaIds: selectedAgendaId ? [selectedAgendaId] : agendas.map((a) => a.id),
    agendaNames: new Map(agendas.map((a) => [a.id, a.name])),
  };
}
