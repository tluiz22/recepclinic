import type { APIRoute } from "astro";
import { createClient } from "../../../../../../lib/supabase/server";
import { logAppointmentEvent } from "../../../../../../lib/audit";
import { sendPreparationIfExam } from "../../../../../../lib/whatsapp/preparationAfterDelivery";

// Confirmação manual de presença (Fase 19): pra quem confirmou por ligação
// ou por texto. Marca ou desfaz `patient_confirmed_at`, gravando quem
// marcou (login da tela) — mesmo padrão de autoria da Fase 17. Não mexe em
// `status` nem em `reminder_response` (esse é só o toque no lembrete).
// Chamado por formulário da Agenda (dia) e do Resumo do dia em Consultas:
// volta pra tela de onde veio (`return_to`).
export const POST: APIRoute = async ({ params, request, cookies, locals, redirect }) => {
  const { id } = params;
  const formData = await request.formData();
  const confirmed = formData.get("confirmed")?.toString() === "1";
  const returnToRaw = formData.get("return_to")?.toString() ?? "";
  // Só caminhos internos do admin — evita redirecionar pra fora.
  const returnTo = returnToRaw.startsWith("/admin/") && !returnToRaw.startsWith("//") ? returnToRaw : "/admin/agenda";
  const withError = `${returnTo}${returnTo.includes("?") ? "&" : "?"}error=presenca`;

  if (!id) return redirect(withError);

  const supabase = createClient(request, cookies);

  // Estado anterior, pra trilha (Fase 22) só registrar mudança de fato — um
  // segundo clique na tela desatualizada não vira evento repetido.
  const { data: before } = await supabase
    .from("appointments")
    .select("patient_confirmed_at")
    .eq("id", id)
    .maybeSingle();

  const { data: updated, error } = await supabase
    .from("appointments")
    .update(
      confirmed
        ? { patient_confirmed_at: new Date().toISOString(), patient_confirmed_by: locals.userId ?? null }
        : { patient_confirmed_at: null, patient_confirmed_by: null }
    )
    .eq("id", id)
    .in("status", ["scheduled", "confirmed"])
    .select("id")
    .maybeSingle();

  if (updated && before && Boolean(before.patient_confirmed_at) !== confirmed) {
    await logAppointmentEvent(supabase, {
      appointmentId: id,
      type: confirmed ? "presence_confirmed" : "presence_unconfirmed",
      channel: "admin",
      actorId: locals.userId ?? null,
    });
    // Presença confirmada pela tela também envia o preparo do exame (decisão
    // do cliente, 02/out/2026); sem mensagem antes, sai na hora.
    if (confirmed) await sendPreparationIfExam(supabase, id);
  }

  return redirect(error ? withError : returnTo);
};
