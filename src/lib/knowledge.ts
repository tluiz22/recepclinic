// Base de Conhecimento Global do bot (cliente, 31/out/2026;
// docs/base-de-conhecimento.md). Listas fechadas que o conteúdo cadastrado
// pelo Suporte pode usar: fontes de dados da clínica, fluxos do bot e termos
// da clínica exigidos na mensagem. São as mesmas das travas da tabela
// `kb_entries` (um teste de banco confere). Fonte nova é código: lê o banco
// só com a credencial da clínica.

export const KB_SOURCES = [
  "clinic",
  "reception_hours",
  "holiday_today",
  "addresses",
  "website",
  "services",
  "professionals",
  "council_registration",
  "prices",
  "payment",
  "insurance",
  "return_visit",
  "preparation",
  "home_visit",
  "age_profile",
  "reminder",
] as const;

export type KbSource = (typeof KB_SOURCES)[number];

export const KB_FLOWS = ["book_consultation", "book_exam", "book_return", "reschedule", "cancel", "confirm", "my_appointments"] as const;

export type KbFlow = (typeof KB_FLOWS)[number];

export const KB_REQUIRED_TERMS = ["service", "professional", "specialty"] as const;

export type KbRequiredTerm = (typeof KB_REQUIRED_TERMS)[number];

export const KB_ANSWER_TYPES = ["template", "source", "flow", "fixed", "reception"] as const;

export type KbAnswerType = (typeof KB_ANSWER_TYPES)[number];

export const KB_STATUSES = ["draft", "approved", "active", "inactive"] as const;

export type KbStatus = (typeof KB_STATUSES)[number];

export const KB_STATUS_LABELS: Record<KbStatus, string> = {
  draft: "Rascunho",
  approved: "Aprovado",
  active: "Ativo",
  inactive: "Inativo",
};
