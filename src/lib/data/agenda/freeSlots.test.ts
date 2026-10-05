import { describe, expect, it } from "vitest";
import { computeFreeSlots, type BusyInterval, type SlotStrategy, type SlotWindow } from "./freeSlots";

// Mesmos casos de computeAvailableSlots (F1), no cálculo novo com fuso.
// Quarta-feira, 14/10/2026; "agora" na véspera, salvo nos testes de horário passado.
const DATE = "2026-10-14";
const FORTALEZA = "America/Fortaleza";
const local = (time: string, date = DATE) => new Date(`${date}T${time}:00-03:00`);
const busyAt = (start: string, end: string): BusyInterval => ({ start: local(start), end: local(end) });
const morning: SlotWindow = { locationId: "loc-a", startTime: "08:00", endTime: "12:00" };

function slots({
  windows = [morning],
  busy = [] as BusyInterval[],
  durationMinutes = 30,
  bufferMinutes = 0,
  strategy = { kind: "fill" } as SlotStrategy,
  now = local("12:00", "2026-10-13"),
  timeZone = FORTALEZA,
  date = DATE,
} = {}) {
  return computeFreeSlots({ date, timeZone, windows, busy, durationMinutes, bufferMinutes, strategy, now });
}
const times = (result: ReturnType<typeof slots>) => result.map((slot) => slot.time);

describe("horários livres (preencher)", () => {
  it("divide a janela livre na duração do serviço", () => {
    expect(times(slots({ durationMinutes: 60 }))).toEqual(["08:00", "09:00", "10:00", "11:00"]);
  });

  it("devolve o instante no fuso da clínica e o local da janela", () => {
    const [first] = slots();
    expect(first.start.toISOString()).toBe("2026-10-14T11:00:00.000Z");
    expect(first.locationId).toBe("loc-a");
  });

  it("não oferece horário que não cabe inteiro na janela", () => {
    expect(times(slots({ windows: [{ ...morning, endTime: "09:50" }], durationMinutes: 30 }))).toEqual(["08:00", "08:30", "09:00"]);
  });

  it("recomeça logo depois do ocupado (sem deixar buraco)", () => {
    expect(times(slots({ busy: [busyAt("08:00", "08:20")] }))).toEqual(["08:20", "08:50", "09:20", "09:50", "10:20", "10:50", "11:20"]);
  });

  it("aplica o intervalo da agenda antes e depois de cada ocupado", () => {
    expect(times(slots({ busy: [busyAt("09:00", "09:30")], bufferMinutes: 10 }))).toEqual([
      "08:00",
      "09:40",
      "10:10",
      "10:40",
      "11:10",
    ]);
  });

  it("junta ocupados que se sobrepõem ou se encostam; ignora o que está fora da janela", () => {
    expect(
      times(slots({ busy: [busyAt("08:00", "09:00"), busyAt("08:30", "10:00"), busyAt("10:00", "11:00"), busyAt("14:00", "15:00")] })),
    ).toEqual(["11:00", "11:30"]);
  });

  it("dia todo ocupado, ou sem janelas: nenhum horário", () => {
    expect(slots({ busy: [busyAt("07:00", "13:00")] })).toEqual([]);
    expect(slots({ windows: [] })).toEqual([]);
  });

  it("ocupado que começou na véspera e entra no dia conta", () => {
    expect(times(slots({ busy: [{ start: local("23:00", "2026-10-13"), end: local("09:00") }] }))[0]).toBe("09:00");
  });

  it("várias janelas, cada horário com o local da sua janela", () => {
    const result = slots({
      windows: [
        { locationId: "loc-b", startTime: "14:00", endTime: "15:00" },
        { locationId: "loc-a", startTime: "08:00", endTime: "09:00" },
      ],
    });
    expect(result.map((slot) => [slot.time, slot.locationId])).toEqual([
      ["08:00", "loc-a"],
      ["08:30", "loc-a"],
      ["14:00", "loc-b"],
      ["14:30", "loc-b"],
    ]);
  });
});

describe("horários que já passaram", () => {
  it("no próprio dia, só depois de agora; começar exatamente agora já não vale", () => {
    expect(times(slots({ now: local("10:00") }))).toEqual(["10:30", "11:00", "11:30"]);
    expect(times(slots({ now: local("09:59") }))).toEqual(["10:00", "10:30", "11:00", "11:30"]);
  });

  it("dia que já passou não tem horários", () => {
    expect(slots({ now: local("08:00", "2026-10-15") })).toEqual([]);
  });
});

describe("retorno (tapar buracos, Fase 17)", () => {
  const returnGaps = { kind: "return_gaps", consultationMinutes: 30 } as const;

  it("no máximo 4, os primeiros do dia quando não há buracos", () => {
    expect(times(slots({ durationMinutes: 20, strategy: returnGaps }))).toEqual(["08:00", "08:20", "08:40", "09:00"]);
  });

  it("prioriza buracos menores que uma consulta, em ordem de horário", () => {
    const busy = [busyAt("08:00", "09:00"), busyAt("09:20", "10:00"), busyAt("10:20", "12:00")];
    expect(times(slots({ durationMinutes: 20, strategy: returnGaps, busy }))).toEqual(["09:00", "10:00"]);
  });

  it("buraco pequeno primeiro, completando com os demais até 4", () => {
    const busy = [busyAt("08:00", "08:40"), busyAt("09:00", "09:30")];
    expect(times(slots({ durationMinutes: 20, strategy: returnGaps, busy }))).toEqual(["08:40", "09:30", "09:50", "10:10"]);
  });

  it("agenda sem consulta: só limita a 4", () => {
    expect(times(slots({ durationMinutes: 20, strategy: { kind: "return_gaps", consultationMinutes: null } }))).toHaveLength(4);
  });
});

describe("fuso da clínica", () => {
  it("o mesmo 08:00 é outro instante em Manaus", () => {
    const [first] = slots({ timeZone: "America/Manaus", now: new Date("2026-10-13T00:00:00Z") });
    expect(first.start.toISOString()).toBe("2026-10-14T12:00:00.000Z");
    expect(first.time).toBe("08:00");
  });

  it("ocupado lido no fuso da clínica", () => {
    // 12:00 UTC = 09:00 em Fortaleza.
    const busy = [{ start: new Date("2026-10-14T12:00:00Z"), end: new Date("2026-10-14T13:00:00Z") }];
    expect(times(slots({ busy, durationMinutes: 60 }))).toEqual(["08:00", "10:00", "11:00"]);
  });

  it("hora que não existe no horário de verão não é oferecida (São Paulo, 04/11/2018)", () => {
    const result = computeFreeSlots({
      date: "2018-11-04",
      timeZone: "America/Sao_Paulo",
      windows: [{ locationId: "loc-a", startTime: "00:00", endTime: "02:00" }],
      busy: [],
      durationMinutes: 30,
      bufferMinutes: 0,
      strategy: { kind: "fill" },
      now: new Date("2018-11-01T00:00:00Z"),
    });
    expect(result.map((slot) => slot.time)).toEqual(["01:00", "01:30"]);
  });
});
