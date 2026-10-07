import { describe, expect, it } from "vitest";
import { preparationSender, reminderSender, type ClinicSender } from "./send";
import {
  appointmentParams,
  appointmentPlace,
  cleanParam,
  DEFAULT_TEMPLATES,
  defaultTemplate,
  fillTemplate,
  paramCount,
  templateCreationPayload,
  templateStatusFromMeta,
} from "./templates";
import { templateStatusChanges } from "./webhook";

const appointment = {
  contactName: "Maria  da Silva",
  patientName: "João Silva",
  serviceName: "Consulta",
  professionalName: "Dra. Ana Souza",
  scheduledAt: new Date("2026-10-12T11:00:00Z"),
  timeZone: "America/Fortaleza",
  locationName: "Consultório",
  isHomeVisit: false,
  address: "Rua das Flores, 100\nCentro",
};

describe("templates padrão (F6.2)", () => {
  it("cada template tem um exemplo por variável e nomes aceitos pela Meta", () => {
    for (const template of DEFAULT_TEMPLATES) {
      expect(template.examples).toHaveLength(paramCount(template.body));
      expect(template.name).toMatch(/^[a-z0-9_]+$/);
      // A Meta recusa corpo que começa ou termina com variável.
      expect(template.body.trim()).not.toMatch(/^\{\{|\}\}$/);
    }
  });

  it("variáveis do aviso: primeiro nome, clínica, serviço com o profissional, data no fuso e local com endereço", () => {
    const params = appointmentParams("da Clínica Sorriso", appointment);
    expect(params).toEqual([
      "Maria",
      "da Clínica Sorriso",
      "Consulta com Dra. Ana Souza",
      "João Silva",
      "segunda, 12/10 às 08:00",
      "Consultório — Rua das Flores, 100 Centro",
    ]);
    expect(fillTemplate(defaultTemplate("confirmation")!.body, params)).toBe(
      "Olá, Maria! Aqui é da Clínica Sorriso.\nSeu atendimento está marcado:\n\n📋 Consulta com Dra. Ana Souza\n👤 Paciente: João Silva\n" +
        "📅 segunda, 12/10 às 08:00\n📍 Consultório — Rua das Flores, 100 Centro\n\nQualquer dúvida, é só responder esta mensagem.",
    );
  });

  it("sem profissional, só o serviço; domiciliar sem endereço diz só o tipo", () => {
    expect(appointmentParams("da X", { ...appointment, professionalName: null })[2]).toBe("Consulta");
    expect(appointmentPlace({ locationName: "Domiciliar", isHomeVisit: true, address: null })).toBe("Atendimento domiciliar");
    expect(appointmentPlace({ locationName: "Domiciliar", isHomeVisit: true, address: "Rua B, 2" })).toBe("Atendimento domiciliar — Rua B, 2");
  });

  it("variável sem quebra de linha nem espaços seguidos; vazia vira traço", () => {
    expect(cleanParam("a\n\tb     c ")).toBe("a b c");
    expect(cleanParam("  ")).toBe("-");
  });

  it("pedido de criação: Utilidade, português, exemplos e os botões do lembrete", () => {
    expect(templateCreationPayload(defaultTemplate("reminder")!)).toEqual({
      name: "rc_lembrete_v1",
      language: "pt_BR",
      category: "UTILITY",
      components: [
        { type: "BODY", text: defaultTemplate("reminder")!.body, example: { body_text: [defaultTemplate("reminder")!.examples] } },
        {
          type: "BUTTONS",
          buttons: [
            { type: "QUICK_REPLY", text: "Confirmar presença" },
            { type: "QUICK_REPLY", text: "Remarcar" },
            { type: "QUICK_REPLY", text: "Cancelar" },
          ],
        },
      ],
    });
    expect(templateCreationPayload(defaultTemplate("confirmation")!).components).toHaveLength(1);
  });

  it("situação da Meta na nossa", () => {
    expect(["APPROVED", "REJECTED", "PENDING", "IN_APPEAL", "PAUSED", "DISABLED", undefined].map(templateStatusFromMeta)).toEqual([
      "approved",
      "rejected",
      "pending",
      "pending",
      "disabled",
      "disabled",
      "pending",
    ]);
  });
});

