// Regras do cadastro de paciente pela tela (Fase 21), revalidadas no
// servidor — o formulário já esconde/mostra os blocos pela idade, mas não é
// fonte de verdade.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdult } from "./age";
import { todayFortaleza } from "./scheduling/returnVisitDeadline";

export function isValidBirthdate(birthdate: string | undefined): birthdate is string {
  if (!birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return false;
  return birthdate >= "1900-01-01" && birthdate <= todayFortaleza();
}

// Menor de 18 anos precisa de um responsável que é outra pessoa.
export function canBeGuardianSelf(birthdate: string): boolean {
  return isAdult(birthdate, todayFortaleza());
}

// Mensagens de erro das telas de cadastro/edição de paciente, pelo código
// que as rotas mandam em `?error=`.
export const PATIENT_FORM_ERRORS: Record<string, string> = {
  invalid_phone: "Telefone inválido — informe DDD + número, ex.: 84981880777.",
  invalid_birthdate: "Data de nascimento inválida.",
  minor_needs_guardian: "Paciente menor de 18 anos precisa de um responsável (outra pessoa).",
  guardian_required: "Escolha o responsável na lista de resultados ou cadastre um novo.",
  self_exists: "Esse responsável já tem um cadastro como próprio paciente.",
  not_found: "Responsável não encontrado.",
  "1": "Não foi possível salvar. Confira os dados e tente novamente.",
};

export async function getConsultationAgeLimit(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase
    .from("appointment_settings")
    .select("consultation_age_limit_years")
    .eq("id", 1)
    .single();
  return data?.consultation_age_limit_years ?? 14;
}

export function consultationAgeLimitWarning(limitYears: number): string {
  return `Paciente com ${limitYears} anos ou mais: não pode marcar consulta, só exame.`;
}
