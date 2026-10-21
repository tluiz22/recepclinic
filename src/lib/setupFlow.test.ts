import { describe, expect, it } from "vitest";
import { originPage, setupOrigin, setupParam, withParams } from "./setupFlow";

const ID = "3f2c1b9a-8d7e-4c6b-9a5f-1e2d3c4b5a69";
const url = (search: string) => new URL(`https://app.test/admin/configuracoes/locais/novo${search}`);

describe("origem da jornada de configuração (cliente, 21/out)", () => {
  it("aceita só id de cadastro; o serviço ainda não salvo é 'novo'", () => {
    expect(setupParam(url(`?profissional=${ID}`), "profissional")).toBe(ID);
    expect(setupParam(url("?profissional=../../x"), "profissional")).toBeNull();
    expect(setupParam(url("?servico=novo"), "servico")).toBe("novo");
    expect(setupParam(url("?agenda=novo"), "agenda")).toBeNull();
  });

  it("a primeira origem presente, na ordem pedida, e a tela dela", () => {
    const origin = setupOrigin(url(`?agenda=${ID}&local=${ID}`), ["local", "agenda"]);
    expect(origin).toEqual({ kind: "local", id: ID });
    expect(originPage(origin!)).toBe(`/admin/configuracoes/locais/${ID}`);
    expect(originPage({ kind: "servico", id: "novo" })).toBe("/admin/configuracoes/servicos/novo");
    expect(setupOrigin(url(""), ["local"])).toBeNull();
  });

  it("monta o endereço sem os parâmetros vazios", () => {
    expect(withParams("/admin/configuracoes/servicos/novo", { agenda: "a", local: null })).toBe("/admin/configuracoes/servicos/novo?agenda=a");
    expect(withParams("/x?todos=1", { local: "l" })).toBe("/x?todos=1&local=l");
    expect(withParams("/x", {})).toBe("/x");
  });
});
