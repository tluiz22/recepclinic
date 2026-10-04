import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeAvailableSlots, type AvailabilityWindow, type BusyInterval } from "./slots";

// Quarta-feira, 14/10/2026. "Agora" fica na véspera, salvo nos testes de horário passado.
const DATE = "2026-10-14";
const local = (time: string) => `${DATE}T${time}:00-03:00`;

const morning: AvailabilityWindow = { clinic_location_id: "loc-a", start_time: "08:00:00", end_time: "12:00:00" };

function slots({
  windows = [morning],
  busy = [] as BusyInterval[],
  appointmentType = "first_visit" as const,
  firstVisitDurationMinutes = 30,
  returnVisitDurationMinutes = 20,
  examDurationMinutes = undefined as number | undefined,
  bufferMinutes = 0,
}: Partial<{
  windows: AvailabilityWindow[];
  busy: BusyInterval[];
  appointmentType: "first_visit" | "return_visit" | "exam";
  firstVisitDurationMinutes: number;
  returnVisitDurationMinutes: number;
  examDurationMinutes: number;
  bufferMinutes: number;
}> = {}) {
  return computeAvailableSlots({
    date: DATE,
    windows,
    busy,
    appointmentType,
    firstVisitDurationMinutes,
    returnVisitDurationMinutes,
    examDurationMinutes,
    bufferMinutes,
  });
}

const labels = (result: ReturnType<typeof slots>) => result.map((slot) => slot.label);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T12:00:00-03:00"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("computeAvailableSlots — consulta (first_visit)", () => {
  it("divide a janela livre em horários do tamanho da consulta", () => {
    expect(labels(slots())).toEqual(["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
  });

  it("devolve o instante em Fortaleza (-03:00) e o consultório da janela", () => {
    const [first] = slots();
    expect(first.start.toISOString()).toBe("2026-10-14T11:00:00.000Z");
    expect(first.clinicLocationId).toBe("loc-a");
  });

  it("não oferece horário que não cabe inteiro na janela", () => {
    expect(labels(slots({ firstVisitDurationMinutes: 45 }))).toEqual(["08:00", "08:45", "09:30", "10:15", "11:00"]);
  });

  it("recomeça a contagem logo depois de um horário ocupado (não deixa buraco)", () => {
    const busy = [{ start: local("09:00"), end: local("09:45") }];
    expect(labels(slots({ busy }))).toEqual(["08:00", "08:30", "09:45", "10:15", "10:45", "11:15"]);
  });

  it("aceita ocupado em UTC e converte para o horário local", () => {
    const busy = [{ start: "2026-10-14T12:00:00Z", end: "2026-10-14T12:45:00Z" }];
    expect(labels(slots({ busy }))).toEqual(["08:00", "08:30", "09:45", "10:15", "10:45", "11:15"]);
  });

  it("aplica o intervalo de folga antes e depois de cada ocupado", () => {
    const busy = [{ start: local("09:00"), end: local("09:30") }];
    expect(labels(slots({ busy, bufferMinutes: 15 }))).toEqual(["08:00", "09:45", "10:15", "10:45", "11:15"]);
  });

  it("junta ocupados que se sobrepõem ou se encostam", () => {
    const busy = [
      { start: local("10:00"), end: local("10:30") },
      { start: local("08:00"), end: local("09:00") },
      { start: local("08:30"), end: local("10:00") },
    ];
    expect(labels(slots({ busy }))).toEqual(["10:30", "11:00", "11:30"]);
  });

  it("ignora ocupado fora da janela", () => {
    const busy = [{ start: local("13:00"), end: local("14:00") }];
    expect(slots({ busy })).toHaveLength(8);
  });

  it("dia todo ocupado não tem horário", () => {
    const busy = [{ start: local("07:00"), end: local("13:00") }];
    expect(slots({ busy })).toEqual([]);
  });

  it("várias janelas, cada horário com o consultório da sua janela", () => {
    const windows: AvailabilityWindow[] = [
      { clinic_location_id: "loc-a", start_time: "08:00:00", end_time: "10:00:00" },
      { clinic_location_id: "loc-b", start_time: "14:00:00", end_time: "16:00:00" },
    ];
    const result = slots({ windows, firstVisitDurationMinutes: 60 });
    expect(result.map((slot) => [slot.label, slot.clinicLocationId])).toEqual([
      ["08:00", "loc-a"],
      ["09:00", "loc-a"],
      ["14:00", "loc-b"],
      ["15:00", "loc-b"],
    ]);
  });

  it("sem janelas não há horários", () => {
    expect(slots({ windows: [] })).toEqual([]);
  });
});

describe("computeAvailableSlots — horários que já passaram", () => {
  it("no próprio dia, só oferece horários depois de agora", () => {
    vi.setSystemTime(new Date(local("09:10")));
    expect(labels(slots())).toEqual(["09:30", "10:00", "10:30", "11:00", "11:30"]);
  });

  it("um horário que começa exatamente agora já não é oferecido", () => {
    vi.setSystemTime(new Date(local("09:00")));
    expect(labels(slots())[0]).toBe("09:30");
  });

  it("dia que já passou não tem horários", () => {
    vi.setSystemTime(new Date("2026-10-15T08:00:00-03:00"));
    expect(slots()).toEqual([]);
  });
});

describe("computeAvailableSlots — exame", () => {
  it("usa a duração do exame", () => {
    expect(labels(slots({ appointmentType: "exam", examDurationMinutes: 90 }))).toEqual(["08:00", "09:30"]);
  });

  it("sem duração do exame, usa a da consulta", () => {
    expect(slots({ appointmentType: "exam" })).toHaveLength(8);
  });
});

describe("computeAvailableSlots — retorno (tapar buracos)", () => {
  const returnSlots = (busy: BusyInterval[]) =>
    labels(slots({ appointmentType: "return_visit", busy, firstVisitDurationMinutes: 60, returnVisitDurationMinutes: 20 }));

  it("no máximo 4 horários, os primeiros do dia quando não há buracos", () => {
    expect(returnSlots([])).toEqual(["08:00", "08:20", "08:40", "09:00"]);
  });

  it("prioriza buracos menores que uma consulta e mostra em ordem de horário", () => {
    const busy = [{ start: local("10:00"), end: local("11:30") }];
    // Buraco 11:30–12:00 (30 min < 60) entra antes dos horários do intervalo grande da manhã.
    expect(returnSlots(busy)).toEqual(["08:00", "08:20", "08:40", "11:30"]);
  });

  it("só buracos pequenos: oferece o que couber neles", () => {
    const busy = [
      { start: local("08:30"), end: local("09:00") },
      { start: local("09:40"), end: local("12:00") },
    ];
    expect(returnSlots(busy)).toEqual(["08:00", "09:00", "09:20"]);
  });
});
