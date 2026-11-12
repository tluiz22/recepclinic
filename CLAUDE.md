# RecepClinic: instruções para o Claude

SaaS multi-clínica (Astro, Supabase, Vercel, WhatsApp/Meta). Responder e documentar em português do Brasil.

**Retomada:** ler `docs/roadmap.md` e, só da frente em andamento, `docs/iniciativas/<frente>/status.md`.
Documentos longos (`docs/plano.md`, `docs/historico.md`, `docs/arquivo/**`) só por `grep`, no trecho necessário.
Índice: `docs/README.md`. Decisões de arquitetura: `docs/arquitetura.md` (D1–D14); mudar só com o cliente.

## Como trabalhar com o cliente

- **Uma etapa por vez.** Concluída: o que foi feito + comandos para validar; **parar até a confirmação explícita**.
- **Nunca decidir negócio sozinho.** Dúvidas uma de cada vez, por AskUserQuestion, com opção recomendada, o termo
  explicado em linguagem simples e um exemplo.
- Commits com a linha `Co-Authored-By` do Claude; push na `main` deste repositório.

## Regras do projeto

- **Piloto** (`tluiz22/site-dra-ana-karina`, remoto `piloto`) é **só leitura**. Sem merge cego: cada mudança dele é
  avaliada em `docs/triagem-piloto.md` (classes A/B/C/D). **Nunca usar do piloto:** banco, agendador/Vault, app da Meta,
  segredos. Exceção (cliente, 20/out): o número do app antigo "Consultório Dra. Ana Karina" é do cliente e pode ser
  número de testes de outra clínica do staging.
- **Branches:** planejamento na `main` (cada frente no seu `status.md`); branch só quando há código, criada da `main`,
  de vida curta. O bloco de retomada (`roadmap.md`) só é editado na `main`. Juntar: skill `juntar-branch`.
- **Jornada do bot:** mudou o caminho do paciente no WhatsApp → atualizar no mesmo commit o fluxograma
  (`.claude/rules/bot-jornada.md`).
- **Capturas da Central de Ajuda:** mudou tela com captura → **não recapturar sozinho** (`.claude/rules/ajuda-capturas.md`).
- **Migrações:** migração no staging antes do código que a lê (`.claude/rules/migracoes.md`).
- **Economia de tokens:** Playwright por etapa só da tela que mudou (suíte inteira antes de juntar e do staging);
  tela pelo snapshot em texto, imagem a 390/1280 só no fim; sem subagentes nem workflows sem pedido; leitura por trecho.
  Fim de etapa confirmada: lembrar `/clear` e `/model sonnet` para tarefa mecânica.

## Procedimentos (skills do projeto)

`iniciar-etapa`, `fechar-etapa`, `juntar-branch`, `publicar` (staging/produção), `recapturar-ajuda`.
Telas novas: skill `frontend-design`; testes de UI: `playwright-ui-form-best-practices`.
