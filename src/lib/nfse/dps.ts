// DPS e pedido de cancelamento da NFS-e nacional (F11.4), leiaute 1.01 da
// Sefin Nacional (esquemas DPS_v1.01.xsd e pedRegEvento_v1.01.xsd). O XML sai
// sem prefixos de namespace (a Sefin recusa prefixos: E1228) e sem espaços
// entre as tags; a assinatura entra depois (src/lib/nfse/sign.ts).
//
// Regras do cliente (12/out/2026): competência na data do pagamento; tomador
// = quem pagou (CPF e nome); descrição com o tipo, o paciente e a data do
// atendimento, nunca dado clínico; ISS não retido; local da prestação = o
// município da clínica.

export const NFSE_NS = "http://www.sped.fazenda.gov.br/nfse";
export const NFSE_LAYOUT = "1.01";
export const APP_VERSION = "RecepClinic-1.0";

export type NfseEnvironment = "restricted" | "production";

/** O que o banco devolve em begin_nfse_issue. */
export type DpsInput = {
  environment: NfseEnvironment;
  series: string;
  dpsNumber: number;
  dpsId: string;
  /** AAAA-MM-DD (data do pagamento). */
  competence: string;
  amountCents: number;
  payerCpf: string;
  payerName: string;
  patientName: string;
  /** AAAA-MM-DD, no fuso da clínica. */
  appointmentDate: string;
  category: "consultation" | "return_visit" | "exam";
  cnpj: string;
  municipalRegistration: string | null;
  municipalityIbge: string;
  simplesNacional: "not_optant" | "mei" | "me_epp";
  simplesRegime: "1" | "2" | "3" | null;
  /** Percentual aproximado de tributos do Simples (ME/EPP). */
  simplesTotalRate: number | null;
  specialRegime: "none" | "cooperative" | "estimate" | "municipal_micro" | "notary" | "autonomous" | "professional_society";
  /** "04.01.01". */
  serviceCode: string;
  /** Percentual do ISS (0 a 5). */
  issRate: number;
};

const AMBIENTE: Record<NfseEnvironment, string> = { production: "1", restricted: "2" };
const OP_SIMP_NAC = { not_optant: "1", mei: "2", me_epp: "3" } as const;
const REG_ESP_TRIB = {
  none: "0",
  cooperative: "1",
  estimate: "2",
  municipal_micro: "3",
  notary: "4",
  autonomous: "5",
  professional_society: "6",
} as const;
const SERVICE_KIND = { consultation: "Consulta", return_visit: "Consulta de retorno", exam: "Exame" } as const;

/** Texto para dentro do XML: sem caracteres de controle e com &, < e > escapados. */
export function xmlText(value: string, max?: number): string {
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/\s+/g, " ").trim();
  const cut = max ? clean.slice(0, max) : clean;
  return cut.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const el = (tag: string, content: string) => `<${tag}>${content}</${tag}>`;
const opt = (tag: string, content: string | null | undefined) => (content ? el(tag, content) : "");

/** Centavos → "150.00". */
export const money = (cents: number) => (cents / 100).toFixed(2);
/** 2.5 → "2.50". */
export const percent = (value: number) => value.toFixed(2);

/** "Consulta. Paciente: João Souza. Atendimento em 05/10/2026." */
export function serviceDescription(input: Pick<DpsInput, "category" | "patientName" | "appointmentDate">): string {
  const [y, m, d] = input.appointmentDate.split("-");
  return `${SERVICE_KIND[input.category]}. Paciente: ${input.patientName}. Atendimento em ${d}/${m}/${y}.`;
}

/**
 * Data e hora com o fuso (AAAA-MM-DDThh:mm:ss-03:00), um minuto antes de
 * agora: a Sefin recusa emissão "no futuro" por diferença de relógio (E0008).
 */
export function issueDateTime(now: Date, timeZone: string): string {
  const instant = new Date(now.getTime() - 60_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const offset = (parts.timeZoneName as string).replace("GMT", "") || "+00:00";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

/** XML da DPS, sem a assinatura. */
export function buildDps(input: DpsInput, now: Date, timeZone: string): string {
  const meEpp = input.simplesNacional === "me_epp";
  const regTrib =
    el("opSimpNac", OP_SIMP_NAC[input.simplesNacional]) +
    (meEpp && input.simplesRegime ? el("regApTribSN", input.simplesRegime) : "") +
    el("regEspTrib", REG_ESP_TRIB[input.specialRegime]);
  const prest = el("CNPJ", input.cnpj) + opt("IM", input.municipalRegistration ? xmlText(input.municipalRegistration) : null) + el("regTrib", regTrib);
  const toma = el("CPF", input.payerCpf) + el("xNome", xmlText(input.payerName, 300));
  const serv =
    el("locPrest", el("cLocPrestacao", input.municipalityIbge)) +
    el("cServ", el("cTribNac", input.serviceCode.replace(/\D/g, "")) + el("xDescServ", xmlText(serviceDescription(input), 2000)));
  // Alíquota: só a ME/EPP informa (a do Simples); nos outros regimes vale a do município.
  const tribMun = el("tribISSQN", "1") + el("tpRetISSQN", "1") + (meEpp ? el("pAliq", percent(input.issRate)) : "");
  const totTrib = meEpp && input.simplesTotalRate !== null ? el("pTotTribSN", percent(input.simplesTotalRate)) : el("indTotTrib", "0");
  const valores = el("vServPrest", el("vServ", money(input.amountCents))) + el("trib", el("tribMun", tribMun) + el("totTrib", totTrib));

  const inf =
    el("tpAmb", AMBIENTE[input.environment]) +
    el("dhEmi", issueDateTime(now, timeZone)) +
    el("verAplic", APP_VERSION) +
    el("serie", String(Number(input.series))) +
    el("nDPS", String(input.dpsNumber)) +
    el("dCompet", input.competence) +
    el("tpEmit", "1") +
    el("cLocEmi", input.municipalityIbge) +
    el("prest", prest) +
    el("toma", toma) +
    el("serv", serv) +
    el("valores", valores);
  return `<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="${NFSE_NS}" versao="${NFSE_LAYOUT}"><infDPS Id="${input.dpsId}">${inf}</infDPS></DPS>`;
}

export type CancelInput = {
  environment: NfseEnvironment;
  accessKey: string;
  cnpj: string;
  reasonCode: 1 | 2 | 9;
  reasonText: string;
};

/** Pedido de registro do evento de cancelamento (e101101), sem a assinatura. */
export function buildCancelRequest(input: CancelInput, now: Date, timeZone: string): string {
  const id = `PRE${input.accessKey}101101`;
  const inf =
    el("tpAmb", AMBIENTE[input.environment]) +
    el("verAplic", APP_VERSION) +
    el("dhEvento", issueDateTime(now, timeZone)) +
    el("CNPJAutor", input.cnpj) +
    el("chNFSe", input.accessKey) +
    el("e101101", el("xDesc", "Cancelamento de NFS-e") + el("cMotivo", String(input.reasonCode)) + el("xMotivo", xmlText(input.reasonText, 255)));
  return `<?xml version="1.0" encoding="UTF-8"?><pedRegEvento xmlns="${NFSE_NS}" versao="${NFSE_LAYOUT}"><infPedReg Id="${id}">${inf}</infPedReg></pedRegEvento>`;
}

/** Número da nota (nNFSe) no XML da NFS-e devolvido pela Sefin. */
export function nfseNumberOf(xml: string): string | null {
  return xml.match(/<(?:\w+:)?nNFSe>(\d+)<\/(?:\w+:)?nNFSe>/)?.[1] ?? null;
}
