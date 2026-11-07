import type { DbClient } from "../clients";
import type { Database } from "../../supabase/database.types";
import { unwrap } from "../errors";
import { logError } from "../../log";
import { getSendingSetup } from "./connection";
import { downloadMedia, fetchMediaInfo, type Fetcher } from "./graph";
import { incomingMedia, type IncomingMediaKind, type WaMessage } from "./meta";

// Mídia recebida na Central (CN5; plano em docs/planejamento-central-atendimento.md, seção 6 e decisões 8b e 8c,
// cliente, 05/nov/2026). O webhook só anota o anexo como pendente (o 200 à Meta não espera o download); a rotina de
// cada minuto baixa da Meta (a URL vale 5 minutos e pede o token), confere tipo e tamanho e sobe ao bucket privado
// `whatsapp-media`. Foto, áudio e documento são guardados; vídeo e figurinha só com aviso, sem guardar o arquivo.
// Tudo com a credencial da clínica; com a Central desligada, o banco nem grava o anexo (D12 revista).

export const MEDIA_BUCKET = "whatsapp-media";
const MB = 1024 * 1024;

/** Até quanto a Central guarda (8b e 8c; foto: limite da Meta). Sem limite = não guarda (só o aviso). */
export const MEDIA_LIMITS: Record<IncomingMediaKind, number | null> = {
  image: 5 * MB,
  audio: 16 * MB,
  document: 16 * MB,
  video: null,
  sticker: null,
};

export const MEDIA_ATTEMPTS = 3;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

/** Extensão do arquivo guardado: pelo tipo; sem ele, pelo nome; senão "bin". */
export function mediaExtension(mimeType: string | null, fileName: string | null): string {
  const base = mimeType?.split(";")[0].trim().toLowerCase() ?? "";
  if (EXTENSIONS[base]) return EXTENSIONS[base];
  const fromName = fileName?.match(/\.([A-Za-z0-9]{1,8})$/)?.[1]?.toLowerCase();
  return fromName ?? "bin";
}

/** Tipo da mídia pela mensagem (o `message_type` gravado é o da Meta). */
export function mediaKindOf(messageType: string): IncomingMediaKind | null {
  return messageType === "image" || messageType === "audio" || messageType === "document" || messageType === "video" || messageType === "sticker"
    ? messageType
    : null;
}

/**
 * Anota o anexo da mensagem recebida (ou do eco do app, EC) como pendente e liga à mensagem. Com a Central desligada o banco não grava
 * (nada acontece). Repetida pela Meta: não chega aqui (a mensagem já existia).
 */
