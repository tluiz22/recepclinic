import { describe, expect, it } from "vitest";
import {
  addDays,
  dayBounds,
  DEFAULT_TIMEZONE,
  formatCalendarDate,
  formatInstant,
  isCalendarDate,
  isClockTime,
  isValidTimeZone,
  localDateOf,
  localHourOf,
  localTimeOf,
  todayIn,
  toInstant,
  weekdayOf,
} from "./clinicTime";

const FORTALEZA = "America/Fortaleza"; // -03, sem horário de verão
const MANAUS = "America/Manaus"; // -04
const NORONHA = "America/Noronha"; // -02
const SAO_PAULO = "America/Sao_Paulo"; // teve horário de verão até 2019
const NEW_YORK = "America/New_York"; // horário de verão hoje

const utc = (iso: string) => new Date(iso);

describe("fuso válido", () => {
  it("aceita fusos IANA e recusa o resto", () => {
    expect(isValidTimeZone(DEFAULT_TIMEZONE)).toBe(true);
    expect(isValidTimeZone(MANAUS)).toBe(true);
    expect(isValidTimeZone("America/Atlantida")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("funções com fuso inválido dão erro em vez de cair num padrão", () => {
    expect(() => localDateOf(new Date(), "Fortaleza")).toThrow(RangeError);
    expect(() => toInstant("2026-10-04", "08:00", "")).toThrow(RangeError);
  });
});

describe("data e hora do calendário", () => {
  it("data só passa se o dia existe", () => {
    expect(isCalendarDate("2026-10-04")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-02-31")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-1-01")).toBe(false);
    expect(isCalendarDate("04/10/2026")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });

  it("hora vai de 00:00 a 23:59", () => {
    expect(isClockTime("00:00")).toBe(true);
    expect(isClockTime("23:59")).toBe(true);
    expect(isClockTime("24:00")).toBe(false);
    expect(isClockTime("8:00")).toBe(false);
    expect(isClockTime("08:60")).toBe(false);
  });

  it("soma dias atravessando mês, ano e 29 de fevereiro", () => {
    expect(addDays("2026-10-04", 1)).toBe("2026-10-05");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-10-04", 0)).toBe("2026-10-04");
  });

  it("dia da semana não depende de fuso", () => {
    expect(weekdayOf("2026-10-04")).toBe(0); // domingo
    expect(weekdayOf("2026-10-10")).toBe(6); // sábado
  });

  it("data inválida dá erro", () => {
    expect(() => addDays("2026-02-31", 1)).toThrow(RangeError);
    expect(() => weekdayOf("2026-13-01")).toThrow(RangeError);
    expect(() => toInstant("2026-10-04", "25:00", FORTALEZA)).toThrow(RangeError);
  });
});

describe("instante → relógio da clínica", () => {
  // 02:30 UTC de 05/out = 23:30 de 04/out em Fortaleza
  const lateNight = utc("2026-10-05T02:30:00Z");

  it("a data local é a da clínica, não a do servidor (UTC)", () => {
    expect(localDateOf(lateNight, FORTALEZA)).toBe("2026-10-04");
    expect(localTimeOf(lateNight, FORTALEZA)).toBe("23:30");
    expect(localHourOf(lateNight, FORTALEZA)).toBe(23);
    expect(todayIn(FORTALEZA, lateNight)).toBe("2026-10-04");
  });

  it("o mesmo instante muda de data e hora com o fuso", () => {
    expect(localTimeOf(lateNight, MANAUS)).toBe("22:30");
    expect(localDateOf(lateNight, NORONHA)).toBe("2026-10-05");
    expect(localTimeOf(lateNight, NORONHA)).toBe("00:30");
  });
});

describe("relógio da clínica → instante", () => {
  it("08:00 em cada fuso", () => {
    expect(toInstant("2026-10-05", "08:00", FORTALEZA).toISOString()).toBe("2026-10-05T11:00:00.000Z");
    expect(toInstant("2026-10-05", "08:00", MANAUS).toISOString()).toBe("2026-10-05T12:00:00.000Z");
    expect(toInstant("2026-10-05", "08:00", NORONHA).toISOString()).toBe("2026-10-05T10:00:00.000Z");
  });

  it("ida e volta preservam data e hora", () => {
    const instant = toInstant("2026-12-31", "23:45", FORTALEZA);
    expect(localDateOf(instant, FORTALEZA)).toBe("2026-12-31");
    expect(localTimeOf(instant, FORTALEZA)).toBe("23:45");
  });

  it("dia comum tem 24 horas", () => {
    const { start, end } = dayBounds("2026-10-04", FORTALEZA);
    expect(start.toISOString()).toBe("2026-10-04T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-05T03:00:00.000Z");
  });

  describe("horário de verão", () => {
    it("hora que não existe vai para a seguinte (São Paulo, 04/11/2018, meia-noite pulou)", () => {
      expect(toInstant("2018-11-04", "00:00", SAO_PAULO).toISOString()).toBe("2018-11-04T03:00:00.000Z");
      expect(localTimeOf(toInstant("2018-11-04", "00:30", SAO_PAULO), SAO_PAULO)).toBe("01:30");
    });

    it("o dia em que o relógio pula tem 23 horas", () => {
      const { start, end } = dayBounds("2018-11-04", SAO_PAULO);
      expect(start.toISOString()).toBe("2018-11-04T03:00:00.000Z");
      expect(end.toISOString()).toBe("2018-11-05T02:00:00.000Z");
    });

    it("hora repetida fica com a primeira vez (São Paulo, 16/02/2019, 23h repetiu)", () => {
      expect(toInstant("2019-02-16", "23:30", SAO_PAULO).toISOString()).toBe("2019-02-17T01:30:00.000Z");
    });

    it("Nova York, 08/03/2026: 02:30 não existe e vira 03:30", () => {
      expect(toInstant("2026-03-08", "02:30", NEW_YORK).toISOString()).toBe("2026-03-08T07:30:00.000Z");
    });
  });
});

describe("textos em português", () => {
  it("instante no relógio da clínica", () => {
    const instant = utc("2026-10-05T02:30:00Z");
    expect(formatInstant(instant, FORTALEZA, "dd/MM/yyyy 'às' HH:mm")).toBe("04/10/2026 às 23:30");
    expect(formatInstant(instant, NORONHA, "EEEE, d 'de' MMMM")).toBe("segunda-feira, 5 de outubro");
  });

  it("data do calendário, sem depender do fuso do servidor", () => {
    expect(formatCalendarDate("2026-10-04", "EEEE, dd/MM/yyyy")).toBe("domingo, 04/10/2026");
    expect(formatCalendarDate("2026-01-01", "dd 'de' MMM")).toBe("01 de jan");
  });
});
