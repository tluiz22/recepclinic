import { describe, expect, it } from "vitest";
import { cancelNoticeText, whatsappMessageHref } from "./cancelNotice";

describe("aviso de cancelamento pelo WhatsApp (F4.6)", () => {
  const base = {
    clinicLabel: "da Clínica Exemplo",
    contactName: "Maria Souza",
    patientName: "João Souza",
    isContactSelf: false,
    serviceName: "Consulta",
    scheduledAt: new Date("2026-10-12T11:00:00Z"),
    timeZone: "America/Fortaleza",
  };

  it("fala com o responsável sobre o paciente, com data e hora da clínica, sem link", () => {
    const text = cancelNoticeText(base);
    expect(text).toContain("Olá, Maria!");
    expect(text).toContain("o atendimento de João (Consulta) de 12/10 às 08:00");
    expect(text).toContain("Responda esta mensagem");
    expect(text).not.toContain("http");
  });

  it("paciente que fala por si: 'o seu atendimento'", () => {
    expect(cancelNoticeText({ ...base, isContactSelf: true, contactName: "João Souza" })).toContain("cancelar o seu atendimento (Consulta)");
  });

  it("com o link de remarcação: o link, até quando vale e 'se preferir, responda' (F5.4)", () => {
    const text = cancelNoticeText({
      ...base,
      rebooking: { url: "https://app.recepclinic.com.br/agendar/abc", expiresAt: new Date("2026-10-08T17:30:00Z") },
    });
    expect(text).toContain("Pedimos desculpas pelo transtorno.\n\nPara escolher um novo horário, use o link (vale até 08/10 às 14:30):\nhttps://app.recepclinic.com.br/agendar/abc");
    expect(text.endsWith("Se preferir, responda esta mensagem.")).toBe(true);
    expect(text).not.toContain("combinarmos");
  });

  it("abre a conversa com a mensagem escrita", () => {
    expect(whatsappMessageHref("+5584999990000", "Oi, tudo bem?")).toBe("https://wa.me/5584999990000?text=Oi%2C%20tudo%20bem%3F");
  });
});
