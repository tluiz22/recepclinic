// Abas do cadastro do profissional (redesenho, cliente, 13/nov/2026, Opção A): cada parte numa
// aba (`?aba=`) e o formulário só aberto quando pedido (`?editar=`). Depois de salvar, a tela
// volta para a aba da parte salva; com erro, volta com o formulário aberto para corrigir.

export type ProfessionalTab = "perfil" | "atendimento" | "convenios" | "bot";
export type ProfessionalEdit = "dados" | "atendimento" | "convenios" | "bot";

const TAB_LABELS: Record<ProfessionalTab, string> = {
  perfil: "Perfil",
  atendimento: "Atendimento",
  convenios: "Convênios",
  bot: "Bot",
};

/** Parte editada em cada aba (o Perfil edita os dados; as outras, a si mesmas). */
const EDIT_OF: Record<ProfessionalTab, ProfessionalEdit> = {
  perfil: "dados",
  atendimento: "atendimento",
  convenios: "convenios",
  bot: "bot",
};

/** Abas que a clínica tem (Convênios e Bot só com o item ligado) e as escolhidas no endereço. */
export function professionalTabs(
  url: URL,
  features: { insurance: boolean; bot: boolean },
): { tabs: { id: ProfessionalTab; label: string }[]; tab: ProfessionalTab; edit: ProfessionalEdit | null } {
  const ids: ProfessionalTab[] = ["perfil", "atendimento", ...(features.insurance ? ["convenios" as const] : []), ...(features.bot ? ["bot" as const] : [])];
  const asked = url.searchParams.get("aba");
  const tab = ids.find((id) => id === asked) ?? "perfil";
  const edit = url.searchParams.get("editar") === EDIT_OF[tab] ? EDIT_OF[tab] : null;
  return { tabs: ids.map((id) => ({ id, label: TAB_LABELS[id] })), tab, edit };
}

/** Aba e parte de cada ação do formulário (`acao`); a foto e o Desativar ficam no Perfil, sem edição. */
export function tabOfAction(acao: string): { tab: ProfessionalTab; edit: ProfessionalEdit | null } {
  switch (acao) {
    case "salvar":
      return { tab: "perfil", edit: "dados" };
    case "atendimento":
      return { tab: "atendimento", edit: "atendimento" };
    case "convenios":
      return { tab: "convenios", edit: "convenios" };
    case "bot_info":
      return { tab: "bot", edit: "bot" };
    default:
      return { tab: "perfil", edit: null };
  }
}

/** Endereço do cadastro numa aba (e com a parte aberta), mantendo o `?todos=1` da lista. */
export function professionalPage(id: string, tab: ProfessionalTab, edit: ProfessionalEdit | null, all: boolean): string {
  const query = [tab === "perfil" && !edit ? "" : `aba=${tab}`, edit ? `editar=${edit}` : "", all ? "todos=1" : ""].filter(Boolean).join("&");
  return `/admin/configuracoes/profissionais/${id}${query ? `?${query}` : ""}`;
}
