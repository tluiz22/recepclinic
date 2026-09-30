import type { APIRoute } from "astro";
import { createClient } from "../../../../../../lib/supabase/server";
import { getAvailableSlotsForDate, type AppointmentType } from "../../../../../../lib/scheduling/getAvailableSlotsForDate";
import { getExamAvailableSlotsForDate } from "../../../../../../lib/scheduling/getExamAvailableSlotsForDate";
import { getNextAvailableGroupDates, type AvailableGroupSession } from "../../../../../../lib/scheduling/getNextAvailableGroupDates";
import { isOverlapError } from "../../../../../../lib/scheduling/overlap";
import { resolveClinicLocationIds, type LocationCategory } from "../../../../../../lib/scheduling/resolveClinicLocationIds";
import { getReturnOriginCheck } from "../../../../../../lib/scheduling/returnVisitEligibility";
import { RESCHEDULE_PRESENCE_RESET } from "../../../../../../lib/presence";
import {
  sendAppointmentReschedule,
  sendExamPreparation,
} from "../../../../../../lib/whatsapp/notifications";

export const POST: APIRoute = async ({ params, request, cookies, redirect, locals }) => {
  const { id } = params;
  const formData = await request.formData();
  const locationCategoryRaw = formData.get("location_category")?.toString();
  const date = formData.get("date")?.toString();
  const appointmentTypeRaw = formData.get("appointment_type")?.toString();
  // O rádio de horário carrega "<iso>|<clinicLocationId>" — o local físico
  // específico já vem decidido pelo horário escolhido; revalidamos contra a
  // lista recalculada no servidor e usamos o clinicLocationId QUE ELA devolve.
  const startParam = formData.get("start")?.toString();
  const startIso = startParam?.split("|")[0];
  // Endereço reconfirmado/editado pela secretária ao remarcar um atendimento
  // domiciliar — ver Fase 16 no plano (reconfirma sempre, nunca reaproveita
  // o antigo sem passar pela tela de novo).
  const homeVisitAddress = formData.get("home_visit_address")?.toString().trim() || null;

  const appointmentType: AppointmentType | null =
    appointmentTypeRaw === "first_visit" || appointmentTypeRaw === "return_visit" || appointmentTypeRaw === "exam"
      ? appointmentTypeRaw
      : null;
  const isExam = appointmentType === "exam";
  const locationCategory: LocationCategory = locationCategoryRaw === "home_visit" ? "home_visit" : "clinic";
  const isHomeVisit = !isExam && locationCategory === "home_visit";

  const back = (error: string) =>
    isExam
      ? redirect(`/admin/agenda/remarcar-exame?appointment_id=${id}&date=${date ?? ""}&error=${error}`)
      : redirect(
          `/admin/agenda/remarcar?appointment_id=${id}&location_category=${locationCategory}&date=${date ?? ""}&appointment_type=${appointmentType ?? "first_visit"}&error=${error}`
        );

  if (!id || !date || !startIso || !appointmentType) {
    return back("1");
  }

  if (isHomeVisit && !homeVisitAddress) {
    return back("missing_address");
  }

  const supabase = createClient(request, cookies);

  const { data: appointment } = await supabase
    .from("appointments")
    .select(
      "id, patient_id, status, exam_type_id, scheduled_at, home_visit_address, origin_appointment_id, patients ( full_name, guardians ( id, full_name, phone ) )"
    )
    .eq("id", id)
    .single();

  if (!appointment || !["scheduled", "confirmed"].includes(appointment.status)) {
    return back("1");
  }

  const { data: settings } = await supabase.from("appointment_settings").select("*").eq("id", 1).single();
  if (!settings) {
    return back("1");
  }

  let examName: string | undefined;
  let clinicLocationId: string;
  let startDate: Date;
  let durationMinutes: number;
  let matchedSession: AvailableGroupSession | undefined;
  let isGroupExam = false;

  if (isExam) {
    const { data: examType } = await supabase
      .from("exam_types")
      .select("name, duration_minutes, scheduling_mode")
      .eq("id", appointment.exam_type_id)
      .maybeSingle();
    if (!examType) return back("1");
    examName = examType.name;
    isGroupExam = examType.scheduling_mode === "group";

    const { data: examLocation } = await supabase
      .from("clinic_locations")
      .select("id")
      .eq("type", "exam")
      .eq("is_active", true)
      .maybeSingle();
    if (!examLocation) return back("1");

    if (isGroupExam) {
      // Sem horários ocupados da agenda: revalida a sessão (data+horário fixo)
      // contra a capacidade recalculada agora. A trava de verdade contra
      // duas confirmações simultâneas é a RPC atômica logo abaixo.
      const sessions = await getNextAvailableGroupDates({ supabase, examTypeId: appointment.exam_type_id ?? "" });
      matchedSession = sessions.find(
        (session) => new Date(`${session.date}T${session.startTime}:00-03:00`).toISOString() === startIso
      );
      if (!matchedSession) return back("slot_taken");
      clinicLocationId = examLocation.id;
      durationMinutes = examType.duration_minutes;
      startDate = new Date(`${matchedSession.date}T${matchedSession.startTime}:00-03:00`);
    } else {
      const slots = await getExamAvailableSlotsForDate({
        supabase,
        examTypeId: appointment.exam_type_id ?? "",
        examLocationId: examLocation.id,
        date,
        examDurationMinutes: examType.duration_minutes,
      });
      const matchedSlot = slots.find((slot) => slot.start.toISOString() === startIso);
      if (!matchedSlot) return back("slot_taken");
      clinicLocationId = matchedSlot.clinicLocationId;
      durationMinutes = examType.duration_minutes ?? settings.default_appointment_duration_minutes;
      startDate = matchedSlot.start;
    }
  } else {
    const clinicLocationIds = await resolveClinicLocationIds(supabase, locationCategory);
    const slots = await getAvailableSlotsForDate({ supabase, clinicLocationIds, date, appointmentType });
    const matchedSlot = slots.find((slot) => slot.start.toISOString() === startIso);
    if (!matchedSlot) return back("slot_taken");
    clinicLocationId = matchedSlot.clinicLocationId;
    durationMinutes =
      appointmentType === "return_visit"
        ? settings.default_return_visit_duration_minutes
        : settings.default_appointment_duration_minutes;
    startDate = matchedSlot.start;
  }

  if (isGroupExam && matchedSession) {
    const { error: rpcError } = await supabase.rpc("reschedule_group_exam_session", {
      p_appointment_id: id,
      p_exam_type_id: appointment.exam_type_id,
      p_scheduled_at: startDate.toISOString(),
      p_clinic_location_id: clinicLocationId,
      p_duration_minutes: durationMinutes,
    });
    if (rpcError) {
      return back("slot_taken");
    }
  } else {
    // Retorno (Fase 17): mantém a Consulta de origem já vinculada, ou vincula
    // a última Consulta da criança (retorno antigo, ou Consulta virando
    // retorno). A tela só avisa (prazo, domiciliar, retorno já vinculado),
    // nunca bloqueia. Virou Consulta → sem vínculo.
    const originAppointmentId =
      appointmentType === "return_visit"
        ? ((
            await getReturnOriginCheck(supabase, {
              patientId: appointment.patient_id,
              originAppointmentId: appointment.origin_appointment_id,
              ignoreAppointmentId: id,
            })
          ).origin?.id ?? null)
        : null;

    const { error: updateError } = await supabase
      .from("appointments")
      .update({
        clinic_location_id: clinicLocationId,
        scheduled_at: startDate.toISOString(),
        duration_minutes: durationMinutes,
        appointment_type: appointmentType,
        home_visit_address: isHomeVisit ? homeVisitAddress : null,
        origin_appointment_id: originAppointmentId,
      })
      .eq("id", id);

    if (isOverlapError(updateError)) {
      return back("slot_taken");
    }
    if (updateError) {
      return back("1");
    }
  }

  // Autoria da remarcação (Fase 17) — vale pros dois caminhos acima
  // (sessão de grupo e consulta/exame individual). Zera também o lembrete e
  // a confirmação de presença (Fase 19): a data nova pede outros.
  await supabase
    .from("appointments")
    .update({
      rescheduled_via: "admin",
      rescheduled_by: locals.userId ?? null,
      rescheduled_at: new Date().toISOString(),
      ...RESCHEDULE_PRESENCE_RESET,
    })
    .eq("id", id);

  // Notificação de remarcação por WhatsApp (Fase 3a) — melhor esforço.
  const patient = (appointment.patients ?? null) as unknown as {
    full_name: string;
    guardians: { id: string; full_name: string; phone: string } | null;
  } | null;
  const guardian = patient?.guardians ?? null;

  if (patient && guardian?.phone) {
    const { data: location } = await supabase
      .from("clinic_locations")
      .select("type, address")
      .eq("id", clinicLocationId)
      .single();

    await sendAppointmentReschedule({
      supabase,
      appointmentId: id,
      guardianId: guardian.id,
      guardianPhone: guardian.phone,
      patientName: patient.full_name,
      appointmentType: appointmentType,
      examName: examName,
      scheduledAt: startDate,
      locationType: location?.type,
      locationAddress: isHomeVisit ? homeVisitAddress : (location?.address ?? null),
    });

    // Preparo do exame de novo, com a data nova (Fase 18).
    if (appointmentType === "exam" && appointment.exam_type_id) {
      await sendExamPreparation({
        supabase,
        appointmentId: id,
        guardianId: guardian.id,
        guardianPhone: guardian.phone,
        examTypeId: appointment.exam_type_id,
      });
    }
  }

  return redirect(`/admin/agenda?date=${date}`);
};
