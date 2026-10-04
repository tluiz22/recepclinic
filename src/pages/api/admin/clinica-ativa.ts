import type { APIRoute } from "astro";
import { ACTIVE_CLINIC_COOKIE, activeClinicCookieOptions, isUuid } from "../../../lib/clinicAccess";
import { createUserClient } from "../../../lib/data/clients";
import { loadClinicContext } from "../../../lib/data/clinicContext";

// Troca a clínica ativa (F3.2): campo `clinicId` no formulário. Só aceita
// clínica em que a pessoa é membro, ou qualquer uma para o Suporte. A tela de
// escolha entra na F4.
export const POST: APIRoute = async ({ request, cookies, locals, url, redirect }) => {
  const formData = await request.formData().catch(() => null);
  const clinicId = formData?.get("clinicId")?.toString().toLowerCase();
  if (!isUuid(clinicId) || !locals.userId) {
    return new Response(JSON.stringify({ error: "invalid_clinic" }), { status: 400 });
  }

  const db = createUserClient(request, cookies);
  const result = await loadClinicContext(db, locals.userId, clinicId);
  if (result.status !== "ok" || result.context.clinicId !== clinicId) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  cookies.set(ACTIVE_CLINIC_COOKIE, clinicId, activeClinicCookieOptions(url));
  return redirect("/admin/dashboard", 303);
};
