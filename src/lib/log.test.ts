import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DataError } from "./data/errors";
import { describeError, formatLogLine, maskPersonalData } from "./log";

describe("máscara de dados pessoais (F9.2)", () => {
  it("telefones com e sem +55, com separadores", () => {
    expect(maskPersonalData("para 5561999031234 falhou")).toBe("para [telefone] falhou");
    expect(maskPersonalData("número +55 61 99903-3143")).toBe("número [telefone]");
    expect(maskPersonalData("(61) 99903-3143")).toBe("([telefone]");
  });

  it("e-mails", () => {
    expect(maskPersonalData("550 <ana.k+teste@clinica.com.br> recusado")).toBe("550 <[e-mail]> recusado");
  });

  it("mantém ids, datas e códigos", () => {
    const id = "08902715-5eb2-4e0c-9357-9809df787bb8";
    expect(maskPersonalData(`atendimento ${id}`)).toBe(`atendimento ${id}`);
    expect(maskPersonalData("wamid.HBgMNTU2MTk5OTAzMzE0MxUCABEYEjQ1")).toBe("wamid.HBgMNTU2MTk5OTAzMzE0MxUCABEYEjQ1");
    expect(maskPersonalData("em 2026-10-09, código 131030, 23505")).toBe("em 2026-10-09, código 131030, 23505");
  });
});

describe("descrição do erro", () => {
  it("erro do Postgres: só código e mensagem, sem details", () => {
    const pg = { code: "23505", message: "duplicate key value violates unique constraint", details: "Key (phone)=(5561999031234) already exists." };
    const text = describeError(pg);
    expect(text).toBe("(23505) duplicate key value violates unique constraint");
    expect(text).not.toContain("5561999031234");
  });

  it("DataError com a causa do banco", () => {
    const error = new DataError("duplicate", "Paciente: já existe um cadastro igual", {}, { cause: { code: "23505", message: "duplicate key", details: "Key (full_name)=(Maria)" } });
    expect(describeError(error)).toBe("DataError (duplicate): Paciente: já existe um cadastro igual | causa: (23505) duplicate key");
  });

  it("corta mensagens longas", () => {
    expect(describeError(new Error("x".repeat(2000))).length).toBeLessThanOrEqual(501);
  });
});

describe("linha do log", () => {
  it("escopo, ids e erro", () => {
    expect(formatLogLine("whatsapp envio", { clinica: "c1", atendimento: "a1", vazio: null }, new Error("falhou para 5561999031234"))).toBe(
      "[whatsapp envio] clinica=c1 atendimento=a1 — Error: falhou para [telefone]",
    );
  });

  it("sem erro", () => {
    expect(formatLogLine("whatsapp webhook", { erros: 2 })).toBe("[whatsapp webhook] erros=2");
  });
});

describe("todo log do servidor passa por src/lib/log.ts", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });

  it("sem console.* fora dele (os scripts do navegador ficam de fora)", () => {
    const offenders = files("src")
      .filter((path) => /\.(ts|astro)$/.test(path) && !path.endsWith(".test.ts") && !path.endsWith(join("lib", "log.ts")))
      .filter((path) => /console\.(log|error|warn|info|debug)\(/.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
