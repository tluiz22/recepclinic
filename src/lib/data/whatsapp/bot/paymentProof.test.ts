import { describe, expect, it } from "vitest";
import { followsRecentProof, isPaymentProof, type ProofInput } from "./paymentProof";

const base: ProofInput = { type: "image", text: null, fileName: null, idle: true, recentCompletedAppointment: false, followsRecentProof: false };
const proof = (o: Partial<ProofInput>) => isPaymentProof({ ...base, ...o });

describe("comprovante de pagamento", () => {
  it("foto ou PDF com palavra de pagamento na legenda ou no nome do arquivo", () => {
    expect(proof({ text: "Segue o PIX" })).toBe(true);
    expect(proof({ type: "document", fileName: "Comprovante_transferência.pdf" })).toBe(true);
    expect(proof({ text: "foto do meu exame" })).toBe(false);
  });
  it("sem legenda só com consulta concluída nas últimas 24 h", () => {
    expect(proof({})).toBe(false);
    expect(proof({ recentCompletedAppointment: true })).toBe(true);
    expect(proof({ type: "document", recentCompletedAppointment: true })).toBe(true);
  });
  it("anexo logo depois de um comprovante reconhecido", () => {
    expect(proof({ followsRecentProof: true })).toBe(true);
  });
  it("conversa no meio de uma marcação não conta", () => {
    expect(proof({ text: "pix", idle: false })).toBe(false);
    expect(proof({ recentCompletedAppointment: true, idle: false })).toBe(false);
  });
  it("texto só de pagamento depois da consulta; pedido ou outro tipo não", () => {
    expect(proof({ type: "text", text: "paguei o pix", recentCompletedAppointment: true })).toBe(true);
    expect(proof({ type: "text", text: "paguei o pix", recentCompletedAppointment: false })).toBe(false);
    expect(proof({ type: "text", text: "paguei, quero marcar o retorno", recentCompletedAppointment: true })).toBe(false);
    expect(proof({ type: "text", text: "pix?", recentCompletedAppointment: true })).toBe(false);
    expect(proof({ type: "video", recentCompletedAppointment: true })).toBe(false);
    expect(proof({ type: "audio", text: "pix", recentCompletedAppointment: true })).toBe(false);
  });
  it("janela de 10 minutos", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    expect(followsRecentProof({ paymentProofAt: "2026-11-12T11:55:00Z" }, now)).toBe(true);
    expect(followsRecentProof({ paymentProofAt: "2026-11-12T11:45:00Z" }, now)).toBe(false);
    expect(followsRecentProof({}, now)).toBe(false);
  });
});
