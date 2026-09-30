import type { APIRoute } from "astro";
import { createClient } from "../../../../../../lib/supabase/server";
import { sendAppointmentCancellation } from "../../../../../../lib/whatsapp/notifications";
import { logAppointmentEvent } from "../../../../../../lib/audit";

export const POST: APIRoute = async ({ params, request, cookies, locals }) => {
  const { id: appointmentId } = params;

  if (!appointmentId) {
    return new Response(JSON.stringify({ error: "id é obrigatório" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(request, cookies);

  // Trava atômica (mesmo espírito da Fase 10, em `booking_links`): o UPDATE
  // só afeta a linha se `status` ainda não for 'canceled'. Evita mandar uma
  // segunda notificação quando a tela estava desatualizada e a consulta já
  // tinha sido cancelada por outro canal (ex.: o próprio responsável
  // cancelando pelo bot enquanto a Agenda ainda mostrava a consulta como
  // ativa).
  const { data: appointment } = await supabase
    .from("appointments")
    .update({
      status: "canceled",
      canceled_via: "admin",
      canceled_at: new Date().toISOString(),
      canceled_by: locals.userId ?? null,
    })
    .eq("id", appointmentId)
    .neq("status", "canceled")
    .select(
      "scheduled_at, appointment_type, patients ( full_name, guardians ( id, full_name, phone ) ), clinic_locations ( type ), exam_types ( name )"
    )
    .maybeSingle();

  if (!appointment) {
    return new Response(JSON.stringify({ ok: true, already_canceled: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  await logAppointmentEvent(supabase, {
    appointmentId,
    type: "canceled",
    channel: "admin",
    actorId: locals.userId ?? null,
  });

  // Notificação de cancelamento por WhatsApp (Fase 3a) — melhor esforço.
  const patient = (appointment.patients ?? null) as unknown as {
    full_name: string;
    guardians: { id: string; full_name: string; phone: string } | null;
  } | null;
  const guardian = patient?.guardians ?? null;
  const location = (appointment.clinic_locations ?? null) as unknown as { type: string } | null;
  const examType = (appointment.exam_types ?? null) as unknown as { name: string } | null;

  if (patient && guardian?.phone) {
    await sendAppointmentCancellation({
      supabase,
      appointmentId,
      guardianId: guardian.id,
      guardianPhone: guardian.phone,
      patientName: patient.full_name,
      appointmentType: appointment.appointment_type,
      examName: examType?.name,
      scheduledAt: new Date(appointment.scheduled_at),
      locationType: location?.type,
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
