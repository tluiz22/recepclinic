// Abas do cadastro do profissional (redesenho, cliente, 13/nov/2026, Opção A): cada parte numa
// aba (`?aba=`) e o formulário só aberto quando pedido (`?editar=`). Depois de salvar, a tela
// volta para a aba da parte salva; com erro, volta com o formulário aberto para corrigir.

export type ProfessionalTab = "perfil" | "atendimento" | "convenios" | "orientacoes" | "acesso";
export type ProfessionalEdit = "dados" | "atendimento" | "convenios" | "orientacoes";

const TAB_LABELS: Record<ProfessionalTab, string> = {
  perfil: "Perfil",
  atendimento: "Atendimento",
  convenios: "Convênios",
  orientacoes: "Orientações",
  acesso: "Acesso ao painel",
};

/** Parte editada em cada aba (o Perfil edita os dados; as outras, a si mesmas). */
const EDIT_OF: Record<ProfessionalTab, ProfessionalEdit | null> = {
  perfil: "dados",
  atendimento: "atendimento",
  convenios: "convenios",
  orientacoes: "orientacoes",
  acesso: null,
};

/** Abas que a clínica tem (Convênios só com o item ligado; Orientações em cadastro existente; Acesso só para o Administrador) e as escolhidas no endereço. */
export function professionalTabs(
  url: URL,
  features: { insurance: boolean; orientations: boolean; access?: boolean },
): { tabs: { id: ProfessionalTab; label: string }[]; tab: ProfessionalTab; edit: ProfessionalEdit | null } {
  const ids: ProfessionalTab[] = ["perfil", "atendimento", ...(features.insurance ? ["convenios" as const] : []), ...(features.orientations ? ["orientacoes" as const] : []), ...(features.access ? ["acesso" as const] : [])];
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
      return { tab: "orientacoes", edit: "orientacoes" };
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

/** Volta para o cadastro do profissional vinda de outra tela (Equipe): só esse endereço, nada de fora. */
export function professionalReturn(value: string | null | undefined): string | null {
  return value && /^\/admin\/configuracoes\/profissionais\/[0-9a-f-]{36}(\?[a-z=&]*)?$/.test(value) ? value : null;
}

/** Explicação de cada aba (cliente, 13/nov/2026): para que serve e onde o que está nela aparece. */
export const TAB_INTROS: Record<ProfessionalTab, string> = {
  perfil: "Como o profissional aparece para o paciente: no portal, no link de agendamento e nas mensagens do WhatsApp.",
  atendimento: "Quem este profissional atende, com quanta antecedência o paciente pode marcar e a idade limite. Vale só para a agenda dele.",
  convenios: "O que o profissional aceita: particular e convênios. O paciente vê ao agendar e nas respostas do WhatsApp.",
  orientacoes: "Textos que o paciente lê sobre este profissional. As observações aparecem no portal, ao escolher o profissional; pagamento e convênios, no WhatsApp.",
  acesso: "Como o profissional entra no painel: o e-mail recebe o convite e ele passa a ver só a própria agenda.",
};
