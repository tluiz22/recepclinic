# Capturas da Central de Ajuda pendentes de recaptura

Fila (cliente, 01/nov/2026). Mudou uma tela que tem captura em `public/ajuda/`: **não rodar o roteiro na hora**. Anotar aqui
a captura e o motivo, avisar o cliente no fim da etapa e esperar a autorização (ele decide se recaptura agora ou depois).

- Formato de cada linha: ``- `nome-da-captura` — o que mudou na tela (dd/mm/aaaa)``. Nomes em `scripts/capturas-ajuda.mjs`.
- Autorizado: `npm run ajuda:capturas -- --pendentes` (com o `npm run dev` no ar) recaptura só as da fila e esvazia esta lista.
- Depois: conferir as imagens, atualizar o texto do artigo se citar o que mudou e rodar `npm test`.

## Pendentes

- `inicio` — a tela virou Meu dia (linha do dia, "Precisa de você", busca de paciente); o cartão "Comparecimento a registrar" saiu e o roteiro agora espera "Precisa de você" (02/11/2026)
- `pacientes` — as abas viraram Todos, Responsáveis e Para contatar (com contador) (02/11/2026)
- `resumo-do-dia` — a tela passou a se chamar Relatório do dia (título e abas); o nome na captura e no artigo muda (02/11/2026)
- `agenda-dia` — cabeçalho novo: Bloquear, Mais (Bloqueios, Buscar paciente, Relatório do dia) e Marcar consulta; a busca saiu da barra (02/11/2026)
