import type { DbClient } from "../clients";
import { DataError, fromDbError, unwrapOne } from "../errors";
import { logError } from "../../log";

// Fotos do profissional e das pessoas da Equipe (cliente, 08/nov/2026). Nesta
// etapa só o cadastro: a foto é enviada e aparece no próprio cadastro. Bucket
// privado "profile-photos", em "<clinic_id>/profissionais/<id>/<momento>.<ext>"
// ou "<clinic_id>/equipe/<user_id>/<momento>.<ext>" (nome novo a cada envio).
// Quem envia: o Administrador; a do próprio cadastro, o profissional com login
// (RLS do Storage, migração 20270101130000).

export const PHOTO_BUCKET = "profile-photos";
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024; // envio pelo servidor: a Vercel aceita até 4,5 MB por requisição
export const PHOTO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export type PhotoOwner = { kind: "professional"; id: string } | { kind: "member"; id: string };

type PhotoFile = { size: number; type: string; arrayBuffer(): Promise<ArrayBuffer> };

export function validatePhotoFile(file: { size: number; type: string }): void {
  if (file.size === 0) throw new DataError("invalid", "Foto: arquivo vazio", { photo: "O arquivo da foto está vazio." });
  if (!PHOTO_TYPES[file.type]) throw new DataError("invalid", "Foto: formato não aceito", { photo: "A foto precisa ser PNG, JPG ou WebP." });
  if (file.size > PHOTO_MAX_BYTES) throw new DataError("invalid", "Foto: arquivo grande", { photo: "A foto pode ter até 4 MB." });
}

const folderOf = (clinicId: string, owner: PhotoOwner) => `${clinicId}/${owner.kind === "professional" ? "profissionais" : "equipe"}/${owner.id}`;

async function currentPath(db: DbClient, clinicId: string, owner: PhotoOwner): Promise<string | null> {
  const row =
    owner.kind === "professional"
      ? unwrapOne(await db.from("professionals").select("photo_path").eq("clinic_id", clinicId).eq("id", owner.id).maybeSingle(), "Profissional")
      : unwrapOne(await db.from("clinic_members").select("photo_path").eq("clinic_id", clinicId).eq("user_id", owner.id).maybeSingle(), "Pessoa da equipe");
  return row.photo_path;
}

async function savePath(db: DbClient, clinicId: string, owner: PhotoOwner, path: string | null): Promise<void> {
  if (owner.kind === "professional") {
    unwrapOne(
      await db.from("professionals").update({ photo_path: path }).eq("clinic_id", clinicId).eq("id", owner.id).select("id").maybeSingle(),
      "Profissional",
    );
  } else {
    unwrapOne(
      await db.from("clinic_members").update({ photo_path: path }).eq("clinic_id", clinicId).eq("user_id", owner.id).select("user_id").maybeSingle(),
      "Pessoa da equipe",
    );
  }
}

async function removeStored(db: DbClient, path: string | null): Promise<void> {
  if (!path) return;
  // Sobrar um arquivo antigo não atrapalha: só registra.
  const { error } = await db.storage.from(PHOTO_BUCKET).remove([path]);
  if (error) logError("foto: antiga não removida", error, { arquivo: path });
}

/** Envia a foto nova, salva o caminho e apaga a anterior. */
export async function uploadProfilePhoto(db: DbClient, clinicId: string, owner: PhotoOwner, file: PhotoFile): Promise<void> {
  validatePhotoFile(file);
  const previous = await currentPath(db, clinicId, owner);
  const path = `${folderOf(clinicId, owner)}/${Date.now()}.${PHOTO_TYPES[file.type]}`;
  const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (error) {
    const status = Number((error as { statusCode?: string | number }).statusCode);
    if (status === 403 || status === 401 || /row-level security/i.test(error.message)) {
      throw new DataError("forbidden", "Foto: sem permissão", {}, { cause: error });
    }
    throw fromDbError(error, "Foto");
  }
  try {
    await savePath(db, clinicId, owner, path);
  } catch (err) {
    await removeStored(db, path);
    throw err;
  }
  await removeStored(db, previous);
}

/** Tira a foto (o cadastro fica sem). */
export async function removeProfilePhoto(db: DbClient, clinicId: string, owner: PhotoOwner): Promise<void> {
  const previous = await currentPath(db, clinicId, owner);
  await savePath(db, clinicId, owner, null);
  await removeStored(db, previous);
}

/** Link temporário (1 hora) para mostrar a foto; null sem foto ou se o link falhar. */
export async function profilePhotoLink(db: DbClient, clinicId: string, owner: PhotoOwner): Promise<string | null> {
  const path = await currentPath(db, clinicId, owner);
  if (!path) return null;
  const { data, error } = await db.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
  if (error) logError("foto: link não criado", error, { arquivo: path });
  return data?.signedUrl ?? null;
}
