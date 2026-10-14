import { request } from "node:https";
import { gunzipSync, gzipSync } from "node:zlib";
import type { NfseEnvironment } from "./dps";
import type { CertificateKeys } from "./sign";

// Conexão com a Sefin Nacional (F11.4): HTTPS com o certificado A1 da clínica
// (TLS mútuo), JSON com o XML compactado (GZip) em Base64.
//   POST /nfse                    { dpsXmlGZipB64 }                  → nota
//   GET  /dps/{id}                                                   → chave da nota da DPS
//   GET  /nfse/{chave}                                               → nota
//   POST /nfse/{chave}/eventos    { pedidoRegistroEventoXmlGZipB64 } → evento
// Sem resposta (rede, tempo, erro 5xx) o resultado é "unknown": quem chama
// consulta a Receita antes de repetir (segurança da F11, item 5).

export const SEFIN_BASE: Record<Exclude<NfseEnvironment, "simulation">, string> = {
  restricted: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional",
  production: "https://sefin.nfse.gov.br/SefinNacional",
};

const TIMEOUT_MS = 30_000;

export type SefinRequest = { method: "GET" | "POST"; path: string; body?: Record<string, string> };
export type SefinResponse = { status: number; body: unknown };
export type SefinTransport = (environment: NfseEnvironment, keys: CertificateKeys, req: SefinRequest) => Promise<SefinResponse>;

export const gzipBase64 = (xml: string) => gzipSync(Buffer.from(xml, "utf8")).toString("base64");
export const gunzipBase64 = (value: string) => gunzipSync(Buffer.from(value, "base64")).toString("utf8");

/** HTTPS de verdade, com o certificado da clínica. */
export const httpsTransport: SefinTransport = (environment, keys, req) => {
  if (environment === "simulation") return Promise.reject(new Error("Nota simulada não vai para a Receita"));
  return callSefin(new URL(`${SEFIN_BASE[environment]}${req.path}`), keys, req);
};

