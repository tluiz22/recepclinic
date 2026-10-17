// Seções de Configurações no menu lateral (redesign R9, cliente, 17/out/2026):
// 4 grupos, na ordem do guia de configuração. Convênios e Nota fiscal só com
// o item liberado (D11); WhatsApp só para o Suporte (cliente, 08/out/2026).
import type { FeatureKey } from "../../../lib/features";
import type { SetupStatus } from "../../../lib/data/config/setup";

export type SectionId =
  | "clinica"
  | "equipe"
  | "profissionais"
  | "locais"
  | "agendas"
  | "servicos"
  | "horarios"
  | "feriados"
  | "convenios"
  | "lembretes"
  | "mensagens"
  | "whatsapp"
  | "nota_fiscal";

export interface SectionItem {
  id: SectionId;
  label: string;
  href: string;
  /** Pendências do guia de configuração (0: sem número). */
  pending: number;
  /** Selo "Suporte": só o Suporte vê. */
  supportOnly?: boolean;
}

export interface SectionGroup {
  title: string;
  items: SectionItem[];
}

const BASE = "/admin/configuracoes";

// Passo do guia → seção do menu.
const STEP_SECTION: Partial<Record<SetupStatus["steps"][number]["key"], SectionId>> = {
  professionals: "profissionais",
  locations: "locais",
  agendas: "agendas",
  services: "servicos",
  hours: "horarios",
};

/** Pendências de cada passo, como no guia: "Falta" conta 1; "Atenção", um por item. */
export function pendingBySection(setup: SetupStatus | null): Map<SectionId, number> {
  const counts = new Map<SectionId, number>();
  for (const step of setup?.steps ?? []) {
    const section = STEP_SECTION[step.key];
    if (!section || step.status === "done") continue;
    counts.set(section, step.status === "missing" ? 1 : step.items.length);
  }
  return counts;
}

export function configSections(
  features: readonly FeatureKey[],
  isSupport: boolean,
  setup: SetupStatus | null,
): SectionGroup[] {
  const pending = pendingBySection(setup);
  const item = (id: SectionId, label: string, path: string, extra: Partial<SectionItem> = {}): SectionItem => ({
    id,
    label,
    href: `${BASE}${path}`,
    pending: pending.get(id) ?? 0,
    ...extra,
  });
  const groups: SectionGroup[] = [
    { title: "A clínica", items: [item("clinica", "Clínica", ""), item("equipe", "Equipe", "/equipe")] },
    {
      title: "Atendimento",
      items: [
        item("profissionais", "Profissionais", "/profissionais"),
        item("locais", "Locais", "/locais"),
        item("agendas", "Agendas", "/agendas"),
        item("servicos", "Serviços", "/servicos"),
        item("horarios", "Horários", "/horarios"),
        item("feriados", "Feriados", "/feriados"),
        ...(features.includes("insurance") ? [item("convenios", "Convênios", "/convenios")] : []),
      ],
    },
    {
      title: "Mensagens",
      items: [
        item("lembretes", "Lembretes", "/lembretes"),
        item("mensagens", "Mensagens", "/mensagens"),
        ...(isSupport ? [item("whatsapp", "WhatsApp", "/whatsapp", { supportOnly: true })] : []),
      ],
    },
    // Dados fiscais e certificado A1 (F11.3): com o Módulo financeiro.
    ...(features.includes("finance") ? [{ title: "Financeiro", items: [item("nota_fiscal", "Nota fiscal", "/nota-fiscal")] }] : []),
  ];
  return groups;
}
