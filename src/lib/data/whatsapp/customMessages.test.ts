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
    expect(markersToTemplate("consultation_guidance", "Oi, {nome}! {clinica} avisa: o paciente {paciente} tem orientações: {link} Até logo!")).toBe(
      "Oi, {{1}}! {{2}} avisa: o paciente {{3}} tem orientações: {{4}} Até logo!",
    );
  });

  it("recusa marcador faltando, repetido, fora de ordem, desconhecido e texto que começa ou termina com marcador", () => {
    expect(fieldError(() => markersToTemplate("consultation_guidance", "Oi, {nome}! {clinica}: {paciente}. Até logo"))).toBe("Falta: {link}");
    expect(fieldError(() => markersToTemplate("consultation_guidance", "Oi, {nome} {nome}! {clinica} {paciente} {link}."))).toBe(
      "Use cada campo automático uma vez só: {nome}",
    );
    expect(fieldError(() => markersToTemplate("consultation_guidance", "Oi, {clinica}! {nome} {paciente} {link}."))).toBe(
      "Os campos automáticos precisam ficar nesta ordem: {nome}, {clinica}, {paciente}, {link}",
    );
    expect(fieldError(() => markersToTemplate("consultation_guidance", "Oi, {nome}! {clinica} {paciente} {link} {cpf}."))).toBe("Campo automático desconhecido: {cpf}");
    expect(fieldError(() => markersToTemplate("consultation_guidance", "Oi, {nome}! {clinica} {paciente} {link}"))).toBe(
      "O texto não pode começar nem terminar com um campo automático (regra da Meta)",
    );
  });
});

describe("conversa do bot (F6.6)", () => {
  it("link enviado exige o {link}; marcador de outra mensagem não vale", () => {
    expect(fieldError(() => validateBotMessage("booking_link", "Marque aqui!"))).toBe("Falta: {link}");
    expect(fieldError(() => validateBotMessage("welcome", "Oi, {paciente}!"))).toBe("Campo automático desconhecido: {paciente}");
    expect(validateBotMessage("welcome", "  Oi! Aqui é {clinica} 😊  ")).toBe("Oi! Aqui é {clinica} 😊");
  });

  it("preenche os marcadores", () => {
    expect(renderMarkers("Para *{servico}* de {paciente}: {link}", { servico: "Consulta", paciente: "João", link: "https://x" })).toBe(
      "Para *Consulta* de João: https://x",
    );
  });
});
