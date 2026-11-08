// Dono do serviço (MS, 07/nov/2026): um profissional ou a equipe (exames).
// Nomes e grupos para as telas, agrupados pela especialidade principal
// (clínicas com 10+ profissionais).

export const TEAM_OWNER_LABEL = "Equipe (exames)";
export const NO_SPECIALTY_GROUP = "Outros profissionais";

type ProfessionalLike = { id: string; displayName: string; isActive: boolean; specialties: { name: string }[] };
type OwnerLike = { professionalId: string | null; isTeam: boolean };

export function ownerLabel(service: OwnerLike, professionals: ProfessionalLike[]): string {
  if (service.isTeam) return TEAM_OWNER_LABEL;
  const p = professionals.find((x) => x.id === service.professionalId);
  if (!p) return "Sem profissional";
  const specialty = p.specialties[0]?.name;
  return specialty ? `${p.displayName} (${specialty})` : p.displayName;
}

export type OwnerOptionGroup = { label: string; options: { value: string; label: string }[] };

/** Profissionais ativos por especialidade principal (em ordem alfabética), depois os sem especialidade e a equipe. */
export function ownerOptionGroups(professionals: ProfessionalLike[], { team }: { team: boolean }): OwnerOptionGroup[] {
  const groups = new Map<string, OwnerOptionGroup>();
  const sorted = professionals.filter((p) => p.isActive).sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));
  for (const p of sorted) {
    const label = p.specialties[0]?.name ?? NO_SPECIALTY_GROUP;
    if (!groups.has(label)) groups.set(label, { label, options: [] });
    groups.get(label)!.options.push({ value: p.id, label: p.displayName });
  }
  const ordered = [...groups.values()].sort((a, b) =>
    a.label === NO_SPECIALTY_GROUP ? 1 : b.label === NO_SPECIALTY_GROUP ? -1 : a.label.localeCompare(b.label, "pt-BR"),
  );
  if (team) ordered.push({ label: "Exames", options: [{ value: "equipe", label: TEAM_OWNER_LABEL }] });
  return ordered;
}
