import { todayIn } from "../../src/lib/clinicTime";
import { getContact, getPatient } from "../../src/lib/data/patients";
import { registerPayment } from "../../src/lib/data/payments";
import { adminClient } from "./helpers";
import { asDb, type AgendaFixture } from "./agendaFixture";

let seq = 0;

/** Atendimento que já aconteceu (compareceu) e o pagamento dele, pela Recepção (N3). */
export async function newPaidAppointment(
  fixture: AgendaFixture,
  input: { payer?: string; payerName?: string; payerCpf?: string; agendaId?: string; serviceId?: string; patientId?: string; amountCents?: number } = {},
) {
  const db = asDb(fixture.reception);
  const patientId = input.patientId ?? fixture.ids.p1;
  const { data: appointment, error } = await adminClient()
    .from("appointments")
    .insert({
      clinic_id: fixture.clinicId,
      patient_id: patientId,
      service_id: input.serviceId ?? fixture.ids.consulta,
      agenda_id: input.agendaId ?? fixture.ids.agendaDra,
      location_id: fixture.ids.office,
      scheduled_at: new Date(Date.UTC(2026, 0, 5, 11, 0) + seq++ * 3_600_000 + Math.floor(Math.random() * 1000) * 86_400_000).toISOString(),
      duration_minutes: 30,
      booking_channel: "admin",
      status: "completed",
    })
    .select("id, status")
    .single();
  if (error) throw error;
  const patient = await getPatient(db, fixture.clinicId, patientId);
  const contact = await getContact(db, fixture.clinicId, patient.contactId);
  const today = todayIn("America/Fortaleza");
  return registerPayment(
    db,
    fixture.clinicId,
    { appointmentId: appointment.id, status: appointment.status, patient, contact, today },
    { amountCents: input.amountCents ?? 30000, method: "pix", paidOn: today, payer: input.payer ?? "contact", payerName: input.payerName, payerCpf: input.payerCpf },
  );
}
