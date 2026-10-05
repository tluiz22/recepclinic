import type { FeatureKey } from "./features";

// Formulário do pedido de informações (F4.4a, L47; cliente, 05/out/2026): 8
// seções, campos para o que é simples (clínica, locais, profissionais,
// equipe, WhatsApp) e texto livre com exemplo para o que é tabela (serviços,
// dias e horários, feriados). Só aparece o que está liberado para a clínica.
// O Suporte revisa e cadastra; nada entra sozinho na clínica.

export type OnboardingLocation = { name: string; type: "clinic" | "home_visit"; address: string };
export type OnboardingProfessional = {
  name: string;
  profession: string;
  specialty: string;
  council: string;
  councilNumber: string;
  councilState: string;
  whatsapp: string;
  receivesSummary: boolean;
};
export type OnboardingTeamMember = { name: string; email: string; role: "admin" | "professional" | "reception" };

export type OnboardingAnswers = {
  clinic: { name: string; profile: "" | "pediatric" | "adult" | "mixed"; city: string; paymentInfo: string; insuranceInfo: string; notes: string };
  locations: OnboardingLocation[];
  professionals: OnboardingProfessional[];
  services: string;
  schedule: string;
  holidays: string;
  team: OnboardingTeamMember[];
  whatsapp: { number: string; summaryRecipients: string };
};

export const MAX_ROWS = 30;
export const MAX_SHORT = 200;
export const MAX_LONG = 5000;

export function emptyAnswers(): OnboardingAnswers {
  return {
    clinic: { name: "", profile: "", city: "", paymentInfo: "", insuranceInfo: "", notes: "" },
    locations: [],
    professionals: [],
    services: "",
    schedule: "",
    holidays: "",
    team: [],
    whatsapp: { number: "", summaryRecipients: "" },
  };
}

/** O que o formulário mostra, pelos itens liberados (D11). */
export type OnboardingSections = {
  /** Formas de pagamento, convênios e observações: o que o bot responde. */
  botInfo: boolean;
  homeVisit: boolean;
  exams: boolean;
  /** Profissional recebe o resumo; contatos do resumo. */
  dailySummary: boolean;
  /** Seção do WhatsApp (bot, lembrete, lista de espera ou resumo). */
  whatsapp: boolean;
};

export function sectionsFor(features: readonly FeatureKey[]): OnboardingSections {
  const has = (key: FeatureKey) => features.includes(key);
  return {
    botInfo: has("whatsapp_bot"),
    homeVisit: has("home_visit"),
    exams: has("exams"),
    dailySummary: has("daily_summary"),
    whatsapp: has("whatsapp_bot") || has("reminders") || has("waitlist") || has("daily_summary"),
  };
}

/** Exemplos dos campos de texto livre. */
export function examples(sections: OnboardingSections): { services: string; schedule: string; holidays: string } {
  return {
    services: [
      "Consulta – 30 min – R$ 300,00 – Consultório Centro",
      "Retorno – 20 min – sem custo – em até 30 dias",
      ...(sections.exams ? ["Espirometria (exame) – 20 min – R$ 150,00 – preparo: não usar broncodilatador 4h antes"] : []),
    ].join("\n"),
    schedule: ["Dra. Ana – segunda e quarta, 8h às 12h – Consultório Centro", "Dr. Bruno – terça, 14h às 18h"].join("\n"),
    holidays: ["24/12 – recesso", "Aniversário da cidade – 15/08"].join("\n"),
  };
}

const short = (value: FormDataEntryValue | null | undefined) => (value?.toString() ?? "").trim().slice(0, MAX_SHORT);
const long = (value: FormDataEntryValue | null | undefined) =>
  (value?.toString() ?? "").replace(/\r\n/g, "\n").trim().slice(0, MAX_LONG);

/** Linhas repetidas (campos com o mesmo nome, na ordem); linha toda vazia sai. */
function rows<T>(form: FormData, fields: string[], build: (get: (field: string) => string) => T, isEmpty: (row: T) => boolean): T[] {
  const columns = fields.map((field) => form.getAll(field));
  const count = Math.max(0, ...columns.map((column) => column.length));
  const result: T[] = [];
  for (let i = 0; i < count && result.length < MAX_ROWS; i++) {
    const row = build((field) => short(columns[fields.indexOf(field)][i]));
    if (!isEmpty(row)) result.push(row);
  }
  return result;
}

