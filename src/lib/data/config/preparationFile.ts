import type { DbClient } from "../clients";
import { DataError, unwrap } from "../errors";

// Arquivo do preparo do exame (C7; cliente, 28/out/2026): PDF, JPG ou PNG até
// 10 MB, enviado pelo WhatsApp como a mensagem do preparo (C7.5). Como os
// documentos do paciente, o arquivo vai do aparelho direto ao armazenamento
// privado por um link de envio de uso único (o limite das funções da Vercel
// não se aplica) e o cadastro do serviço grava onde ele ficou
// (20261102120000_arquivo_do_preparo.sql). Com arquivo, as instruções não vão
// (20261104120000_preparo_arquivo_sem_texto.sql).

export const SERVICE_FILES_BUCKET = "service-files";
export const PREPARATION_FILE_MAX_BYTES = 10 * 1024 * 1024;
const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };
export const PREPARATION_FILE_TYPES = Object.keys(EXTENSION);

export type PreparationFile = { path: string; name: string; type: string; size: number };

export type PreparationFileInput = { fileName: string; mimeType: string; sizeBytes: number };

/** Confere o arquivo escolhido (tipo e tamanho) e limpa o nome. */
export function validatePreparationFile(input: PreparationFileInput): { fileName: string; mimeType: string } {
  if (!EXTENSION[input.mimeType]) {
    throw new DataError("invalid", "Arquivo do preparo: tipo não aceito", { preparation_file: "Envie um PDF ou uma imagem JPG ou PNG." });
  }
  if (!(input.sizeBytes > 0)) throw new DataError("invalid", "Arquivo do preparo: vazio", { preparation_file: "Escolha o arquivo." });
  if (input.sizeBytes > PREPARATION_FILE_MAX_BYTES) {
    throw new DataError("invalid", "Arquivo do preparo: grande demais", { preparation_file: "O arquivo passa de 10 MB. Envie um PDF mais leve ou uma imagem menor." });
  }
  const fileName = (input.fileName.split(/[\\/]/).pop() || "orientacoes").trim().slice(0, 200) || "orientacoes";
  return { fileName, mimeType: input.mimeType };
}

/** "<clínica>/preparo/<id>.<ext>" (a primeira pasta é a clínica: as regras do armazenamento leem dela). */
export function preparationFilePath(clinicId: string, fileId: string, mimeType: string): string {
  return `${clinicId}/preparo/${fileId}.${EXTENSION[mimeType] ?? "bin"}`;
}

/** 1º passo: o link de envio de uso único (o armazenamento recusa sem o papel de Administrador). */
export async function preparePreparationUpload(db: DbClient, clinicId: string, input: PreparationFileInput): Promise<{ path: string; uploadUrl: string }> {
  const valid = validatePreparationFile(input);
  const path = preparationFilePath(clinicId, crypto.randomUUID(), valid.mimeType);
  const { data, error } = await db.storage.from(SERVICE_FILES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    const status = (error as { statusCode?: string; status?: number } | null)?.statusCode ?? (error as { status?: number } | null)?.status;
    if (String(status) === "403" || String(status) === "400") throw new DataError("forbidden", "Arquivo do preparo: sem permissão para anexar");
    throw new DataError("unexpected", `Arquivo do preparo: link de envio não gerado (${error?.message ?? "sem resposta"})`);
  }
  return { path, uploadUrl: data.signedUrl };
}

/**
 * O arquivo que a tela mandou no formulário ("preparation_file", JSON com o
 * caminho, o nome, o tipo e o tamanho): confere a pasta da clínica e que ele
 * chegou ao armazenamento.
 */
export async function receivedPreparationFile(db: DbClient, clinicId: string, raw: string): Promise<PreparationFile> {
  let parsed: Partial<PreparationFile> = {};
  try {
    parsed = JSON.parse(raw) as Partial<PreparationFile>;
  } catch {
    parsed = {};
  }
  const valid = validatePreparationFile({ fileName: String(parsed.name ?? ""), mimeType: String(parsed.type ?? ""), sizeBytes: Number(parsed.size) || 0 });
  const path = String(parsed.path ?? "");
  const folder = `${clinicId}/preparo`;
  const file = path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : "";
  if (!/^[0-9a-f-]{36}\.(pdf|jpg|png)$/.test(file)) throw new DataError("invalid", "Arquivo do preparo: envio não encontrado", { preparation_file: "O arquivo não chegou. Escolha de novo." });
  const { data, error } = await db.storage.from(SERVICE_FILES_BUCKET).list(folder, { search: file, limit: 1 });
  if (error || !data?.some((object) => object.name === file)) {
    throw new DataError("invalid", "Arquivo do preparo: envio não encontrado", { preparation_file: "O arquivo não chegou. Escolha de novo." });
  }
  return { path, name: valid.fileName, type: valid.mimeType, size: Number(parsed.size) };
}

/**
 * Grava (ou tira, com null) o arquivo do preparo do serviço. O banco exige o
 * texto do preparo junto. O arquivo anterior sai do armazenamento (falha aí
 * só deixa um arquivo solto, sem ligação).
 */
export async function setPreparationFile(db: DbClient, clinicId: string, serviceId: string, file: PreparationFile | null): Promise<void> {
  const current = unwrap(
    await db.from("services").select("preparation_file_path").eq("clinic_id", clinicId).eq("id", serviceId).maybeSingle(),
    "Serviço",
  );
  const { error } = await db
    .from("services")
    .update({
      preparation_file_path: file?.path ?? null,
      preparation_file_name: file?.name ?? null,
      preparation_file_type: file?.type ?? null,
      preparation_file_size: file?.size ?? null,
    })
    .eq("clinic_id", clinicId)
    .eq("id", serviceId);
  if (error) {
    if ((error as { code?: string }).code === "23514") {
      throw new DataError("invalid", "Arquivo do preparo: falta o texto", { preparation_instructions: "Com arquivo, escreva a mensagem que vai antes dele." });
    }
    throw new DataError("unexpected", `Arquivo do preparo: ${error.message}`, {}, { cause: error });
  }
  const old = current?.preparation_file_path;
  if (old && old !== file?.path) await db.storage.from(SERVICE_FILES_BUCKET).remove([old]);
}

/** Link temporário para abrir o arquivo (prévia da imagem, "Abrir"). */
export async function preparationFileLink(db: DbClient, path: string): Promise<string | null> {
  const { data } = await db.storage.from(SERVICE_FILES_BUCKET).createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}
