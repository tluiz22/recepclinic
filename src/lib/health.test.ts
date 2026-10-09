import { describe, expect, it } from "vitest";
import { CRON_JOBS, checkCronJobs } from "./health";

const NOW = new Date("2026-10-09T15:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

describe("rotinas em dia (F9.3)", () => {
  it("as 5 rotinas do agendador", () => {
    expect(Object.keys(CRON_JOBS).sort()).toEqual(["conversas-paradas", "lembretes", "lista-de-espera", "resumo-do-dia", "series"]);
  });

  it("todas em dia", () => {
    const beats = [
      { job: "conversas-paradas", lastFinishedAt: ago(1) },
      { job: "resumo-do-dia", lastFinishedAt: ago(5) },
      { job: "lista-de-espera", lastFinishedAt: ago(20) },
      { job: "lembretes", lastFinishedAt: ago(61) },
      { job: "series", lastFinishedAt: ago(23 * 60) },
    ];
    expect(checkCronJobs(beats, NOW).every((check) => check.ok)).toBe(true);
  });

  it("atrasada e nunca rodou", () => {
    const checks = checkCronJobs([{ job: "conversas-paradas", lastFinishedAt: ago(11) }], NOW);
    expect(checks.find((c) => c.job === "conversas-paradas")).toMatchObject({ ok: false, minutesLate: 1 });
    expect(checks.find((c) => c.job === "series")).toMatchObject({ ok: false, lastFinishedAt: null, minutesLate: null });
  });

  it("rotina desconhecida não entra", () => {
    expect(checkCronJobs([{ job: "outra", lastFinishedAt: ago(1) }], NOW).map((c) => c.job)).not.toContain("outra");
  });
});
