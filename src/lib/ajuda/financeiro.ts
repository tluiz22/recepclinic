import type { ModuloDeAjuda } from "./tipos";

// Ajuda contextual do Financeiro (inventário de 23/out/2026).

export const financeiro = {
  dicas: {
    // F11.6 ("Ficam de fora", src/pages/admin/financeiro/dmed.astro) e R8 ("Falta CPF") em docs/plano.md.
    cpfPagador:
      "Vai na nota fiscal e na DMED (a declaração de pagamentos que a clínica entrega à Receita). Sem CPF, o pagamento fica no filtro \"Falta CPF\" e de fora da DMED.",
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
