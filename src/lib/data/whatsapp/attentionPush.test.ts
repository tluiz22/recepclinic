import { describe, expect, it } from "vitest";
import type { AttentionItem } from "./attention";
import { deviceLabel, reminderMessage, shouldNotifyWaiting, shouldRemind, summaryMessage, waitingMessage } from "./attentionPush";

const at = (hhmm: string) => new Date(`2026-10-27T${hhmm}:00-03:00`);
const base: AttentionItem = {
  phone: "+5584988880001",
  contactId: "c1",
  name: "Maria Souza",
  reason: "requested",
  startedAt: at("10:00"),
  status: "waiting",
  waitingSince: at("10:00"),
  lastAgentAt: null,
  lastActivityAt: at("10:00"),
  notifiedAt: null,
  remindedAt: null,
};

describe("notificações do atendimento humano (F8.5c)", () => {
  it("aguardando: avisa uma vez por vez que passa a aguardar, só com a recepção aberta", () => {
    expect(shouldNotifyWaiting(base, true)).toBe(true);
    expect(shouldNotifyWaiting(base, false)).toBe(false);
    expect(shouldNotifyWaiting({ ...base, notifiedAt: at("10:01") }, true)).toBe(false);
    // O paciente escreveu de novo depois da resposta: aguardando desde 11h, avisado às 10h01 → avisa de novo.
    expect(shouldNotifyWaiting({ ...base, notifiedAt: at("10:01"), waitingSince: at("11:00") }, true)).toBe(true);
    expect(shouldNotifyWaiting({ ...base, status: "in_progress", waitingSince: null }, true)).toBe(false);
  });

  it("lembrete do #bot: em atendimento, 1 hora sem mensagens, uma vez por período parado", () => {
    const inProgress: AttentionItem = { ...base, status: "in_progress", waitingSince: null, lastAgentAt: at("10:05"), lastActivityAt: at("10:05") };
    expect(shouldRemind(inProgress, true, at("11:04"))).toBe(false);
    expect(shouldRemind(inProgress, true, at("11:05"))).toBe(true);
    expect(shouldRemind(inProgress, false, at("11:05"))).toBe(false);
    expect(shouldRemind({ ...inProgress, remindedAt: at("11:05") }, true, at("12:30"))).toBe(false);
    // Nova mensagem depois do lembrete: lembra de novo 1 hora depois dela.
    expect(shouldRemind({ ...inProgress, remindedAt: at("11:05"), lastActivityAt: at("11:30") }, true, at("12:30"))).toBe(true);
    expect(shouldRemind(base, true, at("12:00"))).toBe(false);
  });

  it("textos: pedido, outro motivo, lembrete e resumo", () => {
    expect(waitingMessage(base)).toEqual({
      title: "Maria Souza quer falar com a clínica",
      body: "Pediu para falar com a clínica · Toque para abrir a conversa.",
      url: "/admin/atendimento?conversa=%2B5584988880001",
      tag: "atendimento-+5584988880001",
    });
    expect(waitingMessage({ ...base, name: null, reason: "no_availability" }).title).toBe("(84) 98888-0001 aguarda atendimento humano");
    expect(reminderMessage(base).body).toBe("O bot não volta sozinho. Se já terminou, toque aqui e use \"Devolver ao bot\".");
    expect(summaryMessage([base, { ...base, waitingSince: at("07:30") }], "America/Fortaleza")).toEqual({
      title: "2 conversas aguardando atendimento humano",
      body: "Chegaram fora do horário da recepção; a mais antiga desde 27/10 às 07:30. Toque para ver.",
      url: "/admin/atendimento",
      tag: "atendimento-resumo",
    });
  });

  it("nome do aparelho", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("iPhone");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36")).toBe("Chrome no Mac");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36")).toBe("Chrome no Android");
    expect(deviceLabel(null)).toBe("Aparelho");
  });
});
