import { describe, expect, it } from "vitest";
import { biggestLoss, formatVisitCookie, isBot, parseVisitCookie, planVisit, visitFunnel, type StepCount } from "./portalVisit";

const CLINIC = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const VISIT = "33333333-3333-4333-8333-333333333333";
const newId = () => "44444444-4444-4444-8444-444444444444";

describe("cookie da visita", () => {
  it("vai e volta", () => {
    const c = { id: VISIT, clinic: CLINIC, furthest: 4, entry: "whatsapp" as const };
    expect(parseVisitCookie(formatVisitCookie(c))).toEqual(c);
  });
  it("recusa cookie torto", () => {
    expect(parseVisitCookie(null)).toBeNull();
    expect(parseVisitCookie("x.y.3.clinic")).toBeNull();
    expect(parseVisitCookie(`${VISIT}.${CLINIC}.9.clinic`)).toBeNull();
    expect(parseVisitCookie(`${VISIT}.${CLINIC}.0.clinic`)).toBeNull();
    expect(parseVisitCookie(`${VISIT}.${CLINIC}.3`)).toBeNull();
    expect(parseVisitCookie(`${VISIT}.${CLINIC}.3.site`)).toBeNull();
    expect(parseVisitCookie(`${VISIT}.${CLINIC}.3.clinic.extra`)).toBeNull();
  });
});

describe("planVisit", () => {
  const c = { id: VISIT, clinic: CLINIC, furthest: 4, entry: "whatsapp" as const };
  it("sem cookie abre visita nova", () => {
    expect(planVisit(null, CLINIC, 1, "clinic", newId)).toEqual({ write: true, cookie: { id: newId(), clinic: CLINIC, furthest: 1, entry: "clinic" } });
  });
  it("mesmo passo ou atrás só renova o cookie", () => {
    expect(planVisit(c, CLINIC, 4, "clinic", newId)).toEqual({ write: false, cookie: c });
    expect(planVisit(c, CLINIC, 2, "clinic", newId)).toEqual({ write: false, cookie: c });
  });
  it("avança mantendo a visita e a entrada da primeira tela", () => {
    expect(planVisit(c, CLINIC, 6, "clinic", newId)).toEqual({ write: true, cookie: { ...c, furthest: 6 } });
  });
  it("outra clínica abre outra visita", () => {
    const other = { ...c, clinic: OTHER };
    expect(planVisit(other, CLINIC, 1, "professional", newId)).toEqual({ write: true, cookie: { id: newId(), clinic: CLINIC, furthest: 1, entry: "professional" } });
  });
  it("sem cookie no meio do caminho não abre visita", () => {
    expect(planVisit(null, CLINIC, 4, "clinic", newId)?.write).toBe(true);
    expect(planVisit(null, CLINIC, 5, "clinic", newId)).toBeNull();
    expect(planVisit(null, CLINIC, 8, "clinic", newId)).toBeNull();
  });
});

describe("isBot", () => {
  it("separa robôs de navegadores", () => {
    expect(isBot(undefined)).toBe(true);
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isBot("WhatsApp/2.23.20.0 A")).toBe(true);
    expect(isBot("TelegramBot (like TwitterBot)")).toBe(true);
    expect(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isBot("Mozilla/5.0 (Linux; Android 13; CUBOT P80) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36")).toBe(false);
    expect(isBot("Mozilla/5.0 (Linux; Android 13; SM-A135M wv) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 WhatsApp/2.24")).toBe(false);
  });
});

describe("visitFunnel", () => {
  const rows: StepCount[] = [
    { entry: "clinic", furthest: 1, visits: 10 },
    { entry: "clinic", furthest: 4, visits: 30 },
    { entry: "clinic", furthest: 8, visits: 20 },
    { entry: "whatsapp", furthest: 6, visits: 5 },
    { entry: "whatsapp", furthest: 8, visits: 15 },
  ];
  it("conta quem chegou ao menos até cada passo", () => {
    const f = visitFunnel(rows);
    expect(f.map((r) => r.reached)).toEqual([80, 70, 70, 70, 40, 40, 35, 35]);
    expect(f[0].share).toBe(1);
    expect(f[3].stoppedHere).toBe(30);
    expect(f[7].stoppedHere).toBe(0);
  });
  it("filtra pela entrada", () => {
    const f = visitFunnel(rows, "whatsapp");
    expect(f[0].reached).toBe(20);
    expect(f[5].stoppedHere).toBe(5);
  });
  it("maior perda", () => {
    expect(biggestLoss(visitFunnel(rows))?.id).toBe("times");
    expect(biggestLoss(visitFunnel([]))).toBeNull();
    expect(visitFunnel([])[0].share).toBeNull();
  });
});
