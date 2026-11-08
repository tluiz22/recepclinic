import { describe, expect, it } from "vitest";
import { toInstant } from "../../clinicTime";
import { wholeBlockedDays, type WeekWindow } from "./blockedDays";

const TZ = "America/Fortaleza";
const at = (date: string, time: string) => toInstant(date, time, TZ);
// Terça e quarta: 08:00–12:00 e 14:00–18:00; quinta: só a manhã.
const windows: WeekWindow[] = [
  { weekday: 2, startTime: "08:00", endTime: "12:00" },
  { weekday: 2, startTime: "14:00", endTime: "18:00" },
  { weekday: 3, startTime: "08:00", endTime: "12:00" },
  { weekday: 3, startTime: "14:00", endTime: "18:00" },
  { weekday: 4, startTime: "08:00", endTime: "12:00" },
];
const days = (blocks: { start: Date; end: Date }[], fromDate = "2031-12-01", toDate = "2031-12-31") =>
  [...wholeBlockedDays({ windows, blocks, fromDate, toDate, timeZone: TZ })].sort();

describe("dias bloqueados inteiros (I9)", () => {
  it("férias de vários dias: só os dias com atendimento contam", () => {
    // 09/12 (ter) a 13/12 (sáb) inteiros: ter, qua e qui têm horário; sex e sáb não.
    expect(days([{ start: at("2031-12-09", "00:00"), end: at("2031-12-14", "00:00") }])).toEqual(["2031-12-09", "2031-12-10", "2031-12-11"]);
  });

  it("bloqueio só da manhã não bloqueia o dia; manhã e tarde em dois bloqueios, sim", () => {
    expect(days([{ start: at("2031-12-09", "08:00"), end: at("2031-12-09", "12:00") }])).toEqual([]);
    expect(
      days([
        { start: at("2031-12-09", "08:00"), end: at("2031-12-09", "12:00") },
        { start: at("2031-12-09", "13:00"), end: at("2031-12-09", "18:00") },
      ]),
    ).toEqual(["2031-12-09"]);
  });

  it("dia de só manhã bloqueado pela manhã conta; bloqueio que não cobre o fim, não", () => {
    expect(days([{ start: at("2031-12-11", "07:00"), end: at("2031-12-11", "12:00") }])).toEqual(["2031-12-11"]);
    expect(days([{ start: at("2031-12-11", "08:00"), end: at("2031-12-11", "11:30") }])).toEqual([]);
  });

  it("sem bloqueio ou sem horário, nada", () => {
    expect(days([])).toEqual([]);
    expect([...wholeBlockedDays({ windows: [], blocks: [{ start: at("2031-12-09", "00:00"), end: at("2031-12-10", "00:00") }], fromDate: "2031-12-01", toDate: "2031-12-31", timeZone: TZ })]).toEqual([]);
  });
});
