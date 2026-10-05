import type { APIRoute } from "astro";
import { createUserClient } from "../../../../../../lib/data/clients";
import { leaveWaitlist } from "../../../../../../lib/data/waitlist/entries";

// Retirar da lista de espera pela tela (Fase 25 · etapa 5) — aba "Lista de
// espera" de Consultas e selo da Agenda. Grava quem retirou (login). A oferta
// em aberto para essa pessoa é retirada pelo banco e a vaga volta à fila
// (F3.7a, sem service role); oferecer ao próximo é do motor de ofertas.
// Volta pra tela de onde veio (`return_to`, só caminhos do admin).
export const POST: APIRoute = async ({ params, request, cookies, locals, redirect }) => {
  const { id } = params;
  const formData = await request.formData();
  const returnToRaw = formData.get("return_to")?.toString() ?? "";
  const returnTo =
    returnToRaw.startsWith("/admin/") && !returnToRaw.startsWith("//") ? returnToRaw : "/admin/consultas?tab=lista_espera";

  const clinic = locals.clinic;
  if (!id || !clinic) return redirect(returnTo);

  try {
    await leaveWaitlist(createUserClient(request, cookies), clinic.clinicId, id, { channel: "admin", actorId: clinic.userId });
  } catch (error) {
    console.error("[lista de espera] erro ao retirar da lista:", error instanceof Error ? error.message : String(error));
  }

  return redirect(returnTo);
};
