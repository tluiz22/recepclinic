import type { APIRoute } from "astro";
import { isUuid } from "../../../../lib/clinicAccess";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { setClinicFeatures, setClinicProfessionalLimit } from "../../../../lib/data/features";
import { featuresOfItems } from "../../../../lib/plans";
import { formInt } from "../../../../lib/forms";

// Grava a matriz de acesso de uma clínica (F4.2, D11) e o limite de
// profissionais ativos. Só o Suporte (o middleware confere; o banco confere de
// novo). O limite é conferido antes, para nada ser salvo pela metade.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData().catch(() => null);
  const clinicId = formData?.get("clinicId")?.toString() ?? "";
  if (!isUuid(clinicId)) return redirect("/admin/sistema/matriz?erro=clinica", 303);
  // Aberta pela tela da clínica: a volta continua indo para ela (teste da R10, NAV-06).
  const back = `/admin/sistema/matriz?clinica=${clinicId}${formData?.get("de") === "clinica" ? "&de=clinica" : ""}`;
  // Itens como são vendidos (as métricas e as mensagens personalizadas ligam juntas).
  const keys = featuresOfItems((formData?.getAll("item") ?? []).map(String));
  const limit = formInt(formData, "max_professionals");
  if (!Number.isInteger(limit) || limit < 1) return redirect(`${back}&erro=limite`, 303);
  try {
    const db = createUserClient(request, cookies);
    await setClinicFeatures(db, clinicId, keys);
    await setClinicProfessionalLimit(db, clinicId, limit);
  } catch (error) {
    if (!(error instanceof DataError)) throw error;
    const code = error.code === "not_found" ? "clinica" : error.code === "invalid" ? "dependencia" : "falha";
    return redirect(`${back}&erro=${code}`, 303);
  }
  return redirect(`${back}&salvo=1`, 303);
};
