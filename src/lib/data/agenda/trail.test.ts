import { describe, expect, it } from "vitest";
import { reminderGroup } from "../daily";
import { actorText, describeTrail, type ActorLabel } from "./trail";

const at = new Date("2026-10-12T11:00:00Z");
const actors = new Map<string, ActorLabel>([
  ["maria", { name: "Maria", roles: ["reception"], isSupport: false }],
  ["ana", { name: "Ana", roles: null, isSupport: true }],
]);
const event = (e: string, extra: Partial<{ channel: string; actorId: string | null; details: Record<string, unknown> }> = {}) =>
  describeTrail({ kind: "event", at, event: e as never, channel: (extra.channel ?? "admin") as never, actorId: extra.actorId ?? null, details: extra.details ?? {} }, actors, "America/Fortaleza");

describe("trilha do atendimento (F4.8)", () => {
  it("quem fez: nome e papel; Suporte; quem saiu da equipe pelo nome/e-mail", () => {
    expect(actorText(actors.get("maria"))).toBe("Maria (Recepção)");
    expect(actorText(actors.get("ana"))).toBe("Suporte RecepClinic (Ana)");
    expect(actorText({ name: "ex@clinica.com", roles: null, isSupport: false })).toBe("ex@clinica.com");
    expect(actorText(undefined)).toBeNull();
  });

  it("frases de cada evento, por onde e por quem", () => {
    expect(event("created", { actorId: "maria" }).text).toBe("Marcado pelo painel por Maria (Recepção)");
    expect(event("created", { channel: "whatsapp_bot" }).text).toBe("Marcado pelo WhatsApp");
    expect(event("rescheduled", { actorId: "maria", details: { from: "2026-10-12T11:00:00Z", to: "2026-10-13T12:30:00Z" } }).text).toBe(
      "Remarcado de 12/10 às 08:00 para 13/10 às 09:30 pelo painel por Maria (Recepção)",
    );
    expect(event("canceled", { channel: "mass_cancel", actorId: "ana" })).toMatchObject({
      text: "Cancelado pela clínica (cancelamento em massa) por Suporte RecepClinic (Ana)",
      tone: "danger",
    });
    expect(event("attendance_recorded", { details: { status: "no_show" } })).toMatchObject({ text: "Registrado: faltou", tone: "danger" });
    expect(event("attendance_corrected", { details: { from: "no_show", to: "completed" } }).text).toBe('Corrigido de "faltou" para "compareceu"');
    expect(event("reminder_resent", { details: { first: true } }).text).toBe("Lembrete enviado à mão");
    expect(event("rebooking_dismissed", { actorId: "maria" }).text).toBe('Marcado como "Desistiu" (sem remarcação) por Maria (Recepção)');
  });

  it("mensagens do WhatsApp com a situação da entrega", () => {
    const message = (status: string | null) => describeTrail({ kind: "message", at, messageType: "appointment_reminder", status }, actors, "America/Fortaleza");
    expect(message("read")).toMatchObject({ text: "WhatsApp: Lembrete lido", tone: "success" });
    expect(message("failed")).toMatchObject({ text: "WhatsApp: Lembrete não entregue", tone: "danger" });
  });

  it("cada mensagem pelo nome, nunca o nome interno, com a situação concordando (cliente, 18/out)", () => {
    const text = (messageType: string, status: string | null) => describeTrail({ kind: "message", at, messageType, status }, actors, "America/Fortaleza").text;
    expect(text("consultation_guidance", "delivered")).toBe("WhatsApp: Orientações gerais da consulta entregues");
    expect(text("consultation_guidance", "read")).toBe("WhatsApp: Orientações gerais da consulta lidas");
    expect(text("appointment_reschedule", "delivered")).toBe("WhatsApp: Aviso de remarcação entregue");
    expect(text("appointment_confirmation", "sent")).toBe("WhatsApp: Confirmação do atendimento enviada");
    expect(text("appointment_mass_cancellation", "skipped_no_template")).toBe(
      "WhatsApp: Aviso de cancelamento pela clínica (com o link para remarcar) não enviado (template não aprovado)",
    );
    expect(text("nfse_document", "read")).toBe("WhatsApp: Nota fiscal lida");
    expect(text("tipo_novo", null)).toBe("WhatsApp: Mensagem na fila");
    expect(event("message_not_sent", { details: { kind: "reminder", reason: "template_disabled" } }).text).toBe("WhatsApp: Lembrete não enviado (template não aprovado)");
    expect(event("message_not_sent", { details: { kind: "reminder", reason: "not_connected" } }).text).toBe(
      "WhatsApp: Lembrete não enviado (WhatsApp da clínica não conectado)",
    );
  });
});

it("grupo do lembrete: botão tocado; sem toque, entregue ou não", () => {
  expect(reminderGroup("confirmed", "read")).toBe("confirm");
  // O valor do botão não é o que o banco guarda (15/out/2026).
  expect(reminderGroup("confirm", "read")).toBe("no_answer");
  expect(reminderGroup("cancel", null)).toBe("cancel");
  expect(reminderGroup(null, "delivered")).toBe("no_answer");
  expect(reminderGroup(null, "failed")).toBe("not_delivered");
});
