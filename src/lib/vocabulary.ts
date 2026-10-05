import type { Enums } from "./supabase/database.types";

// Vocabulário dos textos pelo perfil da clínica (D4b): quem é atendido e quem
// fala com a clínica. Pediátrica: criança e responsável; Adultos: paciente e
// contato; Mista: paciente e responsável (cliente, 05/out/2026).

export type ClinicProfile = Enums<"clinic_profile">;

export type Vocabulary = {
  /** Quem é atendido: "criança" / "paciente". */
  patient: string;
  patients: string;
  /** Quem fala com a clínica: "responsável" / "contato". */
  contact: string;
  contacts: string;
};

const VOCABULARY: Record<ClinicProfile, Vocabulary> = {
  pediatric: { patient: "criança", patients: "crianças", contact: "responsável", contacts: "responsáveis" },
  adult: { patient: "paciente", patients: "pacientes", contact: "contato", contacts: "contatos" },
  mixed: { patient: "paciente", patients: "pacientes", contact: "responsável", contacts: "responsáveis" },
};

export function vocabularyFor(profile: ClinicProfile): Vocabulary {
  return VOCABULARY[profile];
}

/** Primeira letra maiúscula, para títulos e começo de frase. */
export function capitalize(word: string): string {
  return word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1);
}

export const PROFILE_LABELS: Record<ClinicProfile, string> = {
  pediatric: "Pediátrica",
  adult: "Adultos",
  mixed: "Mista",
};
