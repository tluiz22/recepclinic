import { generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import forge from "node-forge";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callSefin, findNfseByDps, gunzipBase64, gzipBase64, parseSefinErrors, sendCancel, sendDps, type SefinTransport } from "./client";
import { buildCancelRequest, buildDps, issueDateTime, nfseNumberOf, serviceDescription, xmlText, type DpsInput } from "./dps";
import { keysFromPfx, signXml, type CertificateKeys } from "./sign";

// NFS-e nacional (F11.4): DPS no leiaute 1.01, assinatura que confere,
// conversa com a Sefin (sucesso, recusa e sem resposta) e o TLS mútuo.
const NOW = new Date("2026-10-12T15:00:00Z");
const INPUT: DpsInput = {
  environment: "restricted",
  series: "1",
  dpsNumber: 7,
  dpsId: "DPS240800321122233300018100001000000000000007",
  competence: "2026-10-12",
  amountCents: 30050,
  payerCpf: "52998224725",
  payerName: "Maria & Souza",
  patientName: "João Souza",
  appointmentDate: "2026-10-05",
  category: "consultation",
  cnpj: "11222333000181",
  municipalRegistration: "123456",
  municipalityIbge: "2408003",
  simplesNacional: "me_epp",
  simplesRegime: "1",
  simplesTotalRate: 6,
  specialRegime: "none",
  serviceCode: "04.01.01",
  issRate: 2,
};

let keys: CertificateKeys;

/** Par RSA de 2048 bits (o TLS recusa menos), gerado pelo Node e lido pelo node-forge. */
function rsaPair(): forge.pki.rsa.KeyPair {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const priv = forge.pki.privateKeyFromPem(privateKey.export({ type: "pkcs1", format: "pem" }).toString()) as forge.pki.rsa.PrivateKey;
  return { privateKey: priv, publicKey: forge.pki.setRsaPublicKey(priv.n, priv.e) };
}

function makeCert(commonName: string, key: forge.pki.rsa.KeyPair, issuer?: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey }) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = key.publicKey;
  cert.serialNumber = String(Math.floor(Math.random() * 1e9));
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000 * 30);
  cert.setSubject([{ name: "commonName", value: commonName }]);
  cert.setIssuer(issuer ? issuer.cert.subject.attributes : [{ name: "commonName", value: commonName }]);
  if (!issuer) cert.setExtensions([{ name: "basicConstraints", cA: true }]);
  else cert.setExtensions([{ name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }, { type: 7, ip: "127.0.0.1" }] }]);
  cert.sign(issuer?.key ?? key.privateKey, forge.md.sha256.create());
  return cert;
}

beforeAll(() => {
  const pair = rsaPair();
  const cert = makeCert("CLINICA TESTE:11222333000181", pair);
  const p12 = forge.pkcs12.toPkcs12Asn1(pair.privateKey, [cert], "senha", { algorithm: "3des" });
  keys = keysFromPfx(forge.util.binary.raw.decode(forge.asn1.toDer(p12).getBytes()), "senha");
});

