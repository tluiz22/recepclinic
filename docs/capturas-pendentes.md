# Capturas da Central de Ajuda pendentes de recaptura

Fila (cliente, 01/nov/2026). Mudou uma tela que tem captura em `public/ajuda/`: **não rodar o roteiro na hora**. Anotar aqui
a captura e o motivo, avisar o cliente no fim da etapa e esperar a autorização (ele decide se recaptura agora ou depois).

- Formato de cada linha: ``- `nome-da-captura` — o que mudou na tela (dd/mm/aaaa)``. Nomes em `scripts/capturas-ajuda.mjs`.
- Autorizado: `npm run ajuda:capturas -- --pendentes` (com o `npm run dev` no ar) recaptura só as da fila e esvazia esta lista.
- Depois: conferir as imagens, atualizar o texto do artigo se citar o que mudou e rodar `npm test`.

## Pendentes

- `config-mensagens` — texto padrão de "Link para marcar" mudou para o link do portal, sem o marcador {paciente} (F3b, 09/11/2026)
- `config-mensagens` — Orientações gerais da consulta: o texto diz que não vão na consulta em casa (só se a captura mostrar esse trecho; 10/11/2026)
- `config-agendas`, `config-clinica`, `config-convenios`, `config-feriados`, `config-horarios`, `config-lembretes`, `config-locais`, `config-mensagens`, `config-nota-fiscal`, `config-profissionais`, `config-servicos`, `config-whatsapp` — o menu lateral de Configurações ganhou "Portal" (clínica do seed com o item Portal; F3d, 10/11/2026)
- `config-horarios` — o texto de ajuda do Serviço, no formulário Novo horário, diz que aparecem só os serviços do local escolhido (10/11/2026)
- `resumo-do-dia` — Resumo do dia separado por profissional, com contadores e blocos que abrem e fecham (11/11/2026)
- `agenda-dia` — Agenda › Dia virou a grade por horário (uma coluna por agenda), com Situação e Próximos horários livres (F5a, 10/11/2026); Agenda na largura toda ao lado do menu (bordas, 11/11/2026)
