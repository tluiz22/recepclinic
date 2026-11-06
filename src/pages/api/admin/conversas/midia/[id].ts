import type { APIRoute } from "astro";
import { isUuid } from "../../../../../lib/clinicAccess";
import { createUserClient } from "../../../../../lib/data/clients";
import { createClinicServiceClient } from "../../../../../lib/data/clinicService";
import { signedMediaUrl } from "../../../../../lib/data/whatsapp/media";
import { logError } from "../../../../../lib/log";

// Anexo da conversa (CN5; plano, seção 6): confere o acesso à conversa e registra a abertura (central_media_access),
// e só então manda para uma URL assinada de 5 minutos do bucket privado. `?baixar=1`: baixa com o nome original.
export const GET: APIRoute = async ({ params, request, cookies, locals, url, redirect }) => {
  const clinic = locals.clinic!;
  const id = params.id ?? "";
  const notFound = () => new Response("Anexo não encontrado.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (!clinic.features.includes("central_attendance") || !isUuid(id)) return notFound();
  const db = createUserClient(request, cookies);
  const { data, error } = await db.rpc("central_media_access", { p_clinic_id: clinic.clinicId, p_media_id: id });
  const media = data?.[0];
  if (error || !media?.storage_path) return notFound();
  try {
    const signed = await signedMediaUrl(createClinicServiceClient(clinic.clinicId), media.storage_path, url.searchParams.get("baixar") === "1" ? (media.file_name ?? "anexo") : null);
    return redirect(signed, 302);
  } catch (failure) {
    logError("central: URL do anexo", failure, { clinica: clinic.clinicId, anexo: id });
    return notFound();
  }
};
