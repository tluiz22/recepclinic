import { describe, expect, it } from "vitest";
import { professionalPage, professionalTabs, tabOfAction } from "./professionalTabs";

const url = (query: string) => new URL(`https://x.test/admin/configuracoes/profissionais/p1${query}`);
const ALL = { insurance: true, bot: true };

describe("professionalTabs", () => {
  it("abre no Perfil, sem edição", () => {
    expect(professionalTabs(url(""), ALL)).toMatchObject({ tab: "perfil", edit: null });
  });

  it("só mostra Convênios e Bot com o item ligado", () => {
    expect(professionalTabs(url(""), { insurance: false, bot: false }).tabs.map((t) => t.id)).toEqual(["perfil", "atendimento"]);
    expect(professionalTabs(url(""), ALL).tabs.map((t) => t.label)).toEqual(["Perfil", "Atendimento", "Convênios", "Bot"]);
  });

  it("aba desligada ou desconhecida volta ao Perfil", () => {
    expect(professionalTabs(url("?aba=bot"), { insurance: true, bot: false }).tab).toBe("perfil");
    expect(professionalTabs(url("?aba=xyz"), ALL).tab).toBe("perfil");
  });

  it("abre a edição só da parte daquela aba", () => {
    expect(professionalTabs(url("?aba=convenios&editar=convenios"), ALL)).toMatchObject({ tab: "convenios", edit: "convenios" });
    expect(professionalTabs(url("?editar=dados"), ALL)).toMatchObject({ tab: "perfil", edit: "dados" });
    expect(professionalTabs(url("?aba=bot&editar=dados"), ALL).edit).toBeNull();
  });
});

describe("tabOfAction e professionalPage", () => {
  it("cada ação volta para a sua aba", () => {
    expect(tabOfAction("salvar")).toEqual({ tab: "perfil", edit: "dados" });
    expect(tabOfAction("bot_info")).toEqual({ tab: "bot", edit: "bot" });
    expect(tabOfAction("foto")).toEqual({ tab: "perfil", edit: null });
  });

  it("monta o endereço com a aba, a edição e o filtro da lista", () => {
    expect(professionalPage("p1", "perfil", null, false)).toBe("/admin/configuracoes/profissionais/p1");
    expect(professionalPage("p1", "perfil", null, true)).toBe("/admin/configuracoes/profissionais/p1?todos=1");
    expect(professionalPage("p1", "convenios", "convenios", true)).toBe("/admin/configuracoes/profissionais/p1?aba=convenios&editar=convenios&todos=1");
    expect(professionalPage("p1", "perfil", "dados", false)).toBe("/admin/configuracoes/profissionais/p1?aba=perfil&editar=dados");
  });
});
