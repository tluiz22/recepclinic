import { describe, expect, it } from "vitest";
import { DataError } from "./data/errors";
import { describeDataError } from "./data/formAction";
import { takeFlash, setFlash } from "./flash";
import { centsToInput, formChecked, formInt, formOptionalInt, formOptionalText, parseMoneyCents } from "./forms";

const form = (entries: [string, string][]) => {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
};

describe("campos do formulário", () => {
  it("valores em reais viram centavos", () => {
    expect(parseMoneyCents("150")).toBe(15000);
    expect(parseMoneyCents("150,5")).toBe(15050);
    expect(parseMoneyCents("150.50")).toBe(15050);
    expect(parseMoneyCents("1.234,56")).toBe(123456);
    expect(parseMoneyCents("R$ 99,90")).toBe(9990);
    expect(parseMoneyCents("")).toBeNaN();
    expect(parseMoneyCents("12,345")).toBeNaN();
    expect(parseMoneyCents("-10")).toBeNaN();
    expect(centsToInput(15050)).toBe("150,50");
    expect(centsToInput(null)).toBe("");
  });

  it("inteiros, textos opcionais e caixas de marcar", () => {
    const data = form([
      ["n", "30"],
      ["x", "3.5"],
      ["vazio", "  "],
      ["texto", "  Dra. Ana "],
      ["marcado", "on"],
    ]);
    expect(formInt(data, "n")).toBe(30);
    expect(formInt(data, "x")).toBeNaN();
    expect(formOptionalInt(data, "vazio")).toBeNull();
    expect(formOptionalText(data, "vazio")).toBeNull();
    expect(formOptionalText(data, "texto")).toBe("Dra. Ana");
    expect(formChecked(data, "marcado")).toBe(true);
    expect(formChecked(data, "ausente")).toBe(false);
  });
});

describe("avisos depois de salvar", () => {
  it("mensagem dos campos, ou um texto claro para cada tipo de erro", () => {
    expect(describeDataError(new DataError("invalid", "Serviço: x", { name: "Informe o nome do serviço", durationMinutes: "Duração inválida" }))).toBe(
      "Informe o nome do serviço Duração inválida",
    );
    expect(describeDataError(new DataError("duplicate", "Local: já existe um cadastro igual"))).toBe("Já existe um cadastro igual.");
    expect(describeDataError(new DataError("not_enabled", "x"))).toBe("Isso não está liberado para a clínica.");
    expect(describeDataError(new DataError("forbidden", "x"))).toBe("Você não tem permissão para isso.");
  });

  it("o aviso é lido uma vez; cookie estragado não mostra nada", () => {
    const store = new Map<string, string>();
    const cookies = {
      set: (name: string, value: string) => store.set(name, value),
      get: (name: string) => (store.has(name) ? { value: store.get(name)! } : undefined),
      delete: (name: string) => store.delete(name),
    } as unknown as Parameters<typeof setFlash>[0];
    setFlash(cookies, { tone: "success", text: "Salvo." });
    expect(takeFlash(cookies)).toEqual({ tone: "success", text: "Salvo." });
    expect(takeFlash(cookies)).toBeNull();
    store.set("rc_aviso", "não-é-json");
    expect(takeFlash(cookies)).toBeNull();
    store.set("rc_aviso", Buffer.from(JSON.stringify({ tone: "alerta", text: "x" })).toString("base64url"));
    expect(takeFlash(cookies)).toBeNull();
  });
});
