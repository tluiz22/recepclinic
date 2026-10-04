import { describe, expect, it } from "vitest";
import { OFFER_MINUTES, offerButtonPayload, relativeWhenLabel, waitlistOfferText } from "./waitlistOffers";

describe("waitlistOfferText", () => {
  const base = {
    guardianFirstName: "Maria",
    typeWord: "consulta",
    patientName: "João",
    slotLabel: "amanhã às 9h",
    currentLabel: "sex 23/10 às 14h",
  };

  it("prazo da oferta: 60 minutos", () => {
    expect(OFFER_MINUTES).toBe(60);
  });

  it("texto completo da oferta", () => {
    expect(waitlistOfferText(base)).toBe(
      "Olá, Maria! Abriu uma vaga de consulta para João: amanhã às 9h. " +
        "É antes do horário marcado (sex 23/10 às 14h). Quer antecipar? Responda em até 60 minutos.",
    );
  });

  it("sem o primeiro nome do responsável, só Olá!", () => {
    expect(waitlistOfferText({ ...base, guardianFirstName: "" }).startsWith("Olá! Abriu uma vaga")).toBe(true);
  });
});

describe("relativeWhenLabel", () => {
  // Quarta, 14/10/2026, 09h em Fortaleza.
  const now = new Date("2026-10-14T12:00:00Z");

  it("hoje", () => {
    expect(relativeWhenLabel(new Date("2026-10-14T17:00:00Z"), now)).toBe("hoje às 14h");
  });

  it("amanhã", () => {
    expect(relativeWhenLabel(new Date("2026-10-15T12:30:00Z"), now)).toBe("amanhã às 9h30");
  });

  it("outros dias: dia da semana abreviado e data", () => {
    expect(relativeWhenLabel(new Date("2026-10-23T17:00:00Z"), now)).toBe("sex 23/10 às 14h");
  });

  it("23h de Fortaleza de hoje ainda é hoje", () => {
    expect(relativeWhenLabel(new Date("2026-10-15T02:00:00Z"), now)).toBe("hoje às 23h");
  });
});

describe("offerButtonPayload", () => {
  it("código do botão com a resposta e a oferta", () => {
    expect(offerButtonPayload("yes", "abc-123")).toBe("waitlist:yes:abc-123");
    expect(offerButtonPayload("no", "abc-123")).toBe("waitlist:no:abc-123");
  });
});
