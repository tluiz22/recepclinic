import type { DbClient } from "../clients";
import { DataError, fromDbError, unwrapOne } from "../errors";
import { updateClinicSettings } from "./clinic";

// Marca da clínica nas páginas públicas (F5.1, cliente, 05/out/2026): nome,
// logo, cor e site. O logo fica no Storage, bucket público "clinic-logos",
// em "<clinic_id>/logo-<momento>.<ext>" (nome novo a cada envio, para o
// navegador não mostrar o antigo); quem edita os dados da clínica envia e
// remove (RLS do Storage).

export const LOGO_BUCKET = "clinic-logos";
export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
/** Cor das páginas públicas quando a clínica não escolheu uma. */
export const DEFAULT_BRAND_COLOR = "#0369A1";

/** Cores prontas em Configurações › Clínica (cliente, 05/out/2026); "Outra" escolhe qualquer cor. */
export const BRAND_COLOR_OPTIONS: { value: string; label: string }[] = [
  { value: "#0369A1", label: "Azul" },
  { value: "#1E3A8A", label: "Azul-marinho" },
  { value: "#0F766E", label: "Verde-água" },
  { value: "#15803D", label: "Verde" },
  { value: "#7C3AED", label: "Roxo" },
  { value: "#BE185D", label: "Rosa" },
  { value: "#B91C1C", label: "Vermelho" },
  { value: "#C2410C", label: "Laranja" },
  { value: "#A16207", label: "Dourado" },
  { value: "#334155", label: "Grafite" },
];

export type PublicClinicBrand = {
  name: string;
  logoUrl: string | null;
  brandColor: string;
  websiteUrl: string | null;
};

/** Marca para as páginas públicas (cliente de serviço, depois de achar a clínica pelo link). */
export async function getPublicClinicBrand(db: DbClient, clinicId: string): Promise<PublicClinicBrand> {
  const [clinic, settings] = await Promise.all([
    db.from("clinics").select("name").eq("id", clinicId).maybeSingle().then((r) => unwrapOne(r, "Clínica")),
    db
      .from("clinic_settings")
      .select("logo_url, brand_color, website_url")
      .eq("clinic_id", clinicId)
      .maybeSingle()
      .then((r) => unwrapOne(r, "Configuração da clínica")),
  ]);
  return {
    name: clinic.name,
    logoUrl: settings.logo_url,
    brandColor: settings.brand_color ?? DEFAULT_BRAND_COLOR,
    websiteUrl: settings.website_url,
  };
}

export function validateLogoFile(file: { size: number; type: string }): void {
  if (!LOGO_TYPES[file.type]) {
    throw new DataError("invalid", "Logo: formato não aceito", { logo: "O logo precisa ser PNG, JPG ou WebP." });
  }
  if (file.size > LOGO_MAX_BYTES) {
    throw new DataError("invalid", "Logo: arquivo grande", { logo: "O logo pode ter até 1 MB." });
  }
  if (file.size === 0) throw new DataError("invalid", "Logo: arquivo vazio", { logo: "O arquivo do logo está vazio." });
}

/** Caminho do arquivo no bucket a partir do endereço público salvo (null se não for deste bucket). */
export function logoPathFromUrl(url: string | null): string | null {
  const marker = `/storage/v1/object/public/${LOGO_BUCKET}/`;
  const at = url?.indexOf(marker) ?? -1;
  return url && at >= 0 ? decodeURIComponent(url.slice(at + marker.length).split("?")[0]) : null;
}

async function currentLogoUrl(db: DbClient, clinicId: string): Promise<string | null> {
  const row = unwrapOne(
    await db.from("clinic_settings").select("logo_url").eq("clinic_id", clinicId).maybeSingle(),
    "Configuração da clínica",
  );
  return row.logo_url;
}

async function removeStoredLogo(db: DbClient, url: string | null): Promise<void> {
  const path = logoPathFromUrl(url);
  if (!path) return;
  // Sobrar um arquivo antigo não atrapalha a clínica: só registra.
  const { error } = await db.storage.from(LOGO_BUCKET).remove([path]);
  if (error) console.error("Logo antigo não removido", path, error);
}

/** Envia o logo novo, salva o endereço e apaga o anterior. Devolve o endereço público. */
export async function uploadClinicLogo(
  db: DbClient,
  clinicId: string,
  file: { size: number; type: string; arrayBuffer(): Promise<ArrayBuffer> },
): Promise<string> {
  validateLogoFile(file);
  const previous = await currentLogoUrl(db, clinicId);
  const path = `${clinicId}/logo-${Date.now()}.${LOGO_TYPES[file.type]}`;
  const { error } = await db.storage
    .from(LOGO_BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (error) {
    const status = Number((error as { statusCode?: string | number }).statusCode);
    if (status === 403 || status === 401 || /row-level security/i.test(error.message)) {
      throw new DataError("forbidden", "Logo: sem permissão", {}, { cause: error });
    }
    throw fromDbError(error, "Logo");
  }
  const url = db.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
  try {
    await updateClinicSettings(db, clinicId, { logoUrl: url });
  } catch (cause) {
    await db.storage.from(LOGO_BUCKET).remove([path]);
    throw cause;
  }
  await removeStoredLogo(db, previous);
  return url;
}

/** Tira o logo: as páginas públicas voltam a mostrar só o nome. */
export async function removeClinicLogo(db: DbClient, clinicId: string): Promise<void> {
  const previous = await currentLogoUrl(db, clinicId);
  await updateClinicSettings(db, clinicId, { logoUrl: null });
  await removeStoredLogo(db, previous);
}