describe("DPS", () => {
  it("monta no leiaute 1.01: Id, prestador, tomador, serviço e valores (ME/EPP)", () => {
    const xml = buildDps(INPUT, NOW, "America/Fortaleza");
    expect(xml).toContain(`<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="${INPUT.dpsId}">`);
    expect(xml).toContain("<tpAmb>2</tpAmb><dhEmi>2026-10-12T11:59:00-03:00</dhEmi>");
    expect(xml).toContain("<serie>1</serie><nDPS>7</nDPS><dCompet>2026-10-12</dCompet><tpEmit>1</tpEmit><cLocEmi>2408003</cLocEmi>");
    expect(xml).toContain("<prest><CNPJ>11222333000181</CNPJ><IM>123456</IM><regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib></prest>");
    expect(xml).toContain("<toma><CPF>52998224725</CPF><xNome>Maria &amp; Souza</xNome></toma>");
    expect(xml).toContain("<cTribNac>040101</cTribNac><xDescServ>Consulta. Paciente: João Souza. Atendimento em 05/10/2026.</xDescServ>");
    expect(xml).toContain("<vServ>300.50</vServ>");
    expect(xml).toContain("<tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN><pAliq>2.00</pAliq></tribMun><totTrib><pTotTribSN>6.00</pTotTribSN></totTrib>");
  });

  it("fora do Simples: sem alíquota (vale a do município) e indTotTrib 0; sociedade de profissionais", () => {
    const xml = buildDps({ ...INPUT, simplesNacional: "not_optant", simplesRegime: null, simplesTotalRate: null, specialRegime: "professional_society", municipalRegistration: null }, NOW, "America/Fortaleza");
    expect(xml).toContain("<regTrib><opSimpNac>1</opSimpNac><regEspTrib>6</regEspTrib></regTrib>");
    expect(xml).not.toContain("<IM>");
    expect(xml).toContain("<tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun><totTrib><indTotTrib>0</indTotTrib></totTrib>");
  });

  it("descrição: tipo, paciente e data, nunca o nome do serviço", () => {
    expect(serviceDescription({ category: "exam", patientName: "Ana", appointmentDate: "2026-01-02" })).toBe("Exame. Paciente: Ana. Atendimento em 02/01/2026.");
    expect(serviceDescription({ category: "return_visit", patientName: "Ana", appointmentDate: "2026-01-02" })).toBe("Consulta de retorno. Paciente: Ana. Atendimento em 02/01/2026.");
  });

  it("texto: escapa e tira controle; data e hora com o fuso", () => {
    expect(xmlText(" a <b>\u0001\n c ")).toBe("a &lt;b&gt; c");
    expect(issueDateTime(new Date("2026-03-01T03:00:30Z"), "America/Fortaleza")).toBe("2026-02-28T23:59:30-03:00");
  });

  it("pedido de cancelamento: Id PRE + chave + 101101, motivo e autor", () => {
    const key = "2".repeat(50);
    const xml = buildCancelRequest({ environment: "production", accessKey: key, cnpj: "11222333000181", reasonCode: 1, reasonText: "CPF do tomador errado" }, NOW, "America/Fortaleza");
    expect(xml).toContain(`<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infPedReg Id="PRE${key}101101"><tpAmb>1</tpAmb>`);
    expect(xml).toContain(`<CNPJAutor>11222333000181</CNPJAutor><chNFSe>${key}</chNFSe><e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>1</cMotivo><xMotivo>CPF do tomador errado</xMotivo></e101101>`);
  });

  it("número da nota no XML da Sefin", () => {
    expect(nfseNumberOf("<NFSe><infNFSe><nNFSe>123</nNFSe></infNFSe></NFSe>")).toBe("123");
    expect(nfseNumberOf("<x/>")).toBeNull();
  });
});

describe("assinatura", () => {
  it("assina o infDPS (RSA-SHA256, sem prefixo, com o certificado) e a assinatura confere", () => {
    const signed = signXml(buildDps(INPUT, NOW, "America/Fortaleza"), "infDPS", "DPS", keys);
    expect(signed).toContain(`<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">`);
    expect(signed).toContain(`<Reference URI="#${INPUT.dpsId}">`);
    expect(signed).toContain("rsa-sha256");
    expect(signed).not.toContain("ds:");
    expect(signed.indexOf("<Signature")).toBeGreaterThan(signed.indexOf("</infDPS>"));
    const doc = new DOMParser().parseFromString(signed, "text/xml");
    const verifier = new SignedXml({ publicCert: keys.certPem });
    verifier.loadSignature(doc.getElementsByTagName("Signature")[0] as never);
    expect(verifier.checkSignature(signed)).toBe(true);
    // Mexer no valor quebra a assinatura.
    const tampered = signed.replace("300.50", "3.50");
    const other = new SignedXml({ publicCert: keys.certPem });
    other.loadSignature(new DOMParser().parseFromString(tampered, "text/xml").getElementsByTagName("Signature")[0] as never);
    let valid: boolean;
    try {
      valid = other.checkSignature(tampered);
    } catch {
      valid = false;
    }
    expect(valid).toBe(false);
  });

  it("assina o pedido de cancelamento", () => {
    const signed = signXml(
      buildCancelRequest({ environment: "restricted", accessKey: "2".repeat(50), cnpj: "11222333000181", reasonCode: 9, reasonText: "Pagamento devolvido ao paciente" }, NOW, "America/Fortaleza"),
      "infPedReg",
      "pedRegEvento",
      keys,
    );
    const doc = new DOMParser().parseFromString(signed, "text/xml");
    const verifier = new SignedXml({ publicCert: keys.certPem });
    verifier.loadSignature(doc.getElementsByTagName("Signature")[0] as never);
    expect(verifier.checkSignature(signed)).toBe(true);
  });
});

