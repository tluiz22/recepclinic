// Abas do cadastro do profissional (redesenho, cliente, 13/nov/2026, Opção A): cada parte numa
// aba (`?aba=`) e o formulário só aberto quando pedido (`?editar=`). Depois de salvar, a tela
// volta para a aba da parte salva; com erro, volta com o formulário aberto para corrigir.

export type ProfessionalTab = "perfil" | "atendimento" | "convenios" | "bot" | "acesso";
export type ProfessionalEdit = "dados" | "atendimento" | "convenios" | "bot";

const TAB_LABELS: Record<ProfessionalTab, string> = {
  perfil: "Perfil",
  atendimento: "Atendimento",
  convenios: "Convênios",
  bot: "Bot",
  acesso: "Acesso ao painel",
};

/** Parte editada em cada aba (o Perfil edita os dados; as outras, a si mesmas). */
const EDIT_OF: Record<ProfessionalTab, ProfessionalEdit | null> = {
  perfil: "dados",
  atendimento: "atendimento",
  convenios: "convenios",
  bot: "bot",
  acesso: null,
};

/** Abas que a clínica tem (Convênios e Bot só com o item ligado; Acesso só para o Administrador) e as escolhidas no endereço. */
export function professionalTabs(
  url: URL,
  features: { insurance: boolean; bot: boolean; access?: boolean },
): { tabs: { id: ProfessionalTab; label: string }[]; tab: ProfessionalTab; edit: ProfessionalEdit | null } {
  const ids: ProfessionalTab[] = ["perfil", "atendimento", ...(features.insurance ? ["convenios" as const] : []), ...(features.bot ? ["bot" as const] : []), ...(features.access ? ["acesso" as const] : [])];
  const asked = url.searchParams.get("aba");
  const tab = ids.find((id) => id === asked) ?? "perfil";
  const editOfTab = EDIT_OF[tab];
  const edit = editOfTab && url.searchParams.get("editar") === editOfTab ? editOfTab : null;
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
    case "convidar":
    case "ligar_login":
    case "reenviar":
    case "trocar_email":
    case "cancelar_convite":
    case "tirar_acesso":
      return { tab: "acesso", edit: null };
    default:
      return { tab: "perfil", edit: null };
  }
}

/** Endereço do cadastro numa aba (e com a parte aberta), mantendo o `?todos=1` da lista. */
export function professionalPage(id: string, tab: ProfessionalTab, edit: ProfessionalEdit | null, all: boolean): string {
  const query = [tab === "perfil" && !edit ? "" : `aba=${tab}`, edit ? `editar=${edit}` : "", all ? "todos=1" : ""].filter(Boolean).join("&");
  return `/admin/configuracoes/profissionais/${id}${query ? `?${query}` : ""}`;
}
