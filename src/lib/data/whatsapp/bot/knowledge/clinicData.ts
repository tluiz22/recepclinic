import { listNationalHolidays } from "../../../../holidays";
import { unwrap, unwrapOne } from "../../../errors";
import { listClinicHolidays } from "../../../config/holidays";
import { listInsurancePlans } from "../../../config/insurance";
import { listProfessionals } from "../../../config/professionals";
import { getReceptionHours } from "../../../config/receptionHours";
import type { Bot } from "../engine";
import type { KbClinicData } from "./answers";

// Dados da clínica para as respostas da base (BC 3.2). Lidos com a credencial
// da clínica (o RLS só mostra a clínica do token), na hora, sem cache: preço,
// agenda e convênio mudam e a resposta precisa sair do cadastro atual (seção 6
// do plano). Só lido quando a mensagem chega à base (texto que o passo não
// entendeu). Nada do paciente.

export async function loadKbClinicData(b: Bot): Promise<KbClinicData> {
  const insuranceOn = b.features.includes("insurance");
  const [catalog, professionals, plans, exclusions, reception, holidays, settings] = await Promise.all([
    b.catalog(),
    listProfessionals(b.db, b.clinicId),
    insuranceOn ? listInsurancePlans(b.db, b.clinicId) : Promise.resolve([]),
    insuranceOn
      ? b.db
          .from("professional_insurance_exclusions")
          .select("professional_id, insurance_plan_id")
          .eq("clinic_id", b.clinicId)
          .then((r) => unwrap(r, "Planos não atendidos"))
      : Promise.resolve([]),
    getReceptionHours(b.db, b.clinicId),
    listClinicHolidays(b.db, b.clinicId, b.clinic.today),
    b.db
      .from("clinic_settings")
      .select("website_url, reminder_enabled, reminder_timing, reminder_hour")
      .eq("clinic_id", b.clinicId)
      .maybeSingle()
      .then((r) => unwrapOne(r, "Configuração da clínica")),
  ]);
  const withAgenda = new Set(catalog.services.flatMap((s) => s.agendas.map((a) => a.professionalId)).filter(Boolean));
  const today = b.clinic.today;
  const holidayToday =
    holidays.find((h) => h.date === today)?.description ?? listNationalHolidays(Number(today.slice(0, 4))).find((h) => h.date === today)?.name ?? null;
  return {
    label: b.clinic.label,
    designation: b.clinic.designation,
    receptionAvailable: b.receptionAvailable,
    profile: b.clinic.profile,
    ageLimitYears: b.clinic.ageLimitYears,
    paymentInfo: b.clinic.paymentInfo,
    insuranceInfo: b.clinic.insuranceInfo,
    catalog,
    professionals: professionals.filter((p) => withAgenda.has(p.id)),
    insurance: {
      enabled: insuranceOn,
      plans: plans.filter((p) => p.isActive).map((p) => ({ id: p.id, name: p.name, alternativeNames: p.alternativeNames })),
      exclusions: exclusions.map((x) => ({ professionalId: x.professional_id, planId: x.insurance_plan_id })),
    },
    receptionHours: reception.hours.some(Boolean) ? reception.hours : null,
    holidayToday,
    website: settings.website_url?.trim() || null,
    reminder:
      b.features.includes("reminders") && settings.reminder_enabled
        ? { timing: settings.reminder_timing as "eve" | "same_day", hour: settings.reminder_hour }
        : null,
  };
}