describe("conversa com a Sefin", () => {
  const nfseXml = "<NFSe><infNFSe><nNFSe>42</nNFSe></infNFSe></NFSe>";
  const fake =
    (status: number, body: unknown, seen: { body?: Record<string, string>; path?: string }[] = []): SefinTransport =>
    async (_env, _keys, req) => {
      seen.push({ body: req.body, path: req.path });
      return { status, body };
    };

  it("emitida: devolve a chave e o XML; o corpo vai com a DPS em GZip e Base64", async () => {
    const seen: { body?: Record<string, string>; path?: string }[] = [];
    const out = await sendDps(fake(201, { chaveAcesso: "1".repeat(50), nfseXmlGZipB64: gzipBase64(nfseXml) }, seen), "restricted", keys, "<DPS/>");
    expect(out).toEqual({ kind: "issued", accessKey: "1".repeat(50), nfseXml });
    expect(seen[0].path).toBe("/nfse");
    expect(gunzipBase64(seen[0].body!.dpsXmlGZipB64)).toBe("<DPS/>");
  });

  it("recusada: os códigos e textos da Receita", async () => {
    const out = await sendDps(fake(400, { erros: [{ Codigo: "E0712", Descricao: "Informe o total de tributos.", Complemento: "pTotTribSN" }] }), "restricted", keys, "<DPS/>");
    expect(out).toEqual({ kind: "rejected", errors: [{ code: "E0712", message: "Informe o total de tributos. pTotTribSN" }] });
  });

  it("sem resposta: erro 5xx, rede ou resposta sem chave", async () => {
    expect((await sendDps(fake(503, "fora do ar"), "restricted", keys, "<DPS/>")).kind).toBe("unknown");
    const broken: SefinTransport = async () => {
      throw new Error("ECONNRESET");
    };
    expect(await sendDps(broken, "restricted", keys, "<DPS/>")).toEqual({ kind: "unknown", message: "ECONNRESET" });
    expect((await sendDps(fake(200, { ok: true }), "restricted", keys, "<DPS/>")).kind).toBe("unknown");
  });

  it("consulta pela DPS: achou (com o XML), não achou (404) ou sem resposta", async () => {
    const found: SefinTransport = async (_e, _k, req) =>
      req.path.startsWith("/dps/") ? { status: 200, body: { chaveAcesso: "3".repeat(50) } } : { status: 200, body: { nfseXmlGZipB64: gzipBase64(nfseXml) } };
    expect(await findNfseByDps(found, "restricted", keys, "DPS1")).toEqual({ kind: "found", accessKey: "3".repeat(50), nfseXml });
    expect(await findNfseByDps(fake(404, null), "restricted", keys, "DPS1")).toEqual({ kind: "not_found" });
    expect((await findNfseByDps(fake(500, null), "restricted", keys, "DPS1")).kind).toBe("unknown");
  });

  it("cancelamento: aceito, recusado ou sem resposta", async () => {
    const seen: { body?: Record<string, string>; path?: string }[] = [];
    expect(await sendCancel(fake(201, {}, seen), "restricted", keys, "4".repeat(50), "<pedRegEvento/>")).toEqual({ kind: "canceled" });
    expect(seen[0].path).toBe(`/nfse/${"4".repeat(50)}/eventos`);
    expect(gunzipBase64(seen[0].body!.pedidoRegistroEventoXmlGZipB64)).toBe("<pedRegEvento/>");
    expect((await sendCancel(fake(400, { erro: { codigo: "E1235", descricao: "Prazo de cancelamento expirado" } }), "restricted", keys, "4".repeat(50), "x")).kind).toBe("rejected");
    expect((await sendCancel(fake(502, null), "restricted", keys, "4".repeat(50), "x")).kind).toBe("unknown");
  });

  it("erros em qualquer forma", () => {
    expect(parseSefinErrors({ mensagem: "Certificado inválido" }, 403)).toEqual([{ code: "HTTP 403", message: "Certificado inválido" }]);
    expect(parseSefinErrors("Bad Request", 400)).toEqual([{ code: "HTTP 400", message: "Bad Request" }]);
    expect(parseSefinErrors(null, 400)).toEqual([{ code: "HTTP 400", message: "Recusado pela Receita, sem detalhe." }]);
  });
});

describe("TLS mútuo", () => {
  let server: Server;
  let ca: string;
  let seenSubject = "";

  beforeAll(async () => {
    const caPair = rsaPair();
    const caCert = makeCert("AC Local de Teste", caPair);
    const serverPair = rsaPair();
    const serverCert = makeCert("localhost", serverPair, { cert: caCert, key: caPair.privateKey });
    ca = forge.pki.certificateToPem(caCert);
    server = createServer(
      { key: forge.pki.privateKeyToPem(serverPair.privateKey), cert: forge.pki.certificateToPem(serverCert), requestCert: true, rejectUnauthorized: false },
      (req, res) => {
        const peer = (req.socket as import("node:tls").TLSSocket).getPeerCertificate();
        seenSubject = String(peer?.subject?.CN ?? "");
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ recebido: JSON.parse(body) }));
        });
      },
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterAll(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

  it("apresenta o certificado da clínica e manda o JSON", async () => {
    const { port } = server.address() as AddressInfo;
    const res = await callSefin(new URL(`https://127.0.0.1:${port}/SefinNacional/nfse`), keys, { method: "POST", path: "/nfse", body: { a: "b" } }, { ca });
    expect(res).toEqual({ status: 201, body: { recebido: { a: "b" } } });
    expect(seenSubject).toBe("CLINICA TESTE:11222333000181");
  });
});