const PROFILES = ["pediatric", "adult", "mixed"] as const;
const ROLES = ["admin", "professional", "reception"] as const;

/** Lê o formulário enviado. Campos de seção não liberada ficam vazios. */
export function parseOnboardingForm(form: FormData, sections: OnboardingSections): OnboardingAnswers {
  const profile = short(form.get("clinic_profile"));
  const answers: OnboardingAnswers = {
    clinic: {
      name: short(form.get("clinic_name")),
      profile: (PROFILES as readonly string[]).includes(profile) ? (profile as OnboardingAnswers["clinic"]["profile"]) : "",
      city: short(form.get("clinic_city")),
      paymentInfo: sections.botInfo ? long(form.get("clinic_payment")) : "",
      insuranceInfo: sections.botInfo ? long(form.get("clinic_insurance")) : "",
      notes: sections.botInfo ? long(form.get("clinic_notes")) : "",
    },
    locations: rows(
      form,
      ["location_name", "location_type", "location_address"],
      (get) => ({
        name: get("location_name"),
        type: sections.homeVisit && get("location_type") === "home_visit" ? "home_visit" : "clinic",
        address: get("location_address"),
      }),
      (row) => !row.name && !row.address,
    ),
    professionals: rows(
      form,
      ["professional_name", "professional_profession", "professional_specialty", "professional_council", "professional_council_number", "professional_council_state", "professional_whatsapp", "professional_summary"],
      (get) => ({
        name: get("professional_name"),
        profession: get("professional_profession"),
        specialty: get("professional_specialty"),
        council: get("professional_council"),
        councilNumber: get("professional_council_number"),
        councilState: get("professional_council_state").toUpperCase().slice(0, 2),
        whatsapp: get("professional_whatsapp"),
        receivesSummary: sections.dailySummary && get("professional_summary") === "sim",
      }),
      (row) => !row.name && !row.profession && !row.whatsapp,
    ),
    services: long(form.get("services")),
    schedule: long(form.get("schedule")),
    holidays: long(form.get("holidays")),
    team: rows(
      form,
      ["team_name", "team_email", "team_role"],
      (get) => {
        const role = get("team_role");
        return {
          name: get("team_name"),
          email: get("team_email").toLowerCase(),
          role: (ROLES as readonly string[]).includes(role) ? (role as OnboardingTeamMember["role"]) : "reception",
        };
      },
      (row) => !row.name && !row.email,
    ),
    whatsapp: {
      number: sections.whatsapp ? short(form.get("whatsapp_number")) : "",
      summaryRecipients: sections.whatsapp && sections.dailySummary ? long(form.get("summary_recipients")) : "",
    },
  };
  return answers;
}

/** Respostas guardadas (podem ser de uma versão anterior do formulário) no formato atual. */
export function normalizeAnswers(raw: unknown): OnboardingAnswers {
  const base = emptyAnswers();
  if (!raw || typeof raw !== "object") return base;
  const data = raw as Partial<OnboardingAnswers>;
  return {
    clinic: { ...base.clinic, ...(data.clinic ?? {}) },
    locations: Array.isArray(data.locations) ? data.locations : [],
    professionals: Array.isArray(data.professionals) ? data.professionals : [],
    services: typeof data.services === "string" ? data.services : "",
    schedule: typeof data.schedule === "string" ? data.schedule : "",
    holidays: typeof data.holidays === "string" ? data.holidays : "",
    team: Array.isArray(data.team) ? data.team : [],
    whatsapp: { ...base.whatsapp, ...(data.whatsapp ?? {}) },
  };
}

/** Problema para enviar ao Suporte (null = pode). Rascunho salva sempre. */
export function submitProblem(answers: OnboardingAnswers): string | null {
  if (!answers.clinic.name) return "Informe ao menos o nome da clínica antes de enviar.";
  return null;
}
