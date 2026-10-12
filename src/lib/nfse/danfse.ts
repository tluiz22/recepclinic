import { DOMParser } from "@xmldom/xmldom";
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import { NFSE_LOGO_PNG_BASE64 } from "./logo";

// DANFSe (F11.5): o PDF da nota, gerado pelo RecepClinic a partir do XML da
// NFS-e, porque a API oficial foi suspensa em 03/08/2026 (NT 008 v1.02,
// SE/CGNFS-e). Segue o modelo do Anexo I da NT: A4 em retrato, uma página,
// borda de 1 ponto e linhas de 0,5; cabeçalho com a logomarca, "DANFSe v2.0",
// o município e o ambiente; QR Code da consulta pública; blocos na ordem da
// NT; campo sem informação com traço; "NFS-e SEM VALIDADE JURÍDICA" em
// vermelho na Produção Restrita; marca d'água "CANCELADA". Só dados do XML.
// Fonte: Helvetica (a Arial e a Microsoft Sans Serif da NT não podem ser
// embutidas por licença; a Helvetica tem as mesmas medidas).

const CM = 28.3465;
const PAGE_W = 21 * CM;
const PAGE_H = 29.7 * CM;
const LEFT = 0.3;
const WIDTH = 20.4;
const COL = WIDTH / 4;
const GRAY = rgb(0.95, 0.95, 0.95);
const BLACK = rgb(0, 0, 0);

export const CONSULTA_PUBLICA = "https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=";

// ---------------------------------------------------------------------------
// Leitura do XML
// ---------------------------------------------------------------------------

type Node = { localName?: string | null; childNodes: ArrayLike<Node>; textContent: string | null; getAttribute?: (name: string) => string | null };

function child(node: Node | null, name: string): Node | null {
  if (!node) return null;
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i];
    if (c.localName === name) return c;
  }
  return null;
}

/** Texto do caminho ("DPS/infDPS/prest/CNPJ"), ou "" se não existir. */
function at(root: Node | null, path: string): string {
  let node = root;
  for (const part of path.split("/")) node = child(node, part);
  return node?.textContent?.trim() ?? "";
}

export type DanfseData = {
  accessKey: string;
  number: string;
  competence: string;
  issuedAt: string;
  dpsNumber: string;
  dpsSeries: string;
  dpsIssuedAt: string;
  emitter: string;
  status: string;
  municipality: string;
  generatorEnvironment: string;
  environment: "1" | "2";
  prest: { doc: string; im: string; phone: string; name: string; city: string; ibgeCep: string; address: string; email: string; simples: string; regimeSn: string };
  toma: { doc: string; im: string; phone: string; name: string; city: string; ibgeCep: string; address: string; email: string } | null;
  service: { code: string; nbs: string; place: string; codeDescription: string; description: string };
  issqn: {
    kind: string;
    incidence: string;
    specialRegime: string;
    immunity: string;
    suspension: string;
    process: string;
    benefit: string;
    benefitCalc: string;
    deductions: string;
    unconditionalDiscount: string;
    base: string;
    rate: string;
    retention: string;
    tax: string;
  };
  federal: { irrf: string; cp: string; social: string; pis: string; cofins: string; socialDescription: string };
  totals: { service: string; unconditional: string; conditional: string; retentions: string; net: string; ibsCbs: string; netWithIbsCbs: string };
  complementary: string;
};

const DASH = "-";
const orDash = (v: string) => (v ? v : DASH);

export const formatDoc = (cnpj: string, cpf: string): string => {
  if (cnpj) return cnpj.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, "$1.$2.$3/$4-$5");
  if (cpf) return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return "";
};
const formatCep = (cep: string) => cep.replace(/^(\d{2})(\d{3})(\d{3})$/, "$1.$2-$3");
/** "150.00" → "R$ 150,00"; vazio → "-". */
export const formatMoney = (value: string): string =>
  value ? Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ") : DASH;
const formatPercent = (value: string) => (value ? `${Number(value).toFixed(2).replace(".", ",")}%` : DASH);
const formatDate = (value: string) => value.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, "$3/$2/$1");
/** "2026-10-12T11:59:00-03:00" → "12/10/2026 11:59:00" (a hora como está no XML, no fuso de lá). */
const formatDateTime = (value: string) => value.replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2}).*$/, "$3/$2/$1 $4");
const join = (...parts: string[]) => parts.filter(Boolean).join(" / ");