/** Uma chamada HTTPS com TLS mútuo (`tls` extra só nos testes, para confiar num servidor local). */
export function callSefin(url: URL, keys: CertificateKeys, req: SefinRequest, tls: { ca?: string } = {}): Promise<SefinResponse> {
  return new Promise((resolve, reject) => {
    const payload = req.body ? JSON.stringify(req.body) : undefined;
    const call = request(
      url,
      {
        method: req.method,
        key: keys.keyPem,
        cert: [keys.certPem, ...keys.chainPem].join("\n"),
        ...tls,
        headers: {
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body: unknown = text;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            // Resposta que não é JSON (ex.: página de erro do servidor).
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    call.on("timeout", () => call.destroy(new Error("Tempo esgotado na conexão com a Receita")));
    call.on("error", reject);
    if (payload) call.write(payload);
    call.end();
  });
}

export type SefinError = { code: string; message: string };

const pick = (o: Record<string, unknown>, ...names: string[]) => {
  for (const name of names) {
    const value = o[name] ?? o[name.charAt(0).toUpperCase() + name.slice(1)];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return "";
};

/** Erros da Sefin, em qualquer das formas que ela devolve ({ erros: [...] }, { erro: {...} }, texto). */
export function parseSefinErrors(body: unknown, status: number): SefinError[] {
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    const list = (o.erros ?? o.Erros ?? o.erro ?? o.Erro ?? o.mensagens ?? o.Mensagens) as unknown;
    const items = Array.isArray(list) ? list : list ? [list] : [];
    const errors = items
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => {
        const complement = pick(item, "complemento");
        return {
          code: pick(item, "codigo", "code") || "SEFIN",
          message: [pick(item, "descricao", "mensagem", "message"), complement].filter(Boolean).join(" ") || "Recusado pela Receita.",
        };
      });
    if (errors.length) return errors;
    const message = pick(o, "mensagem", "message", "title", "detail");
    if (message) return [{ code: `HTTP ${status}`, message }];
  }
  if (typeof body === "string" && body.trim()) return [{ code: `HTTP ${status}`, message: body.trim().slice(0, 300) }];
  return [{ code: `HTTP ${status}`, message: "Recusado pela Receita, sem detalhe." }];
}

/** Erros juntos num texto só, para a tela ("E0712: … · E0008: …"). */
export const describeSefinErrors = (errors: SefinError[]) => errors.map((e) => `${e.code}: ${e.message}`).join(" · ");

export type IssueOutcome =
  | { kind: "issued"; accessKey: string; nfseXml: string }
  | { kind: "rejected"; errors: SefinError[] }
  | { kind: "unknown"; message: string };

const isAccessKey = (value: unknown): value is string => typeof value === "string" && /^\d{50}$/.test(value);

/** Envia a DPS assinada. */
export async function sendDps(transport: SefinTransport, environment: NfseEnvironment, keys: CertificateKeys, signedXml: string): Promise<IssueOutcome> {
  let res: SefinResponse;
  try {
    res = await transport(environment, keys, { method: "POST", path: "/nfse", body: { dpsXmlGZipB64: gzipBase64(signedXml) } });
  } catch (error) {
    return { kind: "unknown", message: error instanceof Error ? error.message : "Sem resposta da Receita" };
  }
  if (res.status >= 200 && res.status < 300 && res.body && typeof res.body === "object") {
    const o = res.body as Record<string, unknown>;
    const accessKey = o.chaveAcesso ?? o.ChaveAcesso;
    const xml = o.nfseXmlGZipB64 ?? o.NfseXmlGZipB64;
    if (isAccessKey(accessKey) && typeof xml === "string") return { kind: "issued", accessKey, nfseXml: gunzipBase64(xml) };
    return { kind: "unknown", message: "Resposta da Receita sem a chave da nota" };
  }
  if (res.status >= 400 && res.status < 500) return { kind: "rejected", errors: parseSefinErrors(res.body, res.status) };
  return { kind: "unknown", message: `Receita respondeu ${res.status}` };
}

export type CheckOutcome = { kind: "found"; accessKey: string; nfseXml: string | null } | { kind: "not_found" } | { kind: "unknown"; message: string };

/** Resposta perdida: a Receita gerou nota para esta DPS? */
export async function findNfseByDps(transport: SefinTransport, environment: NfseEnvironment, keys: CertificateKeys, dpsId: string): Promise<CheckOutcome> {
  try {
    const res = await transport(environment, keys, { method: "GET", path: `/dps/${dpsId}` });
    if (res.status === 404) return { kind: "not_found" };
    const o = (res.body ?? {}) as Record<string, unknown>;
    const accessKey = o.chaveAcesso ?? o.ChaveAcesso;
    if (res.status >= 200 && res.status < 300 && isAccessKey(accessKey)) {
      const nfse = await transport(environment, keys, { method: "GET", path: `/nfse/${accessKey}` });
      const n = (nfse.body ?? {}) as Record<string, unknown>;
      const xml = n.nfseXmlGZipB64 ?? n.NfseXmlGZipB64;
      return { kind: "found", accessKey, nfseXml: nfse.status < 300 && typeof xml === "string" ? gunzipBase64(xml) : null };
    }
    return { kind: "unknown", message: `Receita respondeu ${res.status}` };
  } catch (error) {
    return { kind: "unknown", message: error instanceof Error ? error.message : "Sem resposta da Receita" };
  }
}

export type CancelOutcome = { kind: "canceled" } | { kind: "rejected"; errors: SefinError[] } | { kind: "unknown"; message: string };

/** Envia o pedido de cancelamento assinado. */
export async function sendCancel(
  transport: SefinTransport,
  environment: NfseEnvironment,
  keys: CertificateKeys,
  accessKey: string,
  signedXml: string,
): Promise<CancelOutcome> {
  let res: SefinResponse;
  try {
    res = await transport(environment, keys, { method: "POST", path: `/nfse/${accessKey}/eventos`, body: { pedidoRegistroEventoXmlGZipB64: gzipBase64(signedXml) } });
  } catch (error) {
    return { kind: "unknown", message: error instanceof Error ? error.message : "Sem resposta da Receita" };
  }
  if (res.status >= 200 && res.status < 300) return { kind: "canceled" };
  if (res.status >= 400 && res.status < 500) return { kind: "rejected", errors: parseSefinErrors(res.body, res.status) };
  return { kind: "unknown", message: `Receita respondeu ${res.status}` };
}

/** Cancelamento sem resposta: a nota já tem o evento de cancelamento? */
export async function hasCancelEvent(transport: SefinTransport, environment: NfseEnvironment, keys: CertificateKeys, accessKey: string): Promise<boolean | null> {
  try {
    const res = await transport(environment, keys, { method: "GET", path: `/nfse/${accessKey}/eventos/101101` });
    if (res.status === 404) return false;
    return res.status >= 200 && res.status < 300 ? true : null;
  } catch {
    return null;
  }
}
