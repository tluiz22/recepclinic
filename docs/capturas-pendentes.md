# Capturas da Central de Ajuda pendentes de recaptura

Fila (cliente, 01/nov/2026). Mudou uma tela que tem captura em `public/ajuda/`: **não rodar o roteiro na hora**. Anotar aqui
a captura e o motivo, avisar o cliente no fim da etapa e esperar a autorização (ele decide se recaptura agora ou depois).

- Formato de cada linha: ``- `nome-da-captura` — o que mudou na tela (dd/mm/aaaa)``. Nomes em `scripts/capturas-ajuda.mjs`.
- Autorizado: `npm run ajuda:capturas -- --pendentes` (com o `npm run dev` no ar) recaptura só as da fila e esvazia esta lista.
- Depois: conferir as imagens, atualizar o texto do artigo se citar o que mudou e rodar `npm test`.

## Pendentes

- `config-horarios` — o menu lateral de Configurações ganhou "Portal" e o texto de ajuda do Serviço, no Novo horário, diz que aparecem só os serviços do local escolhido (10/11/2026). Rodar no local (procura a Dra. Helena Costa do seed); no staging falha
- `config-agendas`, `config-clinica`, `config-convenios`, `config-feriados`, `config-horarios`, `config-lembretes`, `config-locais`, `config-mensagens`, `config-nota-fiscal`, `config-profissionais`, `config-servicos`, `config-whatsapp` — o item "Portal" do menu só aparece com o módulo Portal ligado na clínica; refeitas do staging em 11/11 sem ele (a Clínica Exemplo Saúde do staging está sem o módulo). Refazer se o Portal for ligado nela (F3d, 10/11/2026)