const TP_EMIT: Record<string, string> = { "1": "Prestador", "2": "Tomador", "3": "Intermediário" };
const C_STAT: Record<string, string> = { "100": "NFS-e Gerada", "102": "NFS-e de Decisão Judicial", "103": "NFS-e Avulsa", "107": "NFS-e MEI" };
const AMB_GER: Record<string, string> = { "1": "Prefeitura", "2": "Sistema Nacional NFS-e" };
const TP_AMB: Record<string, string> = { "1": "Produção", "2": "Produção Restrita" };
const OP_SIMP: Record<string, string> = { "1": "Não Optante", "2": "Optante - Microempreendedor Individual (MEI)", "3": "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)" };
const REG_AP_SN: Record<string, string> = {
  "1": "Regime de apuração dos tributos federais e municipal pelo Simples Nacional",
  "2": "Regime de apuração dos tributos federais pelo SN e o ISSQN pela NFS-e conforme respectiva legislação municipal",
  "3": "Regime de apuração dos tributos federais e municipal pela NFS-e conforme respectivas legislações federal e municipal",
};
const REG_ESP: Record<string, string> = {
  "0": "Nenhum",
  "1": "Ato Cooperado (Cooperativa)",
  "2": "Estimativa",
  "3": "Microempresa Municipal",
  "4": "Notário ou Registrador",
  "5": "Profissional Autônomo",
  "6": "Sociedade de Profissionais",
  "9": "Outros",
};
const TRIB_ISSQN: Record<string, string> = { "1": "Operação Tributável", "2": "Imunidade", "3": "Exportação de Serviço", "4": "Não Incidência" };
const RET_ISSQN: Record<string, string> = { "1": "Não Retido", "2": "Retido pelo Tomador", "3": "Retido pelo Intermediário" };

const address = (end: Node | null) => [at(end, "xLgr"), at(end, "nro"), at(end, "xCpl"), at(end, "xBairro")].filter(Boolean).join(", ");

