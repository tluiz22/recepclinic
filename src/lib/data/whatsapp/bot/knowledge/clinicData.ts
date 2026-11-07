import { listNationalHolidays } from "../../../../holidays";
import { unwrap, unwrapOne } from "../../../errors";
import { listClinicHolidays } from "../../../config/holidays";
import { listInsurancePlans } from "../../../config/insurance";
import { listProfessionals } from "../../../config/professionals";
import { getReceptionHours } from "../../../config/receptionHours";
import type { DbClient } from "../../../clients";
import { getClinicFeatures } from "../../../features";
import { getWhatsappConnection } from "../../connection";
import type { ClinicSender } from "../../send";
import { clinicLabel, type MessageArticle } from "../../templates";
import { loadCatalog } from "../catalog";
import { loadBotClinic, professionalInfoFor, type Bot } from "../engine";
import { buildScope, scopeCatalog } from "../professionalScope";
import type { KbClinicData } from "./answers";

// Dados da clínica para as respostas da base (BC 3.2). Lidos com a credencial
// da clínica (o RLS só mostra a clínica do token), na hora, sem cache: preço,
// agenda e convênio mudam e a resposta precisa sair do cadastro atual (seção 6
// do plano). Só lido quando a mensagem chega à base (texto que o passo não
// entendeu). Nada do paciente.

/** O que as fontes usam do bot (o testador do Suporte monta o mesmo sem conversa). */
export type KbSourceEnv = Pick<Bot, "db" | "clinicId" | "clinic" | "features" | "receptionAvailable" | "catalog">;

/** Ambiente das fontes sem conversa (testador do Suporte): os mesmos dados que o bot da clínica lê. */
export async function kbSourceEnv(db: DbClient, clinicId: string, now: Date): Promise<KbSourceEnv> {
  const [clinic, settings, features, connection] = await Promise.all([
    db.from("clinics").select("name").eq("id", clinicId).maybeSingle().then((r) => unwrapOne(r, "Clínica")),
    db.from("clinic_settings").select("message_article").eq("clinic_id", clinicId).maybeSingle().then((r) => unwrapOne(r, "Configuração da clínica")),
    getClinicFeatures(db, clinicId),
    getWhatsappConnection(db, clinicId),
  ]);
  const sender = { clinicLabel: clinicLabel(clinic.name, settings.message_article as MessageArticle) } as ClinicSender;
  // Como no bot (MB e MI): na clínica de um profissional, as informações são as dele; com mais de um, nenhuma até a escolha.
  const fullCatalog = await loadCatalog(db, clinicId, features);
  const scope = buildScope(fullCatalog, {});
  const botClinic = await loadBotClinic({ db, clinicId, sender, now });
  return {
    db,
    clinicId,
    clinic: { ...botClinic, ...(await professionalInfoFor(db, clinicId, features, scope.current)) },
    features,
    receptionAvailable: connection?.coexistence ?? false,
    catalog: async () => scopeCatalog(fullCatalog, scope),
  };
}

export async function loadKbClinicData(b: KbSourceEnv): Promise<KbClinicData> {
  const insuranceOn = b.features.includes("insurance");
  const [catalog, professionals, plans, links, reception, holidays, settings] = await Promise.all([
    b.catalog(),
    listProfessionals(b.db, b.clinicId),
    insuranceOn ? listInsurancePlans(b.db, b.clinicId) : Promise.resolve([]),
    insuranceOn
      ? b.db
          .from("professional_insurance_plans")
          .select("professional_id, insurance_plan_id")
          .eq("clinic_id", b.clinicId)
          .then((r) => unwrap(r, "Convênios atendidos"))
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
      links: links.map((x) => ({ professionalId: x.professional_id, planId: x.insurance_plan_id })),
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