export async function queueIncomingMedia(
  db: DbClient,
  clinicId: string,
  messageId: string,
  msg: WaMessage,
  direction: "inbound" | "outbound" = "inbound",
): Promise<string | null> {
  const media = incomingMedia(msg);
  if (!media) return null;
  const rows = unwrap(
    await db
      .from("whatsapp_media")
      .insert({
        clinic_id: clinicId,
        message_id: messageId,
        direction,
        meta_media_id: media.metaId,
        mime_type: media.mimeType?.slice(0, 120) ?? null,
        file_name: media.fileName?.slice(0, 255) ?? null,
        // Figurinha: só o aviso, sem baixar nem perguntar o tamanho.
        status: media.kind === "sticker" ? "unsupported" : "pending",
      })
      .select("id"),
    "Anexo do WhatsApp",
  );
  const id = rows[0]?.id ?? null;
  if (id) unwrap(await db.from("whatsapp_messages").update({ media_id: id }).eq("clinic_id", clinicId).eq("id", messageId), "Anexo do WhatsApp");
  return id;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type MediaUpdate = Database["public"]["Tables"]["whatsapp_media"]["Update"];

export type MediaRunResult = { stored: number; skipped: number; failed: number };

/** Rotina (a cada minuto): baixa os anexos pendentes da clínica, até `limit` por vez (os do paciente e os do histórico do app, CN8). */
export async function processPendingMedia(
  db: DbClient,
  clinicId: string,
  { fetcher = fetch, limit = 10, now = new Date() }: { fetcher?: Fetcher; limit?: number; now?: Date } = {},
): Promise<MediaRunResult> {
  const result: MediaRunResult = { stored: 0, skipped: 0, failed: 0 };
  const pending = unwrap(
    await db
      .from("whatsapp_media")
      .select("id, message_id, meta_media_id, mime_type, file_name, attempts")
      .eq("clinic_id", clinicId)
      .eq("status", "pending")
      .order("created_at")
      .limit(limit),
    "Anexos pendentes",
  );
  if (!pending.length) return result;
  // Sem o WhatsApp conectado (ou sem o token), espera: não conta tentativa.
  const setup = await getSendingSetup(db, clinicId);
  if (!setup) return result;
  const messages = unwrap(
    await db
      .from("whatsapp_messages")
      .select("id, contact_phone, message_type, content_type")
      .eq("clinic_id", clinicId)
      .in(
        "id",
        pending.map((p) => p.message_id).filter((id): id is string => !!id),
      ),
    "Anexos pendentes",
  );
  const messageOf = new Map(messages.map((m) => [m.id, m]));

  for (const item of pending) {
    const update = (values: MediaUpdate) => db.from("whatsapp_media").update(values).eq("clinic_id", clinicId).eq("id", item.id);
    const message = item.message_id ? messageOf.get(item.message_id) : undefined;
    // EC: no eco do app, o tipo do anexo está em content_type (a mensagem segue `agent_reply`).
    const kind = message ? mediaKindOf(message.content_type ?? message.message_type) : null;
    if (!message?.contact_phone || !kind || !item.meta_media_id) {
      await update({ status: "failed", error: "mensagem do anexo não encontrada" });
      result.failed++;
      continue;
    }
    try {
      const info = await fetchMediaInfo(item.meta_media_id, setup.accessToken, fetcher);
      const mimeType = info.mimeType ?? item.mime_type;
      const limit = MEDIA_LIMITS[kind];
      // Vídeo: só o aviso, com o tamanho. Acima do limite: o aviso de arquivo grande (8c).
      if (limit === null || (info.sizeBytes !== null && info.sizeBytes > limit)) {
        await update({ status: limit === null ? "unsupported" : "too_large", size_bytes: info.sizeBytes, mime_type: mimeType, attempts: item.attempts + 1 });
        result.skipped++;
        continue;
      }
      const bytes = await downloadMedia(info.url, setup.accessToken, limit, fetcher);
      const path = `${clinicId}/${message.contact_phone.replace(/\D/g, "")}/${message.id}.${mediaExtension(mimeType, item.file_name)}`;
      const { error } = await db.storage
        .from(MEDIA_BUCKET)
        .upload(path, new Blob([new Uint8Array(bytes)], { type: mimeType ?? "application/octet-stream" }), {
          contentType: mimeType ?? "application/octet-stream",
          upsert: false,
        });
      // Já subido numa execução anterior que caiu antes de marcar: vale o que está lá.
      if (error && !/exists|duplicate/i.test(error.message)) throw error;
      await update({
        status: "stored",
        storage_path: path,
        size_bytes: bytes.byteLength,
        mime_type: mimeType,
        sha256: await sha256Hex(bytes),
        attempts: item.attempts + 1,
        stored_at: now.toISOString(),
        error: null,
      });
      result.stored++;
    } catch (error) {
      const attempts = item.attempts + 1;
      const tooLarge = error instanceof Error && error.message.includes("acima do limite");
      await update({
        status: tooLarge ? "too_large" : attempts >= MEDIA_ATTEMPTS ? "failed" : "pending",
        attempts,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      });
      if (!tooLarge) logError("central: anexo não baixado", error, { clinica: clinicId, anexo: item.id, tentativa: attempts });
      if (tooLarge) result.skipped++;
      else result.failed++;
    }
  }
  return result;
}

/** URL assinada curta (5 min) do arquivo guardado; `download` = baixar com o nome original. */
export async function signedMediaUrl(serviceDb: DbClient, path: string, download: string | null): Promise<string> {
  const { data, error } = await serviceDb.storage.from(MEDIA_BUCKET).createSignedUrl(path, 300, download ? { download } : undefined);
  if (error || !data) throw new Error(`Anexo: ${error?.message ?? "sem URL"}`);
  return data.signedUrl;
}

// ---------------------------------------------------------------------------
// Mídia enviada pela Central (CN6; seção 6 e decisão 8b, cliente, 05/nov/2026)
// ---------------------------------------------------------------------------

/** O que a Central envia: foto JPEG/PNG até 5 MB (limite da Meta para imagem) e PDF até 10 MB. */
export const OUTBOUND_LIMITS: Record<string, number> = {
  "image/jpeg": 5 * MB,
  "image/png": 5 * MB,
  "application/pdf": 10 * MB,
};

export type OutboundCheck = { ok: true; mimeType: string } | { ok: false; message: string };

/** Confere o arquivo escolhido (pelo tipo informado) antes de subir. */
export function checkOutboundFile(mimeType: string, sizeBytes: number): OutboundCheck {
  const limit = OUTBOUND_LIMITS[mimeType];
  if (!limit) return { ok: false, message: "Envie uma foto (JPG ou PNG) ou um PDF." };
  if (!(sizeBytes > 0)) return { ok: false, message: "O arquivo está vazio." };
  if (sizeBytes > limit) return { ok: false, message: mimeType === "application/pdf" ? "O PDF vai até 10 MB." : "A foto vai até 5 MB." };
  return { ok: true, mimeType };
}

/** Tipo real pelo começo do arquivo (não confia no nome nem no que o navegador disse). */
export function sniffMimeType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  return null;
}

