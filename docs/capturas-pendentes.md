# Capturas da Central de Ajuda pendentes de recaptura

Fila (cliente, 01/nov/2026). Mudou uma tela que tem captura em `public/ajuda/`: **não rodar o roteiro na hora**. Anotar aqui
a captura e o motivo, avisar o cliente no fim da etapa e esperar a autorização (ele decide se recaptura agora ou depois).

- Formato de cada linha: ``- `nome-da-captura` — o que mudou na tela (dd/mm/aaaa)``. Nomes em `scripts/capturas-ajuda.mjs`.
- Autorizado: `npm run ajuda:capturas -- --pendentes` (com o `npm run dev` no ar) recaptura só as da fila e esvazia esta lista.
- Depois: conferir as imagens, atualizar o texto do artigo se citar o que mudou e rodar `npm test`.

## Pendentes

- `config-profissionais` — lista mostra as especialidades e o selo "sem especialidade" (ME, 07/11/2026)
- `config-convenios` — coluna "Quem atende" e o selo "nenhum profissional" (MC, 07/11/2026)
- `config-clinica` — "Informações que o bot responde" virou um aviso apontando para Profissionais (MI, 07/11/2026)
- `config-servicos` — coluna "Profissional" no lugar de "Agendas que atendem" e a busca "De qual profissional?" (MS, S2 e S4, 07/11/2026)
- `marcar` — passo 2 "Com quem" (profissional) antes do serviço (MS, S2, 07/11/2026)
