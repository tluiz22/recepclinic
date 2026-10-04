import { describe, expect, it } from "vitest";
import {
  SUMMARY_FALLBACK_TIME,
  SUMMARY_LEAD_MINUTES,
  computeSummarySendAt,
  describeSummarySchedule,
  weekdayOf,
} from "./dailySummarySchedule";

const local = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);
const localTime = (date: Date) => new Date(date.getTime() - 3 * 3_600_000).toISOString().slice(11, 16);

describe("constantes", () => {
  it("1h de antecedência e reserva às 6h30", () => {
    expect(SUMMARY_LEAD_MINUTES).toBe(60);
    expect(SUMMARY_FALLBACK_TIME).toBe("06:30");
  });
});

describe("weekdayOf", () => {
  it("0 = domingo … 6 = sábado", () => {
    expect(weekdayOf("2026-10-11")).toBe(0);
    expect(weekdayOf("2026-10-14")).toBe(3);
    expect(weekdayOf("2026-10-17")).toBe(6);
  });
});

describe("computeSummarySendAt", () => {
  const day = "2026-10-14"; // quarta, dia comum

  it("1h antes da primeira janela do dia", () => {
    expect(localTime(computeSummarySendAt(day, "07:00", local(day, "10:00")))).toBe("06:00");
  });

  it("atendimento antes da primeira janela: 1h antes dele", () => {
    expect(localTime(computeSummarySendAt(day, "07:00", local(day, "06:30")))).toBe("05:30");
  });

  it("dia sem janela: reserva às 6h30", () => {
    expect(localTime(computeSummarySendAt(day, null, local(day, "10:00")))).toBe("06:30");
  });

  it("dia sem janela e atendimento cedo: 1h antes do atendimento, se for antes das 6h30", () => {
    expect(localTime(computeSummarySendAt(day, null, local(day, "07:00")))).toBe("06:00");
  });

  it("feriado ignora a janela e usa a reserva das 6h30", () => {
    const holiday = "2026-10-12";
    expect(localTime(computeSummarySendAt(holiday, "08:00", local(holiday, "14:00")))).toBe("06:30");
  });
});

describe("describeSummarySchedule", () => {
  it("lista os dias com janela, 1h antes do início", () => {
    expect(describeSummarySchedule([null, "07:00", null, "13:00", null, "07:30", null])).toBe(
      "seg 6h · qua 12h · sex 6h30",
    );
  });

  it("sem nenhuma janela", () => {
    expect(describeSummarySchedule([null, null, null, null, null, null, null])).toBe("nenhuma janela cadastrada");
  });

  it("domingo e sábado usam os rótulos dom e sáb", () => {
    expect(describeSummarySchedule(["09:00", null, null, null, null, null, "10:15"])).toBe("dom 8h · sáb 9h15");
  });

  // Comportamento atual registrado como está: janela antes de 1h da manhã
  // mostra o horário da véspera sem dizer que é a véspera.
  it("janela à 0h30 aparece como 23h30 (comportamento atual)", () => {
    expect(describeSummarySchedule([null, "00:30", null, null, null, null, null])).toBe("seg 23h30");
  });
});
