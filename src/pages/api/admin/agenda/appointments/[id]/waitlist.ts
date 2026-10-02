import type { APIRoute } from "astro";
import { createClient } from "../../../../../../lib/supabase/server";
import { createServiceClient } from "../../../../../../lib/supabase/service";
import { leaveWaitlist } from "../../../../../../lib/waitlist";
import { withdrawPendingOffersFor } from "../../../../../../lib/waitlistOffers";

// Retirar da lista de espera pela tela (Fase 25 · etapa 5) — aba "Lista de
// espera" de Consultas e selo da Agenda. Grava quem retirou (login) e, se
// havia uma vaga oferecida a essa pessoa, passa a vaga ao próximo da fila na
// hora. Volta pra tela de onde veio (`return_to`, só caminhos do admin).
export const POST: APIRoute = async ({ params, request, cookies, locals, redirect }) => {
  const { id } = params;
  const formData = await request.formData();
  const returnToRaw = formData.get("return_to")?.toString() ?? "";
  const returnTo =
    returnToRaw.startsWith("/admin/") && !returnToRaw.startsWith("//") ? returnToRaw : "/admin/consultas?tab=lista_espera";

  if (!id) return redirect(returnTo);

  const removed = await leaveWaitlist(createClient(request, cookies), id, "admin", locals.userId ?? null);
  // Ofertas e vagas só são gravadas pelo sistema (RLS: leitura na tela).
  if (removed) await withdrawPendingOffersFor(createServiceClient(), id);

  return redirect(returnTo);
};
