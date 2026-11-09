import { describe, expect, it } from "vitest";
import { birthdateText, blockMessage, buildIcs, cleanFullName, icsTitle, parseBirthdate, shortDate } from "./portalBooking";

const today = "2026-11-08";

describe("cleanFullName", () => {
  it("pede nome e sobrenome", () => {
    expect(cleanFullName("  João   Souza Lima ")).toBe("João Souza Lima");
    expect(cleanFullName("João")).toBeNull();
    expect(cleanFullName("João 2")).toBeNull();
    expect(cleanFullName("")).toBeNull();
    expect(cleanFullName("A".repeat(60) + " " + "B".repeat(60))).toBeNull();
  });
});

describe("parseBirthdate", () => {
  it("aceita dd/mm/aaaa, só números e o campo de data", () => {
    expect(parseBirthdate("14/03/2019", today)).toEqual({ ok: true, date: "2019-03-14" });
    expect(parseBirthdate("4/3/2019", today)).toEqual({ ok: true, date: "2019-03-04" });
    expect(parseBirthdate("14032019", today)).toEqual({ ok: true, date: "2019-03-14" });
    expect(parseBirthdate("2019-03-14", today)).toEqual({ ok: true, date: "2019-03-14" });
  });
  it("recusa ano com 2 números, dia que não existe, futuro e mais de 110 anos", () => {
    expect(parseBirthdate("14/03/19", today)).toEqual({ ok: false, problem: "format" });
    expect(parseBirthdate("31/02/2019", today)).toEqual({ ok: false, problem: "invalid" });
    expect(parseBirthdate("09/11/2026", today)).toEqual({ ok: false, problem: "future" });
    expect(parseBirthdate("07/11/1916", today)).toEqual({ ok: false, problem: "too_old" });
    expect(parseBirthdate("08/11/1916", today)).toEqual({ ok: true, date: "1916-11-08" });
    expect(parseBirthdate("08/11/2026", today)).toEqual({ ok: true, date: "2026-11-08" });
  });
});

describe("textos da data", () => {
  it("por extenso com a idade", () => {
    expect(birthdateText("2019-03-14", today)).toBe("14 de março de 2019, 7 anos");
    expect(birthdateText("2026-05-08", today)).toBe("8 de maio de 2026, 6 meses");
    expect(shortDate("2019-03-14")).toBe("14/03/2019");
  });
});

describe("buildIcs", () => {
  it("monta o evento com o médico e o endereço, sem dado de saúde", () => {
    const ics = buildIcs({
      uid: "abc",
      start: new Date("2026-11-12T12:00:00Z"),
      end: new Date("2026-11-12T12:30:00Z"),
      title: icsTitle("Dra. Ana Lima", "Clínica Exemplo"),
      location: "Rua A, 10; Natal",
      now: new Date("2026-11-08T10:00:00Z"),
    });
    expect(ics).toContain("SUMMARY:Consulta com Dra. Ana Lima — Clínica Exemplo");
    expect(ics).toContain("DTSTART:20261112T120000Z");
    expect(ics).toContain("DTEND:20261112T123000Z");
    expect(ics).toContain("LOCATION:Rua A\\, 10\\; Natal");
    expect(ics).toContain("UID:abc@recepclinic.com.br");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

describe("blockMessage", () => {
  it("idade, já marcado e limites", () => {
    expect(blockMessage({ kind: "age", limit: 14 }, "Dra. Ana Lima", "João")).toBe("Dra. Ana Lima atende pacientes até 13 anos.");
    expect(blockMessage({ kind: "already", when: "na quinta, 12/11 às 09:00" }, "Dra. Ana Lima", "João Souza")).toBe(
      "João Souza já tem consulta com Dra. Ana Lima na quinta, 12/11 às 09:00. Para mudar o dia ou o horário, fale com a recepção.",
    );
    expect(blockMessage({ kind: "limit", reason: "future_appointments", current: 5 }, "X", null)).toBe("Este número já tem 5 consultas marcadas. Fale com a recepção.");
    expect(blockMessage({ kind: "limit", reason: "no_shows", current: 5 }, "X", null)).toBe("Para este agendamento, fale com a recepção.");
  });
});