describe("quem envia (F6.2)", () => {
  const fakeSender = () => {
    const calls: unknown[][] = [];
    const sender: ClinicSender = {
      clinicId: "c1",
      clinicLabel: "da Clínica Sorriso",
      baseUrl: "https://app.exemplo.test",
      template: async (...args) => (calls.push(["template", ...args]), { sent: true, messageId: "w1" }),
      text: async (...args) => (calls.push(["text", ...args]), { sent: true, messageId: "w2" }),
      list: async () => ({ sent: true, messageId: "w3" }),
      buttons: async () => ({ sent: true, messageId: "w4" }),
    };
    return { sender, calls };
  };

  it("lembrete: template com as variáveis do atendimento e os três payloads", async () => {
    const { sender, calls } = fakeSender();
    await reminderSender(sender)({
      ...appointment,
      clinicId: "c1",
      appointmentId: "a1",
      phone: "+5584999990000",
      serviceCategory: "consultation",
      template: { name: "rc_lembrete_v1", language: "pt_BR" },
      buttonPayloads: ["reminder:confirm:a1", "reminder:reschedule:a1", "reminder:cancel:a1"],
    });
    expect(calls).toEqual([
      [
        "template",
        "+5584999990000",
        "reminder",
        { name: "rc_lembrete_v1", language: "pt_BR" },
        appointmentParams("da Clínica Sorriso", appointment),
        ["reminder:confirm:a1", "reminder:reschedule:a1", "reminder:cancel:a1"],
      ],
    ]);
  });

  it("preparo: texto com as orientações (janela aberta) ou template com o link (fechada)", async () => {
    const { sender, calls } = fakeSender();
    const base = {
      clinicId: "c1",
      appointmentId: "a1",
      phone: "+5584999990000",
      contactName: "Maria Silva",
      patientName: "João",
      examName: "Espirometria",
      instructions: "Jejum de 4 horas.",
      pagePath: "/preparo/s1",
    };
    await preparationSender(sender)({ ...base, mode: "text", template: null });
    await preparationSender(sender)({ ...base, mode: "template", template: { name: "rc_preparo_exame_v1", language: "pt_BR" } });
    expect(calls[0][2]).toContain("Preparo do exame *Espirometria*:\n\nJejum de 4 horas.");
    expect(calls[0][2]).toContain("https://app.exemplo.test/preparo/s1");
    expect(calls[1]).toEqual([
      "template",
      "+5584999990000",
      "exam_preparation",
      { name: "rc_preparo_exame_v1", language: "pt_BR" },
      ["Maria", "da Clínica Sorriso", "Espirometria", "https://app.exemplo.test/preparo/s1"],
    ]);
  });
});

describe("situação dos templates no webhook (F6.2)", () => {
  it("lê a conta (WABA) e o evento; ignora outros campos e eventos incompletos", () => {
    const payload = {
      entry: [
        {
          id: "waba-1",
          changes: [
            { field: "message_template_status_update", value: { event: "REJECTED", message_template_id: 7, message_template_name: "rc_lembrete_v1", message_template_language: "pt_BR", reason: "INVALID_FORMAT" } },
            { field: "message_template_status_update", value: { event: "APPROVED" } },
            { field: "messages", value: { messages: [] } },
          ],
        },
      ],
    };
    expect(templateStatusChanges(payload)).toEqual([
      { wabaId: "waba-1", name: "rc_lembrete_v1", language: "pt_BR", event: "REJECTED", reason: "INVALID_FORMAT", metaTemplateId: "7" },
    ]);
    expect(templateStatusChanges(null)).toEqual([]);
  });
});
