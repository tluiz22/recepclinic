import { describe, expect, it } from "vitest";
import { birthdateText, blockMessage, buildIcs, cleanFullName, HOME_ADDRESS_MAX, HOME_ADDRESS_MESSAGES, HOME_ADDRESS_TEXT_MAX, icsTitle, joinHomeAddress, parseBirthdate, shortDate } from "./portalBooking";

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
      "João Souza já tem consulta com Dra. Ana Lima na quinta, 12/11 às 09:00. Para marcar uma nova, remarque ou cancele a atual em Minhas consultas.",
    );
    expect(blockMessage({ kind: "limit", reason: "future_appointments", current: 5 }, "X", null)).toBe("Este número já tem 5 consultas marcadas. Fale com a recepção.");
    expect(blockMessage({ kind: "limit", reason: "no_shows", current: 5 }, "X", null)).toBe("Para este agendamento, fale com a recepção.");
  });
});

describe("título do .ics por tipo (F2d)", () => {
  it("consulta e retorno", () => {
    expect(icsTitle("Dra. Ana Lima", "Clínica Exemplo")).toBe("Consulta com Dra. Ana Lima — Clínica Exemplo");
    expect(icsTitle("Dra. Ana Lima", "Clínica Exemplo", "retorno")).toBe("Retorno com Dra. Ana Lima — Clínica Exemplo");
    expect(icsTitle("Espirometria", "Clínica Exemplo", "exame")).toBe("Exame Espirometria — Clínica Exemplo");
  });
});

describe("joinHomeAddress (F3e-1, endereço do atendimento em casa)", () => {
  it("junta os campos num texto só, sem os vazios", () => {
    expect(joinHomeAddress({ street: " Rua dos Ipês,  45 ", complement: "Apto 302", district: "Lagoa Nova", reference: "em frente à padaria" })).toMatchObject({
      ok: true,
      text: "Rua dos Ipês, 45, Apto 302, Lagoa Nova. Ponto de referência: em frente à padaria",
    });
    expect(joinHomeAddress({ street: "Rua A, 10", district: "Centro" })).toMatchObject({ ok: true, text: "Rua A, 10, Centro" });
  });

  it("pede rua e bairro, mantendo o que foi digitado", () => {
    const result = joinHomeAddress({ street: "", complement: "Casa 2", district: " " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual({ street: HOME_ADDRESS_MESSAGES.street, district: HOME_ADDRESS_MESSAGES.district });
    expect(result.fields.complement).toBe("Casa 2");
  });

  it("corta cada campo no tamanho dele e o texto cabe na coluna", () => {
    const result = joinHomeAddress({ street: "R".repeat(400), complement: "C".repeat(400), district: "B".repeat(400), reference: "P".repeat(400) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text.length).toBeLessThanOrEqual(HOME_ADDRESS_TEXT_MAX);
    expect(result.fields.street).toHaveLength(HOME_ADDRESS_MAX.street);
  });
});
