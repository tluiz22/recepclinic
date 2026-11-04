# Capturas da Central de Ajuda pendentes de recaptura

Fila (cliente, 01/nov/2026). Mudou uma tela que tem captura em `public/ajuda/`: **não rodar o roteiro na hora**. Anotar aqui
a captura e o motivo, avisar o cliente no fim da etapa e esperar a autorização (ele decide se recaptura agora ou depois).

- Formato de cada linha: ``- `nome-da-captura` — o que mudou na tela (dd/mm/aaaa)``. Nomes em `scripts/capturas-ajuda.mjs`.
- Autorizado: `npm run ajuda:capturas -- --pendentes` (com o `npm run dev` no ar) recaptura só as da fila e esvazia esta lista.
- Depois: conferir as imagens, atualizar o texto do artigo se citar o que mudou e rodar `npm test`.

## Pendentes

- `config-agendas` — o botão "Nova agenda" (ou "Nova agenda da equipe (exames)") agora aparece também quando só falta a agenda da equipe; o link discreto saiu (02/11/2026)
- `config-horarios` — com mais de uma agenda, nenhuma vem escolhida; o roteiro agora abre com `?agenda=` (a Helena do seed) (02/11/2026)
- `config-whatsapp` — o bloco "Forma de pagamento na Meta" (marcação do Suporte) saiu; entrou "Mensagem de teste" com o último envio e o motivo da falha (IS2, 03/11/2026)
- `inicio` — busca com rótulo e borda verde; em "Esperando o paciente", só Confirmar presença, Reenviar lembrete e Remarcar (sem o WhatsApp) (C23, 04/11/2026)
