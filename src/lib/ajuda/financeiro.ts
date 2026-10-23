import type { ModuloDeAjuda } from "./tipos";

// Ajuda contextual do Financeiro (inventário de 23/out/2026).

export const financeiro = {
  dicas: {
    // F11.6 ("Ficam de fora", src/pages/admin/financeiro/dmed.astro); a nota exige o CPF (pagamento/[id].astro).
    cpfPagador:
      "Vai na nota fiscal e na DMED (a declaração de pagamentos que a clínica entrega à Receita). Sem CPF, a nota não sai e o pagamento fica de fora da DMED.",
    // public.finance_patients_missing_payer_cpf (migração 20261017120000_falta_cpf.sql): pacientes, não pagamentos;
    // quem paga = o contato ou o próprio paciente (\"Outra pessoa\" não entra).
    faltaCpf:
      "Pacientes em que quem paga (o responsável ou o próprio paciente) ainda não tem CPF no cadastro. Sem esse CPF, a nota não sai e os pagamentos ficam de fora da DMED, a não ser que o CPF seja digitado no próprio pagamento.",
  },
  comoFunciona: {
    // F11.6 em docs/plano.md; src/lib/dmed.ts; src/pages/admin/financeiro/dmed.astro.
    dmed: {
      serve: "Declaração anual à Receita com o que cada pessoa pagou à clínica no ano, pelo CPF de quem pagou.",
      como: [
        "Escolha o ano e confira o resumo: quem pagou e quanto.",
        "Pagamentos sem o CPF de quem pagou ficam de fora. Complete o CPF no pagamento para que entrem.",
        "Baixe o arquivo e envie ao contador: ele importa no programa da Receita (PGD Dmed), que confere tudo antes de transmitir.",
      ],
    },
  },
} satisfies ModuloDeAjuda;
