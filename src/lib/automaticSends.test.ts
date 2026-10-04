import { describe, expect, it } from "vitest";
import {
  describeSendsAlert,
  fortalezaDayBounds,
  fortalezaHour,
  isRunProblem,
  jobRunState,
  reminderWindow,
  type JobRun,
} from "./automaticSends";

const iso = (date: Date) => date.toISOString();

describe("reminderWindow", () => {
  it("o envio de hoje lembra os atendimentos de amanhã, de 0h a 24h em Fortaleza", () => {
    const { start, end } = reminderWindow(new Date("2026-10-14T12:00:00Z"));
    expect(iso(start)).toBe("2026-10-15T03:00:00.000Z");
    expect(iso(end)).toBe("2026-10-16T03:00:00.000Z");
  });

  it("às 22h de Fortaleza (já dia seguinte em UTC) ainda vale o amanhã de Fortaleza", () => {
    const { start } = reminderWindow(new Date("2026-10-15T01:00:00Z"));
    expect(iso(start)).toBe("2026-10-15T03:00:00.000Z");
  });

  it("atravessa a virada do mês", () => {
    const { start } = reminderWindow(new Date("2026-10-31T12:00:00Z"));
    expect(iso(start)).toBe("2026-11-01T03:00:00.000Z");
  });
});

describe("fortalezaDayBounds", () => {
  it("início e fim do dia de hoje em Fortaleza", () => {
    const { start, end } = fortalezaDayBounds(new Date("2026-10-14T12:00:00Z"));
    expect(iso(start)).toBe("2026-10-14T03:00:00.000Z");
    expect(iso(end)).toBe("2026-10-15T03:00:00.000Z");
  });

  it("às 22h de Fortaleza o dia ainda é o de Fortaleza, não o UTC", () => {
    const { start } = fortalezaDayBounds(new Date("2026-10-15T01:00:00Z"));
    expect(iso(start)).toBe("2026-10-14T03:00:00.000Z");
  });

  it("aceita deslocamento de dias (amanhã, ontem)", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    expect(iso(fortalezaDayBounds(now, 1).start)).toBe("2026-10-15T03:00:00.000Z");
    expect(iso(fortalezaDayBounds(now, -1).start)).toBe("2026-10-13T03:00:00.000Z");
  });
});

describe("fortalezaHour", () => {
  it.each([
    ["2026-10-14T03:00:00Z", 0],
    ["2026-10-14T12:00:00Z", 9],
    ["2026-10-15T01:30:00Z", 22],
    ["2026-10-15T02:59:00Z", 23],
  ])("%s é %ih em Fortaleza", (instant, hour) => {
    expect(fortalezaHour(new Date(instant))).toBe(hour);
  });
});

describe("jobRunState e isRunProblem", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  const run = (overrides: Partial<JobRun>): JobRun => ({
    id: 1,
    job: "appointment_reminders",
    variant: null,
    trigger: "scheduled",
    started_at: "2026-10-14T11:50:00Z",
    finished_at: null,
    status: "running",
    error_message: null,
    totals: {},
    ...overrides,
  });
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

  it("rodando há menos de 15 minutos está rodando", () => {
    expect(jobRunState(run({ started_at: minutesAgo(14) }), now)).toBe("running");
  });

  it("com exatamente 15 minutos ainda está rodando", () => {
    expect(jobRunState(run({ started_at: minutesAgo(15) }), now)).toBe("running");
  });

  it("rodando há mais de 15 minutos está travada (caiu no meio)", () => {
    expect(jobRunState(run({ started_at: minutesAgo(16) }), now)).toBe("stuck");
  });

  it("concluída mantém o status gravado", () => {
    expect(jobRunState(run({ status: "ok", started_at: minutesAgo(60) }), now)).toBe("ok");
    expect(jobRunState(run({ status: "error", started_at: minutesAgo(60) }), now)).toBe("error");
  });

  it("erro e travada são problema; ok e rodando não", () => {
    expect(isRunProblem(run({ status: "error" }), now)).toBe(true);
    expect(isRunProblem(run({ started_at: minutesAgo(16) }), now)).toBe(true);
    expect(isRunProblem(run({ status: "ok" }), now)).toBe(false);
    expect(isRunProblem(run({ started_at: minutesAgo(5) }), now)).toBe(false);
  });
});

describe("describeSendsAlert", () => {
  it("sem problema, sem linhas", () => {
    expect(describeSendsAlert({ reminderNotRun: false, reminderRunFailed: false, failedAppointments: 0 })).toEqual([]);
  });

  it("todos os problemas, uma linha cada", () => {
    expect(describeSendsAlert({ reminderNotRun: true, reminderRunFailed: true, failedAppointments: 3 })).toEqual([
      "O lembrete de hoje ainda não rodou.",
      "A execução do lembrete de hoje teve erro ou foi interrompida.",
      "3 atendimentos de hoje ou amanhã com envio com falha.",
    ]);
  });

  it("singular com um atendimento", () => {
    expect(describeSendsAlert({ reminderNotRun: false, reminderRunFailed: false, failedAppointments: 1 })).toEqual([
      "1 atendimento de hoje ou amanhã com envio com falha.",
    ]);
  });
});
