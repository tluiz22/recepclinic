import type { AgendaAttendance } from "./data/config/agendas";
import { formChecked, formOptionalInt, formText } from "./forms";

/**
 * Cartão Atendimento (cliente, 08/nov/2026): perfil, prazo e idade limite do formulário. Campo vazio ou inválido vira
 * NaN e cai na validação; idade desmarcada (ou a Equipe, sem o campo) = sem limite.
 */
export function attendanceFromForm(form: FormData | null): AgendaAttendance {
  const ageOn = formChecked(form, "age_limit_on");
  return {
    profile: formText(form, "profile") as AgendaAttendance["profile"],
    bookingHorizonDays: formOptionalInt(form, "booking_horizon_days") ?? Number.NaN,
    consultationAgeLimitYears: ageOn ? (formOptionalInt(form, "age_limit") ?? Number.NaN) : null,
  };
}