/** Os campos do DANFSe, lidos do XML da NFS-e devolvido pela Sefin. */
export function readNfse(xml: string): DanfseData {
  const doc = new DOMParser().parseFromString(xml, "text/xml") as unknown as { documentElement: Node };
  const root = doc.documentElement;
  const inf = root.localName === "infNFSe" ? root : child(root, "infNFSe");
  if (!inf) throw new Error("XML sem infNFSe");
  const dps = child(child(inf, "DPS"), "infDPS");
  const emit = child(inf, "emit");
  const emitEnd = child(emit, "enderNac");
  const prest = child(dps, "prest");
  const toma = child(dps, "toma");
  const tribMun = child(child(child(dps, "valores"), "trib"), "tribMun");
  const totTrib = child(child(child(dps, "valores"), "trib"), "totTrib");
  const uf = at(emitEnd, "UF");

  const tomaEnd = child(toma, "end");
  const tomaNac = child(tomaEnd, "endNac");
  const cTribNac = at(dps, "serv/cServ/cTribNac");
  const totals = (() => {
    const fed = at(totTrib, "vTotTrib/vTotTribFed") || at(totTrib, "pTotTrib/pTotTribFed");
    if (at(totTrib, "pTotTribSN")) return `Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: Simples Nacional: ${formatPercent(at(totTrib, "pTotTribSN"))}`;
    if (fed) {
      const pct = !!at(totTrib, "pTotTrib/pTotTribFed");
      const f = (name: string) => (pct ? formatPercent(at(totTrib, `pTotTrib/p${name}`)) : formatMoney(at(totTrib, `vTotTrib/v${name}`)));
      return `Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: Federais: ${f("TotTribFed")}; Estaduais: ${f("TotTribEst")}; Municipais: ${f("TotTribMun")}`;
    }
    return "Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: Federais: -; Estaduais: -; Municipais: -";
  })();
  const extra = [at(dps, "serv/infoCompl/xInfComp") && `Inf. Cont.: ${at(dps, "serv/infoCompl/xInfComp")}`, at(inf, "xOutInf") && `Inf. A. T. Mun.: ${at(inf, "xOutInf")}`].filter(Boolean);

  return {
    accessKey: (inf.getAttribute?.("Id") ?? "").replace(/^NFS/, ""),
    number: at(inf, "nNFSe"),
    competence: formatDate(at(dps, "dCompet")),
    issuedAt: formatDateTime(at(inf, "dhProc")),
    dpsNumber: at(dps, "nDPS"),
    dpsSeries: at(dps, "serie"),
    dpsIssuedAt: formatDateTime(at(dps, "dhEmi")),
    emitter: TP_EMIT[at(dps, "tpEmit")] ?? at(dps, "tpEmit"),
    status: C_STAT[at(inf, "cStat")] ?? at(inf, "cStat"),
    municipality: join(at(inf, "xLocEmi"), uf),
    generatorEnvironment: AMB_GER[at(inf, "ambGer")] ?? at(inf, "ambGer"),
    environment: at(dps, "tpAmb") === "1" ? "1" : "2",
    prest: {
      doc: formatDoc(at(emit, "CNPJ") || at(prest, "CNPJ"), at(emit, "CPF") || at(prest, "CPF")),
      im: at(emit, "IM") || at(prest, "IM"),
      phone: at(emit, "fone") || at(prest, "fone"),
      name: at(emit, "xNome"),
      city: join(at(inf, "xLocEmi"), uf),
      ibgeCep: join(at(emitEnd, "cMun"), formatCep(at(emitEnd, "CEP"))),
      address: address(emitEnd),
      email: at(emit, "email") || at(prest, "email"),
      simples: OP_SIMP[at(prest, "regTrib/opSimpNac")] ?? "",
      regimeSn: REG_AP_SN[at(prest, "regTrib/regApTribSN")] ?? "",
    },
    toma: toma
      ? {
          doc: formatDoc(at(toma, "CNPJ"), at(toma, "CPF")) || at(toma, "NIF"),
          im: at(toma, "IM"),
          phone: at(toma, "fone"),
          name: at(toma, "xNome"),
          city: "",
          ibgeCep: join(at(tomaNac, "cMun"), formatCep(at(tomaNac, "CEP"))),
          address: address(tomaEnd),
          email: at(toma, "email"),
        }
      : null,
    service: {
      code: join(cTribNac.replace(/^(\d{2})(\d{2})(\d{2})$/, "$1.$2.$3"), at(dps, "serv/cServ/cTribMun")),
      nbs: at(dps, "serv/cServ/cNBS"),
      place: join(at(inf, "xLocPrestacao"), at(dps, "serv/locPrest/cPaisPrestacao") || "BR"),
      codeDescription: at(inf, "xTribMun") || at(inf, "xTribNac"),
      description: at(dps, "serv/cServ/xDescServ"),
    },
    issqn: {
      kind: TRIB_ISSQN[at(tribMun, "tribISSQN")] ?? "",
      incidence: join(at(inf, "xLocIncid"), at(tribMun, "cPaisResult") || "BR"),
      specialRegime: REG_ESP[at(prest, "regTrib/regEspTrib")] ?? "",
      immunity: at(tribMun, "tpImunidade"),
      suspension: at(tribMun, "exigSusp/tpSusp"),
      process: at(tribMun, "exigSusp/nProcesso"),
      benefit: at(inf, "valores/tpBM"),
      benefitCalc: at(inf, "valores/vCalcBM") ? formatMoney(at(inf, "valores/vCalcBM")) : "",
      deductions: at(inf, "valores/vCalcDR") ? formatMoney(at(inf, "valores/vCalcDR")) : "",
      unconditionalDiscount: at(dps, "valores/vDescCondIncond/vDescIncond") ? formatMoney(at(dps, "valores/vDescCondIncond/vDescIncond")) : "",
      base: formatMoney(at(inf, "valores/vBC")),
      rate: formatPercent(at(inf, "valores/pAliqAplic")),
      retention: RET_ISSQN[at(tribMun, "tpRetISSQN")] ?? "",
      tax: formatMoney(at(inf, "valores/vISSQN")),
    },
    federal: {
      irrf: formatMoney(at(dps, "valores/trib/tribFed/vRetIRRF")),
      cp: formatMoney(at(dps, "valores/trib/tribFed/vRetCP")),
      social: formatMoney(at(dps, "valores/trib/tribFed/vRetCSLL")),
      pis: formatMoney(at(dps, "valores/trib/tribFed/piscofins/vPis")),
      cofins: formatMoney(at(dps, "valores/trib/tribFed/piscofins/vCofins")),
      socialDescription: "",
    },
    totals: {
      service: formatMoney(at(dps, "valores/vServPrest/vServ")),
      unconditional: formatMoney(at(dps, "valores/vDescCondIncond/vDescIncond")),
      conditional: formatMoney(at(dps, "valores/vDescCondIncond/vDescCond")),
      retentions: formatMoney(at(inf, "valores/vTotalRet")),
      net: formatMoney(at(inf, "valores/vLiq")),
      ibsCbs: DASH,
      netWithIbsCbs: formatMoney(at(inf, "valores/vLiq")),
    },
    complementary: [...extra, totals].join(" | "),
  };
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

type Fonts = { regular: PDFFont; bold: PDFFont };
type Cell = { label?: string; value: string; span?: number; shaded?: boolean; height?: number };

const y = (cm: number) => PAGE_H - cm * CM;

/** Texto no tamanho que cabe na largura, com reticências (NT 008, item 2.1). */
function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

/** Linhas que cabem na largura (para descrição e informações complementares). */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fit(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`, font, size, maxWidth);
    return kept;
  }
  return lines;
}

/** Só os caracteres que a Helvetica (WinAnsi) desenha. */
const safe = (text: string) => text.normalize("NFC").replace(/[^\x20-\x7E -ÿ–—“”‘’•…€]/g, "?");

class Sheet {
  cursor = LEFT;
  constructor(
    readonly page: PDFPage,
    readonly fonts: Fonts,
  ) {}

  line(x1: number, y1: number, x2: number, y2: number) {
    this.page.drawLine({ start: { x: x1 * CM, y: y(y1) }, end: { x: x2 * CM, y: y(y2) }, thickness: 0.5, color: BLACK });
  }

  shade(x: number, top: number, w: number, h: number) {
    this.page.drawRectangle({ x: x * CM, y: y(top + h), width: w * CM, height: h * CM, color: GRAY });
  }

  text(value: string, x: number, top: number, size: number, bold = false, color = BLACK) {
    this.page.drawText(safe(value), { x: x * CM, y: y(top) - size, size, font: bold ? this.fonts.bold : this.fonts.regular, color });
  }

  /** Título do bloco: faixa cinza, 7 pt, negrito, caixa alta (NT 008, 2.4.1). */
  title(label: string) {
    const h = 0.34;
    this.shade(LEFT, this.cursor, WIDTH, h);
    this.text(label.toUpperCase(), LEFT + 0.1, this.cursor + 0.08, 7, true);
    this.cursor += h;
    this.line(LEFT, this.cursor, LEFT + WIDTH, this.cursor);
  }

  /** Uma linha de campos em 4 colunas: título 6 pt negrito, conteúdo 7 pt (2.4.2 e 2.4.4). */
  row(cells: Cell[], { labelSize = 6, labelCaps = false } = {}) {
    const h = Math.max(...cells.map((c) => c.height ?? 0.63));
    let col = 0;
    for (const cell of cells) {
      const span = cell.span ?? 1;
      const x = LEFT + col * COL;
      const w = span * COL;
      if (cell.shaded) this.shade(x, this.cursor, w, h);
      if (cell.label) this.text(labelCaps ? cell.label.toUpperCase() : cell.label, x + 0.1, this.cursor + 0.06, labelSize, true);
      const valueTop = this.cursor + (cell.label ? 0.32 : 0.12);
      if ((cell.height ?? 0.63) > 0.7) {
        wrap(safe(cell.value), this.fonts.regular, 7, w * CM - 6, Math.floor(((cell.height ?? 0.63) - (cell.label ? 0.32 : 0.12)) / 0.3)).forEach((text, i) =>
          this.text(text, x + 0.1, valueTop + i * 0.3, 7),
        );
      } else {
        this.text(fit(safe(cell.value), this.fonts.regular, 7, w * CM - 6), x + 0.1, valueTop, 7);
      }
      if (col > 0) this.line(x, this.cursor, x, this.cursor + h);
      col += span;
    }
    this.cursor += h;
    this.line(LEFT, this.cursor, LEFT + WIDTH, this.cursor);
  }

  /** Bloco só com o aviso (tomador ausente, destinatário = tomador, intermediário ausente). */
  notice(text: string) {
    this.text(text, LEFT + 0.1, this.cursor + 0.09, 7, true);
    this.cursor += 0.42;
    this.line(LEFT, this.cursor, LEFT + WIDTH, this.cursor);
  }
}

export type DanfseOptions = { canceled?: boolean };

/** PDF do DANFSe (bytes). */
export async function buildDanfse(xml: string, options: DanfseOptions = {}): Promise<Uint8Array> {
  const data = readNfse(xml);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`DANFSe ${data.number}`);
  pdf.setProducer("RecepClinic");
  pdf.setCreator("RecepClinic");
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const s = new Sheet(page, fonts);
  const d = (v: string) => orDash(v);

  // Cabeçalho (2.4.3): logomarca, "DANFSe v2.0" e o ambiente.
  s.shade(LEFT, 0.3, WIDTH, 1.16);
  const logo = await pdf.embedPng(Buffer.from(NFSE_LOGO_PNG_BASE64, "base64"));
  const logoH = 0.85;
  const logoW = Math.min(4, (logo.width / logo.height) * logoH);
  page.drawImage(logo, { x: 0.49 * CM, y: y(0.44 + logoH), width: logoW * CM, height: logoH * CM });
  const center = (text: string, top: number, size: number, color = BLACK) => {
    const w = fonts.bold.widthOfTextAtSize(text, size) / CM;
    s.text(text, 5.41 + (10.19 - w) / 2, top, size, true, color);
  };
  center("DANFSe v2.0", 0.42, 9);
  center("Documento Auxiliar da NFS-e", 0.76, 9);
  if (data.environment === "2") center("NFS-e SEM VALIDADE JURÍDICA", 1.08, 9, rgb(0.9, 0, 0));
  s.text(fit(`Município: ${d(data.municipality)}`, fonts.regular, 8, 4.9 * CM), 15.72, 0.42, 8);
  s.text(`Ambiente gerador: ${d(data.generatorEnvironment)}`, 15.72, 0.85, 6);
  s.text(`Tipo de ambiente: ${TP_AMB[data.environment]}`, 15.72, 1.1, 6);
  s.line(LEFT, 1.46, LEFT + WIDTH, 1.46);
  s.cursor = 1.46;

  // Identificação da NFS-e (2.1.2), títulos em caixa alta 7 pt, e o QR Code à direita.
  const idTop = s.cursor;
  const ident = (cells: Cell[]) => s.row(cells, { labelSize: 7, labelCaps: true });
  ident([{ label: "Chave de Acesso da NFS-e", value: data.accessKey, span: 3 }]);
  ident([
    { label: "Número da NFS-e", value: d(data.number) },
    { label: "Competência da NFS-e", value: d(data.competence) },
    { label: "Data e Hora da Emissão da NFS-e", value: d(data.issuedAt) },
  ]);
  ident([
    { label: "Número da DPS", value: d(data.dpsNumber) },
    { label: "Série da DPS", value: d(data.dpsSeries) },
    { label: "Data e Hora da Emissão da DPS", value: d(data.dpsIssuedAt) },
  ]);
  ident([
    { label: "Emitente da NFS-e", value: d(data.emitter), shaded: true },
    { label: "Situação da NFS-e", value: d(data.status) },
    { label: "Finalidade", value: "NFS-e regular" },
  ]);
  s.line(LEFT + 3 * COL, idTop, LEFT + 3 * COL, s.cursor);
  const qr = QRCode.create(`${CONSULTA_PUBLICA}${data.accessKey}`, { errorCorrectionLevel: "M" });
  const qrSize = 1.52;
  const cell = qrSize / qr.modules.size;
  const qrX = 17.48;
  const qrY = idTop + 0.12;
  for (let r = 0; r < qr.modules.size; r++) {
    for (let c = 0; c < qr.modules.size; c++) {
      if (qr.modules.get(r, c)) page.drawRectangle({ x: (qrX + c * cell) * CM, y: y(qrY + (r + 1) * cell), width: cell * CM + 0.2, height: cell * CM + 0.2, color: BLACK });
    }
  }
  // Complemento do QR Code: 3 linhas, 6 pt, no quadro de 4,72 cm (2.4.3).
  wrap(
    "A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e",
    fonts.regular,
    6,
    4.6 * CM,
    3,
  ).forEach((line, i) => s.text(line, 15.85, qrY + qrSize + 0.1 + i * 0.22, 6));

  s.title("Prestador / Fornecedor");
  s.row([
    { label: "CNPJ / CPF / NIF", value: d(data.prest.doc) },
    { label: "Indicador Municipal (Inscrição)", value: d(data.prest.im) },
    { label: "Telefone", value: d(data.prest.phone) },
    { label: "Município / Sigla UF", value: d(data.prest.city) },
  ]);
  s.row([
    { label: "Nome / Nome Empresarial", value: d(data.prest.name), span: 3 },
    { label: "Código IBGE / CEP", value: d(data.prest.ibgeCep) },
  ]);
  s.row([
    { label: "Endereço", value: d(data.prest.address), span: 2 },
    { label: "E-mail", value: d(data.prest.email), span: 2 },
  ]);
  s.row([
    { label: "Simples Nacional na Data de Competência", value: d(data.prest.simples), span: 2 },
    { label: "Regime de Apuração Tributária pelo SN", value: d(data.prest.regimeSn), span: 2 },
  ]);

  s.title("Tomador / Adquirente");
  if (data.toma) {
    s.row([
      { label: "CNPJ / CPF / NIF", value: d(data.toma.doc) },
      { label: "Indicador Municipal (Inscrição)", value: d(data.toma.im) },
      { label: "Telefone", value: d(data.toma.phone) },
      { label: "Código IBGE / CEP", value: d(data.toma.ibgeCep) },
    ]);
    s.row([
      { label: "Nome / Nome Empresarial", value: d(data.toma.name), span: 2 },
      { label: "Endereço", value: d(data.toma.address) },
      { label: "E-mail", value: d(data.toma.email) },
    ]);
  } else {
    s.notice("TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e");
  }

  s.title("Destinatário da Operação");
  s.notice(data.toma ? "O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO" : "DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e");
  s.title("Intermediário da Operação");
  s.notice("INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e");

  s.title("Serviço Prestado");
  s.row([
    { label: "Código de Tributação Nacional / Municipal", value: d(data.service.code) },
    { label: "Código da NBS", value: d(data.service.nbs) },
    { label: "Local da Prestação / Sigla UF / País", value: d(data.service.place), span: 2 },
  ]);
  s.row([{ value: d(data.service.codeDescription), span: 4, height: 0.42 }]);
  s.row([{ label: "Descrição do Serviço", value: d(data.service.description), span: 4, height: 1.6 }]);

  s.title("Tributação Municipal (ISSQN)");
  s.row([
    { label: "Tipo de Tributação do ISSQN", value: d(data.issqn.kind) },
    { label: "Município / Sigla UF / País da Incidência do ISSQN", value: d(data.issqn.incidence), span: 2 },
    { label: "Regime Especial de Tributação do ISSQN", value: d(data.issqn.specialRegime) },
  ]);
  if (data.issqn.immunity || data.issqn.suspension || data.issqn.process) {
    s.row([
      { label: "Tipo de Imunidade do ISSQN", value: d(data.issqn.immunity) },
      { label: "Suspensão da Exigibilidade do ISSQN", value: d(data.issqn.suspension) },
      { label: "Número Processo Suspensão", value: d(data.issqn.process), span: 2 },
    ]);
  }
  if (data.issqn.benefit || data.issqn.benefitCalc || data.issqn.deductions || data.issqn.unconditionalDiscount) {
    s.row([
      { label: "Benefício Municipal", value: d(data.issqn.benefit) },
      { label: "Cálculo do BM", value: d(data.issqn.benefitCalc) },
      { label: "Total Deduções/Reduções", value: d(data.issqn.deductions) },
      { label: "Desconto Incondicionado", value: d(data.issqn.unconditionalDiscount) },
    ]);
  }
  s.row([
    { label: "BC ISSQN", value: d(data.issqn.base) },
    { label: "Alíquota Aplicada", value: d(data.issqn.rate) },
    { label: "Retenção do ISSQN", value: d(data.issqn.retention) },
    { label: "ISSQN Apurado", value: d(data.issqn.tax) },
  ]);

  s.title("Tributação Federal (Exceto CBS)");
  s.row([
    { label: "IRRF", value: data.federal.irrf },
    { label: "Contribuição Previdenciária - Retida", value: data.federal.cp },
    { label: "Contribuições Sociais - Retidas", value: data.federal.social },
    { label: "PIS - Débito Apuração Própria", value: data.federal.pis },
  ]);
  s.row([
    { label: "COFINS - Débito Apuração Própria", value: data.federal.cofins },
    { label: "Descrição Contrib. Sociais - Retidas", value: d(data.federal.socialDescription), span: 3 },
  ]);

  s.title("Tributação IBS / CBS");
  s.row([
    { label: "CST / cClassTrib", value: DASH },
    { label: "Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF", value: DASH, span: 3 },
  ]);
  s.row([
    { label: "Exclusões e Reduções da Base de Cálculo", value: DASH },
    { label: "Base de Cálculo após Exclusões e Reduções", value: DASH },
    { label: "Red. Alíquota IBS / Red. Alíquota CBS", value: DASH },
    { label: "Alíquota - IBS UF / IBS Mun", value: DASH },
  ]);
  s.row([
    { label: "Alíq. Efetiva Municipal - IBS", value: DASH },
    { label: "Valor Apurado Municipal - IBS", value: DASH },
    { label: "Alíq. Efetiva Estadual - IBS", value: DASH },
    { label: "Valor Apurado Estadual - IBS", value: DASH },
  ]);
  s.row([
    { label: "Valor Total Apurado - IBS", value: DASH },
    { label: "Alíquota - CBS", value: DASH },
    { label: "Alíquota Efetiva - CBS", value: DASH },
    { label: "Valor Total Apurado - CBS", value: DASH },
  ]);

  s.title("Valor Total da NFS-e");
  s.row([
    { label: "Valor da Operação / Serviço", value: data.totals.service },
    { label: "Desconto Incondicionado", value: data.totals.unconditional },
    { label: "Desconto Condicionado", value: data.totals.conditional },
    { label: "Total das Retenções (ISSQN / Federais)", value: data.totals.retentions },
  ]);
  s.row([
    { label: "Valor Líquido da NFS-e", value: data.totals.net },
    { label: "Total do IBS/CBS", value: data.totals.ibsCbs },
    { label: "Valor Líquido da NFS-e + IBS/CBS", value: data.totals.netWithIbsCbs, span: 2, shaded: true },
  ]);

  s.title("Informações Complementares");
  const bottom = 29.7 - 0.3;
  s.row([{ value: data.complementary, span: 4, height: Math.max(0.8, bottom - s.cursor) }]);

  // Borda da página: 1 ponto (2.2.3).
  page.drawRectangle({ x: LEFT * CM, y: y(s.cursor), width: WIDTH * CM, height: (s.cursor - 0.3) * CM, borderColor: BLACK, borderWidth: 1 });

  // Nota cancelada: marca d'água na diagonal, 50 pt ou mais, cinza K35 (2.5.1).
  if (options.canceled) {
    const size = 90;
    const w = fonts.regular.widthOfTextAtSize("CANCELADA", size);
    page.drawText("CANCELADA", {
      x: PAGE_W / 2 - (w / 2) * Math.cos(Math.PI / 4),
      y: PAGE_H / 2 - (w / 2) * Math.sin(Math.PI / 4),
      size,
      font: fonts.regular,
      color: rgb(0.65, 0.65, 0.65),
      rotate: degrees(45),
      opacity: 0.6,
    });
  }

  return pdf.save();
}
