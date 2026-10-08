import { describe, expect, it } from "vitest";
import { DataError } from "../errors";
import { markersToTemplate, renderMarkers, templateToMarkers, validateBotMessage } from "./customMessages";
import { defaultTemplate } from "./templates";

const fieldError = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof DataError) return error.fields.text;
    throw error;
  }
  return null;
};

describe("marcadores dos templates (F6.6)", () => {
  it("o padrão vira marcadores e volta igual", () => {
    const body = defaultTemplate("confirmation")!.body;
    const text = templateToMarkers("confirmation", body);
    expect(text).toContain("Olá, {nome}! Aqui é {clinica}.");
    expect(text).toContain("📍 {local}");
    expect(markersToTemplate("confirmation", text)).toBe(body);
  });

  it("texto próprio com os marcadores na ordem do padrão", () => {
    expect(markersToTemplate("exam_preparation", "Oi, {nome}! {clinica} avisa: o exame {exame} tem preparo: {link} Até logo!")).toBe(
      "Oi, {{1}}! {{2}} avisa: o exame {{3}} tem preparo: {{4}} Até logo!",
    );
  });

  it("recusa marcador faltando, repetido, fora de ordem, desconhecido e texto que começa ou termina com marcador", () => {
    expect(fieldError(() => markersToTemplate("exam_preparation", "Oi, {nome}! {clinica}: {exame}. Até logo"))).toBe("Falta: {link}");
    expect(fieldError(() => markersToTemplate("exam_preparation", "Oi, {nome} {nome}! {clinica} {exame} {link}."))).toBe(
      "Use cada marcador uma vez só: {nome}",
    );
    expect(fieldError(() => markersToTemplate("exam_preparation", "Oi, {clinica}! {nome} {exame} {link}."))).toBe(
      "Os marcadores precisam ficar nesta ordem: {nome}, {clinica}, {exame}, {link}",
    );
    expect(fieldError(() => markersToTemplate("exam_preparation", "Oi, {nome}! {clinica} {exame} {link} {cpf}."))).toBe("Marcador desconhecido: {cpf}");
    expect(fieldError(() => markersToTemplate("exam_preparation", "Oi, {nome}! {clinica} {exame} {link}"))).toBe(
      "O texto não pode começar nem terminar com um marcador (regra da Meta)",
    );
  });
});

describe("conversa do bot (F6.6)", () => {
  it("link enviado exige o {link}; marcador de outra mensagem não vale", () => {
    expect(fieldError(() => validateBotMessage("booking_link", "Marque aqui!"))).toBe("Falta: {link}");
    expect(fieldError(() => validateBotMessage("welcome", "Oi, {paciente}!"))).toBe("Marcador desconhecido: {paciente}");
    expect(validateBotMessage("welcome", "  Oi! Aqui é {clinica} 😊  ")).toBe("Oi! Aqui é {clinica} 😊");
  });

  it("preenche os marcadores", () => {
    expect(renderMarkers("Para *{servico}* de {paciente}: {link}", { servico: "Consulta", paciente: "João", link: "https://x" })).toBe(
      "Para *Consulta* de João: https://x",
    );
  });
});
