import type { APIRoute } from "astro";
import { createServiceClient } from "../../../../lib/supabase/service";
import { getAvailableSlotsForDate, type AppointmentType } from "../../../../lib/scheduling/getAvailableSlotsForDate";
import { getExamAvailableSlotsForDate } from "../../../../lib/scheduling/getExamAvailableSlotsForDate";
import { getNextAvailableGroupDates, type AvailableGroupSession } from "../../../../lib/scheduling/getNextAvailableGroupDates";
import { isOverlapError } from "../../../../lib/scheduling/overlap";
import { resolveClinicLocationIds, type LocationCategory } from "../../../../lib/scheduling/resolveClinicLocationIds";
import { getBookingLinkLastDate, hasActiveReturnVisit } from "../../../../lib/scheduling/returnVisitDeadline";
import { RESCHEDULE_PRESENCE_RESET } from "../../../../lib/presence";
import {
  sendAppointmentConfirmation,
  sendAppointmentReschedule,
  sendExamPreparation,
} from "../../../../lib/whatsapp/notifications";
import { logWebFunnelEvent, type FunnelLink } from "../../../../lib/whatsapp/funnel";

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const token = params.token;
  const formData = await request.formData();
  const date = formData.get("date")?.toString();
  // O rádio de horário carrega "<iso>|<clinicLocationId>" — o consultório
  // físico específico (entre os que a categoria escolhida engloba) já vem
  // decidido pelo horário escolhido, não é reconferido aqui: revalidamos
  // contra a lista de horários recalculada no servidor e usamos o
  // clinicLocationId QUE ELA devolve, nunca o que o cliente mandou.
  const startParam = formData.get("start")?.toString();
  const startIso = startParam?.split("|")[0];

  const supabase = createServiceClient();

  // Funil (Fase 15): toda volta pra página com erro é uma tentativa de
  // confirmar que falhou — registrada com o motivo, depois que o link já
  // foi carregado (antes disso não há tentativa a que ligar).
  let funnelLink: FunnelLink | null = null;
  const back = async (error: string) => {
    if (funnelLink) await logWebFunnelEvent(supabase, funnelLink, "confirm_failed", { reason: error });
    return redirect(`/agendar/${token}?date=${date ?? ""}&error=${error}`);
  };

  if (!token || !date || !startIso) {
    return back("1");
  }

  const { data: link } = await supabase
    .from("booking_links")
    .select("*, exam_types ( name, duration_minutes, price_cents, preparation_instructions, scheduling_mode )")
    .eq("id", token)
    .maybeSingle();

  // Link inexistente, já usado ou expirado: manda de volta para a página,
  // que mostra o estado certo (usado = confirmação, expirado/inválido = aviso).
  if (!link || link.used_at || new Date(link.expires_at) < new Date()) {
    return redirect(`/agendar/${token}`);
  }
  funnelLink = link;

  const appointmentType = link.appointment_type as AppointmentType;
  const examType = link.exam_types as unknown as {
    name: string;
    duration_minutes: number;
    price_cents: number;
    preparation_instructions: string | null;
    scheduling_mode: string;
  } | null;
  const isGroupExam = appointmentType === "exam" && examType?.scheduling_mode === "group";

  const { data: settings } = await supabase.from("appointment_settings").select("*").eq("id", 1).single();
  if (!settings) {
    return back("1");
  }

  let startDate: Date;
  let resolvedClinicLocationId: string;
  let durationMinutes: number;
  let matchedSession: AvailableGroupSession | undefined;

  if (isGroupExam) {
    // Sem horários ocupados da agenda: revalida a sessão (data+horário fixo) contra
    // a capacidade recalculada agora — mesmo espírito da revalidação de
    // horário individual logo abaixo, só que contando vagas em vez de
    // conflito de agenda. A confirmação final ainda passa pela trava
    // atômica (`book_group_exam_session`/`reschedule_group_exam_session`)
    // mais abaixo — essa aqui é só uma primeira checagem, mais barata.
    const sessions = await getNextAvailableGroupDates({ supabase, examTypeId: link.exam_type_id ?? "" });
    matchedSession = sessions.find(
      (session) => new Date(`${session.date}T${session.startTime}:00-03:00`).toISOString() === startIso
    );
    if (!matchedSession) {
      return back("slot_taken");
    }
    resolvedClinicLocationId = link.clinic_location_id ?? "";
    durationMinutes = examType?.duration_minutes ?? settings.default_appointment_duration_minutes;
    startDate = new Date(`${matchedSession.date}T${matchedSession.startTime}:00-03:00`);
  } else if (appointmentType === "exam") {
    // Exame individual: disponibilidade própria do exame, não a de um local
    // (ver Fase 11).
    const slots = await getExamAvailableSlotsForDate({
      supabase,
      examTypeId: link.exam_type_id ?? "",
      examLocationId: link.clinic_location_id ?? "",
      date,
      examDurationMinutes: examType?.duration_minutes ?? 0,
    });

    const matchedSlot = slots.find((slot) => slot.start.toISOString() === startIso);
    if (!matchedSlot) {
      return back("slot_taken");
    }
    resolvedClinicLocationId = matchedSlot.clinicLocationId;
    durationMinutes = examType?.duration_minutes ?? settings.default_appointment_duration_minutes;
    startDate = matchedSlot.start;
  } else {
    // Consulta/retorno: categoria mesclando todos os consultórios físicos
    // ativos dela (ver "Backlog futuro" no plano) — o horário escolhido
    // decide qual deles atende.
    const clinicLocationIds = await resolveClinicLocationIds(supabase, (link.location_category as LocationCategory) ?? "clinic");

    // Retorno vinculado a uma Consulta (Fase 17): revalida o prazo (a
    // página já não oferece datas depois dele; aqui só impede um POST
    // montado à mão) e "1 retorno por consulta" — o link pode ter sido
    // gerado antes de outro retorno ser marcado pra mesma consulta (outro
    // link, ou a secretária). Na remarcação, o próprio retorno não conta.
    if (appointmentType === "return_visit" && link.origin_appointment_id) {
      const lastDate = await getBookingLinkLastDate(supabase, link);
      if (lastDate && date > lastDate) {
        return back("slot_taken");
      }
      if (await hasActiveReturnVisit(supabase, link.origin_appointment_id, link.appointment_id)) {
        return back("return_used");
      }
    }

    const slots = await getAvailableSlotsForDate({
      supabase,
      clinicLocationIds,
      date,
      appointmentType,
    });

    const matchedSlot = slots.find((slot) => slot.start.toISOString() === startIso);
    if (!matchedSlot) {
      return back("slot_taken");
    }
    resolvedClinicLocationId = matchedSlot.clinicLocationId;
    durationMinutes =
      appointmentType === "return_visit"
        ? settings.default_return_visit_duration_minutes
        : settings.default_appointment_duration_minutes;
    startDate = matchedSlot.start;
  }

  const [{ data: patient }, { data: location }] = await Promise.all([
    supabase
      .from("patients")
      .select("full_name, guardians ( id, full_name, phone )")
      .eq("id", link.patient_id)
      .single(),
    supabase
      .from("clinic_locations")
      .select("type, address, price_first_visit_cents")
      .eq("id", resolvedClinicLocationId)
      .single(),
  ]);

  if (!patient) {
    return back("1");
  }

  const guardian = (patient.guardians ?? null) as unknown as {
    id: string;
    full_name: string;
    phone: string;
  } | null;
  // Endereço do consultório físico (`clinic_locations.address`) — sempre
  // nulo pra domiciliar, que usa o endereço específico do paciente em vez
  // dele (`home_visit_address`, resolvido por branch logo abaixo: do link
  // ao criar, da própria consulta ao remarcar — ver Fase 16 no plano).
  const clinicAddress = location?.address ?? null;
  // Retorno não tem valor próprio — está incluso no valor da consulta
  // anterior (decisão do cliente); `null` aciona esse texto na notificação.
  // Exame tem valor próprio, em exam_types (não em clinic_locations).
  const priceCents =
    appointmentType === "exam" ? examType?.price_cents : appointmentType === "return_visit" ? null : location?.price_first_visit_cents;

  // Trava atômica contra corrida (duplo toque em "Confirmar", conexão
  // lenta): a checagem de `link.used_at` lá em cima não impede duas
  // requisições concorrentes de passarem juntas e criarem duas consultas
  // pro mesmo link. Esse UPDATE condicional só afeta a linha se `used_at`
  // ainda estiver nulo — a segunda requisição a chegar aqui recebe 0 linhas
  // e para, sem duplicar o agendamento.
  const { data: claimedLink } = await supabase
    .from("booking_links")
    .update({ used_at: new Date().toISOString() })
    .eq("id", token)
    .is("used_at", null)
    .select("id")
    .maybeSingle();

  if (!claimedLink) {
    return redirect(`/agendar/${token}`);
  }

  // O horário foi ocupado entre a checagem acima e a gravação (trava da
  // turma ou `appointments_no_overlap`): devolve o link, senão a página o
  // trataria como já usado e o responsável não poderia escolher outro.
  const slotTaken = async () => {
    await supabase.from("booking_links").update({ used_at: null }).eq("id", token);
    return back("slot_taken");
  };

  let appointmentId: string;

  if (link.mode === "reschedule") {
    const { data: appointment } = await supabase
      .from("appointments")
      .select("id, status, scheduled_at, home_visit_address")
      .eq("id", link.appointment_id)
      .single();

    if (!appointment || !["scheduled", "confirmed"].includes(appointment.status)) {
      return back("1");
    }

    appointmentId = appointment.id;
    // O bot sempre reconfirma o endereço ao remarcar um domiciliar (Fase 16)
    // — `link.home_visit_address` é o valor já reconfirmado/corrigido nessa
    // conversa; cai pro que já estava gravado só como rede de segurança
    // (link antigo, ou remarcação de um tipo que não passa por lá).
    const locationAddress = link.home_visit_address ?? appointment.home_visit_address ?? clinicAddress;

    if (isGroupExam && matchedSession) {
      const { error: rpcError } = await supabase.rpc("reschedule_group_exam_session", {
        p_appointment_id: appointment.id,
        p_exam_type_id: link.exam_type_id,
        p_scheduled_at: startDate.toISOString(),
        p_clinic_location_id: resolvedClinicLocationId,
        p_duration_minutes: durationMinutes,
      });
      if (rpcError) {
        return slotTaken();
      }
    } else {
      const { error: updateError } = await supabase
        .from("appointments")
        .update({
          clinic_location_id: resolvedClinicLocationId,
          scheduled_at: startDate.toISOString(),
          duration_minutes: durationMinutes,
          appointment_type: appointmentType,
          home_visit_address: locationAddress && link.location_category === "home_visit" ? locationAddress : null,
        })
        .eq("id", appointment.id);

      if (isOverlapError(updateError)) {
        return slotTaken();
      }
      if (updateError) {
        return back("1");
      }
    }

    // Autoria da remarcação (Fase 17): pelo link do WhatsApp. Zera também o
    // lembrete e a confirmação de presença (Fase 19): a data nova pede outros.
    await supabase
      .from("appointments")
      .update({
        rescheduled_via: "whatsapp_bot",
        rescheduled_by: null,
        rescheduled_at: new Date().toISOString(),
        ...RESCHEDULE_PRESENCE_RESET,
      })
      .eq("id", appointment.id);

    if (guardian?.phone) {
      await sendAppointmentReschedule({
        supabase,
        appointmentId,
        guardianId: guardian.id,
        guardianPhone: guardian.phone,
        patientName: patient.full_name,
        appointmentType,
        examName: examType?.name,
        locationType: location?.type,
        scheduledAt: startDate,
        locationAddress,
      });
    }
  } else {
    // Mesma trava do admin, agora por categoria (consulta/exame são
    // jornadas separadas, set/2026): bloqueia um segundo agendamento futuro
    // do MESMO tipo — duas consultas/retornos, ou o mesmo tipo de exame
    // duas vezes — mas permite consulta e exame simultâneos.
    let duplicateQuery = supabase
      .from("appointments")
      .select("id")
      .eq("patient_id", link.patient_id)
      .in("status", ["scheduled", "confirmed"])
      .gt("scheduled_at", new Date().toISOString());

    duplicateQuery =
      appointmentType === "exam"
        ? duplicateQuery.eq("appointment_type", "exam").eq("exam_type_id", link.exam_type_id ?? "")
        : duplicateQuery.in("appointment_type", ["first_visit", "return_visit"]);

    const { data: existingFutureAppointment } = await duplicateQuery.limit(1).maybeSingle();

    if (existingFutureAppointment) {
      return back("1");
    }

    const locationAddress = link.home_visit_address ?? clinicAddress;

    if (isGroupExam && matchedSession) {
      const { data: newAppointmentId, error: rpcError } = await supabase.rpc("book_group_exam_session", {
        p_exam_type_id: link.exam_type_id,
        p_scheduled_at: startDate.toISOString(),
        p_patient_id: link.patient_id,
        p_clinic_location_id: resolvedClinicLocationId,
        p_duration_minutes: durationMinutes,
        p_booking_channel: "whatsapp_bot",
      });

      if (rpcError || !newAppointmentId) {
        return slotTaken();
      }

      appointmentId = newAppointmentId as string;
    } else {
      const { data: newAppointment, error: insertError } = await supabase
        .from("appointments")
        .insert({
          patient_id: link.patient_id,
          clinic_location_id: resolvedClinicLocationId,
          scheduled_at: startDate.toISOString(),
          duration_minutes: durationMinutes,
          appointment_type: appointmentType,
          exam_type_id: appointmentType === "exam" ? link.exam_type_id : null,
          home_visit_address: link.home_visit_address ?? null,
          origin_appointment_id: appointmentType === "return_visit" ? (link.origin_appointment_id ?? null) : null,
          status: "scheduled",
          booking_channel: "whatsapp_bot",
        })
        .select("id")
        .single();

      if (isOverlapError(insertError)) {
        return slotTaken();
      }
      if (insertError || !newAppointment) {
        return back("1");
      }

      appointmentId = newAppointment.id;
    }

    if (guardian?.phone) {
      await sendAppointmentConfirmation({
        supabase,
        appointmentId,
        guardianId: guardian.id,
        guardianPhone: guardian.phone,
        patientName: patient.full_name,
        appointmentType,
        examName: examType?.name,
        locationType: location?.type,
        scheduledAt: startDate,
        locationAddress,
        priceCents,
      });
    }
  }

  // Preparo do exame logo depois da confirmação/remarcação (Fase 18) — vale
  // pros dois caminhos acima.
  if (appointmentType === "exam" && link.exam_type_id && guardian?.phone) {
    await sendExamPreparation({
      supabase,
      appointmentId,
      guardianId: guardian.id,
      guardianPhone: guardian.phone,
      examTypeId: link.exam_type_id,
    });
  }

  // `used_at` já foi gravado atomicamente acima — só falta guardar a
  // consulta gerada, para a página mostrar a confirmação mesmo se o link
  // for reaberto depois.
  await supabase.from("booking_links").update({ appointment_id: appointmentId }).eq("id", token);

  await logWebFunnelEvent(supabase, link, "confirmed", { appointment_id: appointmentId });

  return redirect(`/agendar/${token}`);
};
