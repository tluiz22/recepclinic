import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { findNfseByDps, gzipBase64, httpsTransport, sendCancel, sendDps } from "./client";
import { buildDanfse, readNfse } from "./danfse";
import { buildDps, nfseNumberOf, type DpsInput } from "./dps";
import { SIMULATED_NOTICE, simulatedNfse, simulatedTransport } from "./simulator";
import type { CertificateKeys } from "./sign";

// Receita simulada (F11.4b): a nota sai do próprio servidor, no formato da
// Sefin, e o DANFSe lê dela o mesmo que leria de uma nota de verdade.
const NOW = new Date("2026-10-13T15:00:00Z");
const INPUT: DpsInput = {
  environment: "simulation",
  series: "1",
  dpsNumber: 12,
  dpsId: "DPS240800321122233300018100001000000000000012",
  competence: "2026-10-13",
  amountCents: 25000,
  payerCpf: "52998224725",
  payerName: "Maria Souza",
  patientName: "João Souza",
  appointmentDate: "2026-10-10",
  category: "consultation",
  cnpj: "11222333000181",
  municipalRegistration: "123456",
  municipalityIbge: "2408003",
  simplesNacional: "not_optant",
  simplesRegime: null,
  simplesTotalRate: null,
  specialRegime: "none",
  serviceCode: "04.01.01",
  issRate: 2,
};
const PRESTADOR = { legalName: "Clínica Fictícia de Teste Ltda", municipalityName: "Mossoró", uf: "RN", issRate: 2 };
const KEYS = {} as CertificateKeys;
const dps = buildDps(INPUT, NOW, "America/Fortaleza");

describe("Receita simulada", () => {
  it("embrulha a DPS numa NFS-e que o DANFSe lê", () => {
    const nfse = simulatedNfse(dps, PRESTADOR, NOW, "America/Fortaleza");
    expect(nfse.accessKey).toMatch(/^\d{50}$/);
    expect(nfse.accessKey.startsWith("24080032211222333000181")).toBe(true);
    expect(nfseNumberOf(nfse.xml)).toBe("12");
    const data = readNfse(nfse.xml);
    expect(data).toMatchObject({ accessKey: nfse.accessKey, number: "12", dpsNumber: "12", municipality: "Mossoró / RN", environment: "2" });
    expect(data.prest).toMatchObject({ doc: "11.222.333/0001-81", name: "Clínica Fictícia de Teste Ltda", im: "123456" });
    expect(data.toma).toMatchObject({ doc: "529.982.247-25", name: "Maria Souza" });
    expect(data.issqn).toMatchObject({ base: "R$ 250,00", rate: "2,00%", tax: "R$ 5,00" });
    expect(data.service.description).toBe("Consulta. Paciente: João Souza. Atendimento em 10/10/2026.");
    expect(nfse.xml).toContain(SIMULATED_NOTICE);
  });

  it("dá um PDF de uma página", async () => {
    const pdf = await buildDanfse(simulatedNfse(dps, PRESTADOR, NOW, "America/Fortaleza").xml);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });

  it("responde como a Sefin: emite, cancela e não acha DPS perdida", async () => {
    const transport = simulatedTransport(PRESTADOR, () => NOW, "America/Fortaleza");
    const issued = await sendDps(transport, "simulation", KEYS, dps);
    expect(issued).toMatchObject({ kind: "issued" });
    if (issued.kind !== "issued") return;
    expect(nfseNumberOf(issued.nfseXml)).toBe("12");
    expect(await sendCancel(transport, "simulation", KEYS, issued.accessKey, "<pedRegEvento/>")).toEqual({ kind: "canceled" });
    expect(await findNfseByDps(transport, "simulation", KEYS, INPUT.dpsId)).toEqual({ kind: "not_found" });
  });

  it("sem os dados fiscais, recusa", async () => {
    const res = await simulatedTransport(null, () => NOW, "America/Fortaleza")("simulation", KEYS, { method: "POST", path: "/nfse", body: { dpsXmlGZipB64: gzipBase64(dps) } });
    expect(res.status).toBe(400);
  });

  it("a nota simulada nunca vai para a Receita de verdade", async () => {
    await expect(httpsTransport("simulation", KEYS, { method: "GET", path: "/dps/x" })).rejects.toThrow(/não vai para a Receita/);
  });
});
