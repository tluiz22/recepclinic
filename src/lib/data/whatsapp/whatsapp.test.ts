import { describe, expect, it } from "vitest";
import { handoffDeadline, isPastIdleTimeout } from "./conversations";
import { deliveryRank, isReturnToBotKeyword, messageBody, reachedPhone, toE164 } from "./meta";

const TZ = "America/Fortaleza";
const at = (iso: string) => new Date(`${iso}-03:00`);

describe("telefone da Meta", () => {
  it("põe o + e acrescenta o 9 do celular brasileiro quando a Meta o omite", () => {
    expect(toE164("5584981880777")).toBe("+5584981880777");
    expect(toE164("556198645490")).toBe("+5561998645490");
    expect(toE164("14155550123")).toBe("+14155550123");
  });

  it("recusa o que não é número", () => {
    expect(toE164(undefined)).toBeNull();
    expect(toE164("+5584981880777")).toBeNull();
    expect(toE164("123")).toBeNull();
  });
});

describe("texto da mensagem", () => {
  it("usa o texto, a opção tocada ou o botão; senão, o tipo", () => {
    expect(messageBody({ type: "text", text: { body: "Oi" } })).toBe("Oi");
    expect(messageBody({ type: "interactive", interactive: { list_reply: { id: "menu_1", title: "Consultas" } } })).toBe("Consultas");
    expect(messageBody({ type: "interactive", interactive: { button_reply: { id: "sim" } } })).toBe("sim");
    expect(messageBody({ type: "button", button: { text: "Confirmar presença", payload: "x" } })).toBe("Confirmar presença");
    expect(messageBody({ type: "image" })).toBe("[image]");
    expect(messageBody({})).toBeNull();
  });

  it("#bot em qualquer parte, sem diferenciar maiúsculas", () => {
    expect(isReturnToBotKeyword("pode seguir #BOT")).toBe(true);
    expect(isReturnToBotKeyword("bot")).toBe(false);
    expect(isReturnToBotKeyword(null)).toBe(false);
  });
});

describe("situação da entrega", () => {
  it("ordena enviada < entregue < lida, e falha no topo", () => {
    expect(deliveryRank(null)).toBe(0);
    expect(deliveryRank("skipped_no_template")).toBe(0);
    expect(deliveryRank("sent")).toBeLessThan(deliveryRank("delivered"));
    expect(deliveryRank("delivered")).toBeLessThan(deliveryRank("read"));
    expect(deliveryRank("failed")).toBe(deliveryRank("read"));
  });

  it("chega ao celular só na primeira passagem para entregue ou lida", () => {
    expect(reachedPhone("sent", "delivered")).toBe(true);
    expect(reachedPhone("sent", "read")).toBe(true);
    expect(reachedPhone(null, "delivered")).toBe(true);
    expect(reachedPhone("delivered", "read")).toBe(false);
    expect(reachedPhone("sent", "failed")).toBe(false);
    expect(reachedPhone(null, "sent")).toBe(false);
  });
});

describe("prazo da pausa da recepção", () => {
  const none = new Set<string>();

  it("24h depois, em dia útil", () => {
    // Terça 10h → quarta 10h.
    expect(handoffDeadline(at("2026-10-06T10:00:00"), TZ, none)).toEqual(at("2026-10-07T10:00:00"));
  });

  it("caindo no sábado ou no domingo, vai para segunda no mesmo horário", () => {
    // Sexta 15h30 → sábado → segunda 15h30 (com os segundos).
    expect(handoffDeadline(at("2026-10-16T15:30:20"), TZ, none)).toEqual(at("2026-10-19T15:30:20"));
    // Sábado 9h → domingo → segunda 9h.
    expect(handoffDeadline(at("2026-10-17T09:00:00"), TZ, none)).toEqual(at("2026-10-19T09:00:00"));
  });

  it("pula feriado nacional, inclusive emendado com o fim de semana", () => {
    // Sexta 9/10 → sábado, domingo e segunda 12/10 (Nossa Senhora Aparecida) → terça 13/10.
    expect(handoffDeadline(at("2026-10-09T15:30:00"), TZ, none)).toEqual(at("2026-10-13T15:30:00"));
    // Quinta 19/11 → sexta 20/11 (Consciência Negra), sábado, domingo → segunda 23/11.
    expect(handoffDeadline(at("2026-11-19T08:00:00"), TZ, none)).toEqual(at("2026-11-23T08:00:00"));
  });

  it("pula o feriado próprio da clínica", () => {
    expect(handoffDeadline(at("2026-10-06T10:00:00"), TZ, new Set(["2026-10-07"]))).toEqual(at("2026-10-08T10:00:00"));
  });

  it("usa o calendário da clínica, não o do servidor", () => {
    // Quinta 22h → sexta 22h em Fortaleza (já sábado em UTC): dia útil, não pula.
    expect(handoffDeadline(at("2026-10-08T22:00:00"), TZ, none)).toEqual(at("2026-10-09T22:00:00"));
  });

  it("conversa parada 15 minutos recomeça", () => {
    const last = at("2026-10-06T10:00:00");
    expect(isPastIdleTimeout(last, at("2026-10-06T10:14:59"))).toBe(false);
    expect(isPastIdleTimeout(last, at("2026-10-06T10:15:00"))).toBe(true);
  });
});
