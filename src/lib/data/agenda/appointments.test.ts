import { describe, expect, it } from "vitest";
import {
  evaluateReturnEligibility,
  findBlockingAppointment,
  returnLastDate,
  returnWarnings,
  type ReturnOrigin,
  type UpcomingAppointment,
} from "./appointments";

const upcoming = (overrides: Partial<UpcomingAppointment>): UpcomingAppointment => ({
  id: "a1",
  scheduledAt: new Date("2031-03-20T11:00:00Z"),
  agendaId: "pediatra",
  serviceId: "consulta",
  category: "consultation",
  seriesId: null,
  ...overrides,
});

describe("trava de duplicidade por agenda (decisão de 04/out)", () => {
  it("consulta futura na mesma agenda trava consulta e retorno", () => {
    const list = [upcoming({})];
    expect(findBlockingAppointment(list, { serviceId: "consulta", agendaId: "pediatra", category: "consultation" })?.id).toBe("a1");
    expect(findBlockingAppointment(list, { serviceId: "retorno", agendaId: "pediatra", category: "return_visit" })?.id).toBe("a1");
  });

  it("outra agenda não trava (pediatra e psicóloga ao mesmo tempo)", () => {
    expect(findBlockingAppointment([upcoming({})], { serviceId: "sessao", agendaId: "psicologa", category: "consultation" })).toBeNull();
  });

  it("exame futuro não trava consulta; consulta não trava exame", () => {
    expect(
      findBlockingAppointment([upcoming({ category: "exam", serviceId: "audiometria" })], {
        serviceId: "consulta",
        agendaId: "pediatra",
        category: "consultation",
      }),
    ).toBeNull();
    expect(findBlockingAppointment([upcoming({})], { serviceId: "audiometria", agendaId: "pediatra", category: "exam" })).toBeNull();
  });

  it("exame trava só o mesmo exame, em qualquer agenda", () => {
    const list = [upcoming({ category: "exam", serviceId: "audiometria", agendaId: "exames" })];
    expect(findBlockingAppointment(list, { serviceId: "audiometria", agendaId: "outra", category: "exam" })).not.toBeNull();
    expect(findBlockingAppointment(list, { serviceId: "espirometria", agendaId: "exames", category: "exam" })).toBeNull();
  });

  it("sessão de série não trava (decisão de 04/out, F3.6b)", () => {
    expect(
      findBlockingAppointment([upcoming({ seriesId: "s1" })], { serviceId: "consulta", agendaId: "pediatra", category: "consultation" }),
    ).toBeNull();
  });

  it("ao remarcar, o próprio atendimento não conta", () => {
    expect(findBlockingAppointment([upcoming({})], { serviceId: "consulta", agendaId: "pediatra", category: "consultation" }, "a1")).toBeNull();
  });
});

describe("retorno (Fase 17, mesma agenda e prazo do serviço)", () => {
  const origin = (overrides: Partial<ReturnOrigin> = {}): ReturnOrigin => ({
    id: "c1",
    date: "2031-03-03",
    lastDate: "2031-04-02",
    isHomeVisit: false,
    alreadyUsed: false,
    ...overrides,
  });

  it("último dia = data da consulta + prazo; sem prazo, sem limite", () => {
    expect(returnLastDate("2031-03-03", 30)).toBe("2031-04-02");
    expect(returnLastDate("2031-03-03", null)).toBeNull();
  });

  it("ordem das regras: sem consulta/fora do prazo, domiciliar, já usado, futuro, elegível", () => {
    expect(evaluateReturnEligibility(null, "2031-03-10", null).status).toBe("no_recent_consultation");
    expect(evaluateReturnEligibility(origin(), "2031-04-03", null).status).toBe("no_recent_consultation");
    expect(evaluateReturnEligibility(origin(), "2031-04-02", null).status).toBe("eligible");
    expect(evaluateReturnEligibility(origin({ isHomeVisit: true, alreadyUsed: true }), "2031-03-10", null).status).toBe("home_visit");
    expect(evaluateReturnEligibility(origin({ alreadyUsed: true }), "2031-03-10", null).status).toBe("return_used");
    const future = upcoming({});
    expect(evaluateReturnEligibility(origin(), "2031-03-10", future)).toEqual({
      status: "future_appointment",
      origin: origin(),
      futureScheduledAt: future.scheduledAt,
    });
    expect(evaluateReturnEligibility(origin({ lastDate: null }), "2040-01-01", null).status).toBe("eligible");
  });

  it("avisos da tela (não bloqueiam)", () => {
    expect(returnWarnings(null, "2031-03-10")).toEqual([
      "Paciente sem Consulta anterior nesta agenda: o retorno ficará sem consulta de origem.",
    ]);
    expect(returnWarnings(origin({ isHomeVisit: true, alreadyUsed: true }), "2031-04-05")).toEqual([
      "A consulta de origem (03/03/2031) foi domiciliar: consulta domiciliar não dá direito a retorno.",
      "A consulta de origem (03/03/2031) já tem um retorno vinculado.",
      "Fora do prazo: o retorno da consulta de 03/03/2031 deveria ser até 02/04/2031.",
    ]);
    expect(returnWarnings(origin(), "2031-03-10")).toEqual([]);
  });
});