/** "<clínica>/<telefone>/env-<chave da tela>.<ext>": a chave liga o arquivo ao envio (o mesmo envio, o mesmo arquivo). */
export function outboundPath(clinicId: string, phone: string, clientKey: string, mimeType: string): string {
  return `${clinicId}/${phone.replace(/\D/g, "")}/env-${clientKey}.${mediaExtension(mimeType, null)}`;
}

/** Link de envio de uso único para o navegador subir o arquivo direto ao bucket (sem passar pela função da Vercel). */
export async function createOutboundUploadUrl(serviceDb: DbClient, path: string): Promise<string> {
  const { data, error } = await serviceDb.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`Anexo: link de envio não gerado (${error?.message ?? "sem resposta"})`);
  return data.signedUrl;
}

/** Lê o arquivo subido e confere tipo e tamanho; fora da regra, apaga. */
export async function readOutboundFile(serviceDb: DbClient, path: string): Promise<{ bytes: Uint8Array; mimeType: string; sha256: string } | { error: string }> {
  const { data, error } = await serviceDb.storage.from(MEDIA_BUCKET).download(path);
  if (error || !data) return { error: "O arquivo não chegou. Tente anexar de novo." };
  const bytes = new Uint8Array(await data.arrayBuffer());
  const mimeType = sniffMimeType(bytes);
  const check = mimeType ? checkOutboundFile(mimeType, bytes.byteLength) : ({ ok: false, message: "Envie uma foto (JPG ou PNG) ou um PDF." } as const);
  if (!check.ok) {
    await serviceDb.storage.from(MEDIA_BUCKET).remove([path]);
    return { error: check.message };
  }
  return { bytes, mimeType: check.mimeType, sha256: await sha256Hex(bytes) };
}

/** Arquivo já guardado de uma mensagem (o "Tentar de novo" sobe de novo à Meta). */
export async function readStoredMedia(serviceDb: DbClient, clinicId: string, mediaId: string): Promise<{ bytes: Uint8Array; mimeType: string; fileName: string | null } | null> {
  const row = unwrap(
    await serviceDb.from("whatsapp_media").select("storage_path, mime_type, file_name, status").eq("clinic_id", clinicId).eq("id", mediaId).maybeSingle(),
    "Anexo",
  );
  if (!row?.storage_path || row.status !== "stored") return null;
  const { data, error } = await serviceDb.storage.from(MEDIA_BUCKET).download(row.storage_path);
  if (error || !data) return null;
  return { bytes: new Uint8Array(await data.arrayBuffer()), mimeType: row.mime_type ?? "application/octet-stream", fileName: row.file_name };
}

// ---------------------------------------------------------------------------
// Prazo de guarda e anonimização (CN7; decisão 8, cliente, 05/nov/2026)
// ---------------------------------------------------------------------------

/** Rotina diária: texto com mais de 5 anos fica nulo; anexo com mais de 12 meses fica "apagado". */
export async function applyConversationRetention(serviceDb: DbClient, clinicId: string, now: Date = new Date()): Promise<{ texts: number; media: number }> {
  const result = unwrap(await serviceDb.rpc("central_retention", { p_clinic_id: clinicId, p_now: now.toISOString() }), "Prazo de guarda") as {
    texts?: number;
    media?: number;
  } | null;
  return { texts: result?.texts ?? 0, media: result?.media ?? 0 };
}

/**
 * Remove do bucket os arquivos dos anexos apagados (prazo de guarda ou anonimização) e os enviados pela Central que
 * não viraram mensagem. O banco não apaga do Storage: lista, remove e confirma.
 */
export async function purgeDeletedMedia(serviceDb: DbClient, clinicId: string): Promise<number> {
  const rows = unwrap(await serviceDb.rpc("central_media_purge_list", { p_clinic_id: clinicId }), "Anexos apagados");
  const paths = [...new Set(rows.map((row) => row.path).filter((path): path is string => !!path))];
  if (!paths.length) return 0;
  const { error } = await serviceDb.storage.from(MEDIA_BUCKET).remove(paths);
  if (error) throw new Error(`Anexos apagados: ${error.message}`);
  unwrap(await serviceDb.rpc("central_media_purged", { p_clinic_id: clinicId, p_paths: paths }), "Anexos apagados");
  return paths.length;
}

// ---------------------------------------------------------------------------
// Histórico do app na conexão (CN8; decisão 10, cliente, 05/nov/2026)
// ---------------------------------------------------------------------------

/** Rotina (a cada minuto): grava as mensagens dos blocos do histórico guardados pelo webhook, alguns por vez. */
export async function processHistoryEvents(serviceDb: DbClient, clinicId: string, limit = 5): Promise<{ events: number; messages: number; media: number }> {
  const result = unwrap(await serviceDb.rpc("central_history_process", { p_clinic_id: clinicId, p_limit: limit }), "Histórico do app") as {
    events?: number;
    messages?: number;
    media?: number;
  } | null;
  return { events: result?.events ?? 0, messages: result?.messages ?? 0, media: result?.media ?? 0 };
}
