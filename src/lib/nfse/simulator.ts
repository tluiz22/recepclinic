import { randomInt } from "node:crypto";
import { gunzipBase64, gzipBase64, type SefinTransport } from "./client";
import { issueDateTime, money, NFSE_NS, NFSE_LAYOUT, percent, xmlText } from "./dps";

// Receita simulada (F11.4b, cliente, 13/out/2026): para testar no staging,
// sem o e-CNPJ de uma clínica, tudo o que vem depois da emissão (PDF, envio,
// cancelamento, histórico). Responde como a Sefin Nacional: a nota é a DPS
// assinada embrulhada numa NFS-e, com número = número da DPS e uma chave de
// acesso de 50 dígitos no formato oficial. Nada sai do servidor. A nota leva
// tpAmb 2 (o DANFSe mostra "SEM VALIDADE JURÍDICA") e o aviso de simulada nas
// informações complementares.

export const SIMULATED_NOTICE = "NOTA SIMULADA PELO RECEPCLINIC: não foi enviada à Receita e não existe no portal nacional.";

export type SimulatedPrestador = {
  legalName: string;
  municipalityName: string;
  uf: string;
  /** Percentual do ISS (dos dados fiscais), para o valor do ISS na nota. */
  issRate: number;
};

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? "";

/** Chave de acesso: município, ambiente gerador, tipo de inscrição, CNPJ, número, AAMM, código e dígito. */
function accessKey(cMun: string, cnpj: string, number: number, now: Date): string {
  const yymm = `${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const code = String(randomInt(0, 1_000_000_000)).padStart(9, "0");
  const base = `${cMun.padStart(7, "0")}22${cnpj.replace(/\D/g, "0").padStart(14, "0")}${String(number).padStart(13, "0")}${yymm}${code}`;
  // Dígito verificador (módulo 11), como na NF-e.
  let sum = 0;
  for (let i = base.length - 1, weight = 2; i >= 0; i--, weight = weight === 9 ? 2 : weight + 1) sum += Number(base[i]) * weight;
  const rest = sum % 11;
  return `${base}${rest < 2 ? 0 : 11 - rest}`;
}

/** NFS-e simulada a partir da DPS assinada. */
export function simulatedNfse(signedDps: string, prestador: SimulatedPrestador, now: Date, timeZone: string): { accessKey: string; xml: string } {
  const dps = signedDps.replace(/^<\?xml[^>]*\?>/, "").replace(/<DPS xmlns="[^"]*"/, "<DPS");
  const cMun = tag(dps, "cLocEmi");
  const cnpj = tag(dps, "CNPJ");
  const number = Number(tag(dps, "nDPS"));
  const amount = Number(tag(dps, "vServ"));
  const rate = Number(tag(dps, "pAliq") || prestador.issRate);
  const key = accessKey(cMun, cnpj, number, now);
  const im = tag(dps, "IM");
  const inf =
    `<xLocEmi>${xmlText(prestador.municipalityName)}</xLocEmi>` +
    `<xLocPrestacao>${xmlText(prestador.municipalityName)}</xLocPrestacao>` +
    `<nNFSe>${number}</nNFSe>` +
    `<cLocIncid>${cMun}</cLocIncid><xLocIncid>${xmlText(prestador.municipalityName)}</xLocIncid>` +
    `<xTribNac>Serviço de saúde.</xTribNac>` +
    `<xOutInf>${xmlText(SIMULATED_NOTICE)}</xOutInf>` +
    `<verAplic>RecepClinic-Simulacao</verAplic><ambGer>2</ambGer><tpEmis>1</tpEmis><procEmi>1</procEmi><cStat>100</cStat>` +
    `<dhProc>${issueDateTime(new Date(now.getTime() + 60_000), timeZone)}</dhProc><nDFSe>${number}</nDFSe>` +
    `<emit><CNPJ>${cnpj}</CNPJ>${im ? `<IM>${im}</IM>` : ""}<xNome>${xmlText(prestador.legalName)}</xNome><enderNac><cMun>${cMun}</cMun><UF>${prestador.uf}</UF></enderNac></emit>` +
    `<valores><vBC>${amount.toFixed(2)}</vBC><pAliqAplic>${percent(rate)}</pAliqAplic><vISSQN>${money(Math.round(amount * rate))}</vISSQN><vTotalRet>0.00</vTotalRet><vLiq>${amount.toFixed(2)}</vLiq></valores>` +
    dps;
  return {
    accessKey: key,
    xml: `<?xml version="1.0" encoding="UTF-8"?><NFSe xmlns="${NFSE_NS}" versao="${NFSE_LAYOUT}"><infNFSe Id="NFS${key}">${inf}</infNFSe></NFSe>`,
  };
}

/**
 * Transporte que responde no lugar da Sefin. Emitir devolve a nota; cancelar
 * aceita; consultar uma DPS diz que não há nota (a simulada nunca fica
 * "emitindo", porque a resposta nunca se perde).
 */
export function simulatedTransport(prestador: SimulatedPrestador | null, now: () => Date, timeZone: string): SefinTransport {
  return async (_environment, _keys, req) => {
    if (req.method === "POST" && req.path === "/nfse") {
      if (!prestador) return { status: 400, body: { erros: [{ codigo: "SIMULACAO", descricao: "Faltam os dados fiscais da clínica." }] } };
      const nfse = simulatedNfse(gunzipBase64(req.body!.dpsXmlGZipB64), prestador, now(), timeZone);
      return { status: 201, body: { chaveAcesso: nfse.accessKey, nfseXmlGZipB64: gzipBase64(nfse.xml) } };
    }
    if (req.method === "POST" && /^\/nfse\/\d{50}\/eventos$/.test(req.path)) return { status: 201, body: {} };
    if (req.method === "GET" && /\/eventos\/101101$/.test(req.path)) return { status: 200, body: {} };
    return { status: 404, body: null };
  };
}
