// Anonimização de paciente (F9.4, LGPD): o telefone do contato anonimizado
// vira "+00" e 13 dígitos (migração 20261009140000), um número que não existe
// (nenhum código de país começa com 0). O envio pelo WhatsApp recusa esses
// números antes de chamar a Meta.

/** Telefone de contato anonimizado ("+00…", com ou sem o "+"). */
export function isAnonymizedPhone(phone: string): boolean {
  return /^\+?00\d+$/.test(phone.trim());
}

export const ANONYMIZED_PATIENT_NAME = "Paciente anonimizado";
export const ANONYMIZED_CONTACT_NAME = "Contato anonimizado";

/** Nascimento gravado no paciente anonimizado (a coluna é obrigatória). */
export const ANONYMIZED_BIRTHDATE = "1900-01-01";
