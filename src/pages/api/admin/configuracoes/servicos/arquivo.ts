import type { APIRoute } from "astro";
import { createUserClient } from "../../../../../lib/data/clients";
import { preparePreparationUpload } from "../../../../../lib/data/config/preparationFile";
import { DataError } from "../../../../../lib/data/errors";
import { describeDataError } from "../../../../../lib/data/formAction";
import { logError } from "../../../../../lib/log";

// Arquivo do preparo do exame (C7): a tela pede o link de envio de uso único,
// manda o arquivo direto ao armazenamento e só então salva o serviço com o
// caminho (o armazenamento recusa sem o papel de Administrador).
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const clinic = locals.clinic!;
  const body = (await request.json().catch(() => null)) as { fileName?: unknown; mimeType?: unknown; sizeBytes?: unknown } | null;
  try {
    const { path, uploadUrl } = await preparePreparationUpload(createUserClient(request, cookies), clinic.clinicId, {
      fileName: String(body?.fileName ?? ""),
      mimeType: String(body?.mimeType ?? ""),
      sizeBytes: Number(body?.sizeBytes) || 0,
    });
    return json(200, { path, uploadUrl });
  } catch (error) {
    if (error instanceof DataError) return json(error.code === "forbidden" ? 403 : 400, { error: describeDataError(error), fields: error.fields });
    logError("serviço: arquivo do preparo", error, { clinica: clinic.clinicId });
    return json(500, { error: "Não enviamos o arquivo por uma falha do sistema, já registrada para o suporte. Tente de novo em instantes." });
  }
};
