import { describe, expect, it } from "vitest";
import { buildDmed, dmedText, groupDmed, type DmedPayment } from "./dmed";

// DMED (F11.6): agrupar por quem pagou e por beneficiário, na ordem da
// Receita, e montar o arquivo no leiaute do ADE Cofis nº 34/2024.
const MARIA = "52998224725";
const PEDRO = "12345678909";
const pay = (p: Partial<DmedPayment>): DmedPayment => ({
  amountCents: 10000,
  payerCpf: MARIA,
  payerName: "Maria Souza",
  selfPaid: false,
  patientKey: "joao",
  patientName: "João Souza",
  patientCpf: null,
  patientBirthdate: "2020-03-05",
  ...p,
});

describe("DMED", () => {
  it("agrupa por quem pagou (CPF crescente) e por beneficiário; o próprio vai no valor do responsável", () => {
    const grouped = groupDmed([
      pay({ amountCents: 30000 }),
      pay({ amountCents: 15000 }),
      pay({ patientKey: "ana", patientName: "Ana Souza", patientBirthdate: "2024-01-10", amountCents: 20000 }),
      pay({ payerCpf: PEDRO, payerName: "Pedro Pai", patientKey: "ana", patientName: "Ana Souza", patientBirthdate: "2024-01-10" }),
      pay({ selfPaid: true, patientKey: "maria", patientName: "Maria Souza", amountCents: 5000 }),
    ]);
    expect(grouped).toEqual([
      { cpf: PEDRO, name: "Pedro Pai", ownCents: 0, beneficiaries: [{ cpf: null, birthdate: "2024-01-10", name: "Ana Souza", cents: 10000 }] },
      {
        cpf: MARIA,
        name: "Maria Souza",
        ownCents: 5000,
        beneficiaries: [
          { cpf: null, birthdate: "2020-03-05", name: "João Souza", cents: 45000 },
          { cpf: null, birthdate: "2024-01-10", name: "Ana Souza", cents: 20000 },
        ],
      },
    ]);
  });

  it("beneficiário com o mesmo CPF de quem pagou conta como próprio", () => {
    expect(groupDmed([pay({ patientCpf: MARIA })])[0]).toMatchObject({ ownCents: 10000, beneficiaries: [] });
  });

  it("monta o arquivo: cabeçalho, RESPO, DECPJ, PSS, RPPSS, BRPPSS e FIMDmed, com | no fim e CRLF", () => {
    const content = buildDmed({
      year: 2025,
      filler: { cpf: PEDRO, name: "Contador | Exemplo", ddd: "84", phone: "988880099", extension: null, email: "contador@exemplo.com" },
      declarant: { cnpj: "11222333000181", legalName: "Clínica Exemplo Ltda", cnes: null, legalResponsibleCpf: MARIA },
      responsibles: groupDmed([pay({ amountCents: 30050, patientCpf: PEDRO.replace("123", "111") }), pay({ selfPaid: true, amountCents: 100 })]),
    });
    expect(content.split("\r\n")).toEqual([
      "Dmed|2026|2025|N|||",
      `RESPO|${PEDRO}|Contador Exemplo|84|988880099|||contador@exemplo.com|`,
      `DECPJ|11222333000181|Clínica Exemplo Ltda|1|||${MARIA}|N|||`,
      "PSS|",
      `RPPSS|${MARIA}|Maria Souza|100|`,
      `BRPPSS|11145678909|20200305|João Souza|30050|`,
      "FIMDmed|",
      "",
    ]);
  });

  it("sem pagamentos com CPF: cabeçalho, responsáveis, PSS e fim", () => {
    const content = buildDmed({
      year: 2025,
      filler: { cpf: PEDRO, name: "C", ddd: "84", phone: "88880099", extension: "12", email: null },
      declarant: { cnpj: "11222333000181", legalName: "X", cnes: "1234567", legalResponsibleCpf: MARIA },
      responsibles: [],
    });
    expect(content).toBe(`Dmed|2026|2025|N|||\r\nRESPO|${PEDRO}|C|84|88880099|12|||\r\nDECPJ|11222333000181|X|1||1234567|${MARIA}|N|||\r\nPSS|\r\nFIMDmed|\r\n`);
  });

  it("texto de campo sem | nem quebra de linha, no tamanho máximo", () => {
    expect(dmedText(" Ana |\nSouza  ", 60)).toBe("Ana Souza");
    expect(dmedText("x".repeat(70), 60)).toHaveLength(60);
  });
});
