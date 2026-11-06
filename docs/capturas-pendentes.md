# Capturas da Central de Ajuda pendentes de recaptura

Fila (cliente, 01/nov/2026). Mudou uma tela que tem captura em `public/ajuda/`: **não rodar o roteiro na hora**. Anotar aqui
a captura e o motivo, avisar o cliente no fim da etapa e esperar a autorização (ele decide se recaptura agora ou depois).

- Formato de cada linha: ``- `nome-da-captura` — o que mudou na tela (dd/mm/aaaa)``. Nomes em `scripts/capturas-ajuda.mjs`.
- Autorizado: `npm run ajuda:capturas -- --pendentes` (com o `npm run dev` no ar) recaptura só as da fila e esvazia esta lista.
- Depois: conferir as imagens, atualizar o texto do artigo se citar o que mudou e rodar `npm test`.

## Pendentes

- `config-whatsapp` — cartões "Custo da Meta" e "Central de atendimento" (CU4, branch `central-atendimento`; recapturar com a Central pronta) (05/11/2026)
- `config-mensagens` — linha nova "Retomar conversa" nas mensagens da Meta, com a Central liberada (CN4b, branch `central-atendimento`; recapturar com a Central pronta) (05/11/2026)
- `conversas` (nova) — tela Conversas, artigo `central-de-atendimento`: acrescentar a linha em `scripts/capturas-ajuda.mjs` e em `imagens.ts` ao capturar (CN9, branch `central-atendimento`; recapturar com a Central pronta) (05/11/2026)
- `atendimento` — com a Central ligada, Atendimento abre Conversas; a captura atual (sem a Central) segue valendo para quem não tem a Central (CN3a; conferir o texto do artigo) (05/11/2026)
