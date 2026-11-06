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
 * Anota o anexo da mensagem recebida como pendente e liga à mensagem. Com a Central desligada o banco não grava
 * (nada acontece). Repetida pela Meta: não chega aqui (a mensagem já existia).
 */
export async function queueIncomingMedia(db: DbClient, clinicId: string, messageId: string, msg: WaMessage): Promise<string | null> {
  const media = incomingMedia(msg);
  if (!media) return null;
  const rows = unwrap(
    await db
      .from("whatsapp_media")
      .insert({
        clinic_id: clinicId,
        message_id: messageId,
        direction: "inbound",
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

/** Rotina (a cada minuto): baixa os anexos pendentes da clínica, até `limit` por vez. */
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
      .eq("direction", "inbound")
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
      .select("id, contact_phone, message_type")
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
    const kind = message ? mediaKindOf(message.message_type) : null;
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
