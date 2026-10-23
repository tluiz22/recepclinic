import type { ModuloDeAjuda } from "./tipos";

// Ajuda contextual de Configurações (inventário de 23/out/2026).

export const configuracoes = {
  dicas: {
    // D4 em docs/arquitetura.md; prazo do retorno e preparo em configuracoes/servicos/[id].astro.
    servicoTipo: [
      { termo: "Consulta", texto: "atendimento comum." },
      { termo: "Retorno", texto: "volta ligada a uma consulta anterior, com prazo e valor próprios." },
      { termo: "Exame", texto: "pode ter preparo e ser em turma, com vagas por horário." },
    ],
    // Sem o item "Exames e procedimentos" (D11), o tipo Exame não aparece.
    servicoTipoSemExame: [
      { termo: "Consulta", texto: "atendimento comum." },
      { termo: "Retorno", texto: "volta ligada a uma consulta anterior, com prazo e valor próprios." },
    ],
  },
} satisfies ModuloDeAjuda;
