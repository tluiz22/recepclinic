import type { ModuloDeAjuda } from "./tipos";

// Ajuda contextual do Financeiro (inventário de 23/out/2026).

export const financeiro = {
  dicas: {
    // A nota exige o CPF (pagamento/[id].astro).
    cpfPagador: "Vai na nota fiscal, em nome de quem pagou. Sem CPF, a nota não sai.",
    // public.finance_patients_missing_payer_cpf (migração 20261017120000_falta_cpf.sql): pacientes, não pagamentos;
    // quem paga = o contato ou o próprio paciente (\"Outra pessoa\" não entra).
    faltaCpf:
      "Pacientes em que quem paga (o responsável ou o próprio paciente) ainda não tem CPF no cadastro. Sem esse CPF, a nota não sai, a não ser que o CPF seja digitado no próprio pagamento.",
  },
} satisfies ModuloDeAjuda;
