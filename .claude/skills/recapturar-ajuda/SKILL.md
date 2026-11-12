---
name: recapturar-ajuda
description: Recaptura as telas pendentes da Central de Ajuda, depois da autorização do cliente.
---
Só com a autorização do cliente e com `docs/capturas-pendentes.md` não vazio.
1. `npm run dev` no ar; `npm run ajuda:capturas -- --pendentes` (esvazia a fila).
2. Conferir as imagens em `public/ajuda/`; atualizar o texto do artigo se citar o que mudou.
3. `npm test`; commit.
