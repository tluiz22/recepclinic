import type { APIRoute } from "astro";
import { isUuid } from "../../../../lib/clinicAccess";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { setClinicFeatures, setClinicProfessionalLimit } from "../../../../lib/data/features";
import { parseFeatureSelection } from "../../../../lib/features";
import { formInt } from "../../../../lib/forms";

// Grava a matriz de acesso de uma clínica (F4.2, D11) e o limite de
// profissionais ativos. Só o Suporte (o middleware confere; o banco confere de
// novo). O limite é conferido antes, para nada ser salvo pela metade.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData().catch(() => null);
  const clinicId = formData?.get("clinicId")?.toString() ?? "";
  if (!isUuid(clinicId)) return redirect("/admin/sistema/matriz?erro=clinica", 303);
  const keys = parseFeatureSelection((formData?.getAll("feature") ?? []).map(String));
  const limit = formInt(formData, "max_professionals");
  if (!Number.isInteger(limit) || limit < 1) return redirect(`/admin/sistema/matriz?clinica=${clinicId}&erro=limite`, 303);
  try {
    const db = createUserClient(request, cookies);
    await setClinicFeatures(db, clinicId, keys);
    await setClinicProfessionalLimit(db, clinicId, limit);
  } catch (error) {
    if (!(error instanceof DataError)) throw error;
    const code = error.code === "not_found" ? "clinica" : error.code === "invalid" ? "dependencia" : "falha";
    return redirect(`/admin/sistema/matriz?clinica=${clinicId}&erro=${code}`, 303);
  }
  return redirect(`/admin/sistema/matriz?clinica=${clinicId}&salvo=1`, 303);
};
