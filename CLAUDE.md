# RecepClinic: instruções para o Claude

Antes de qualquer coisa, leia o bloco **"Estado atual (retomar daqui)"** do `docs/README.md`: ele diz onde
o trabalho parou. Numa frente com arquivo próprio (ex.: o CRM em `docs/crm.md`), leia também o bloco de retomada
dele.

**Para economizar contexto:** na retomada, leia só esses blocos. `docs/plano.md`, `docs/historico.md`,
`docs/analises/crm-arquivo.md` e os demais documentos longos só por busca (`grep`), no trecho necessário. Ao fim de
cada etapa, atualize o bloco de retomada de forma **enxuta** (o que está em cada ambiente e o próximo passo) e
registre o detalhe no plano da frente ou no `historico.md`, nunca no README.

## Como trabalhar com o cliente

- **Uma etapa por vez.** Ao concluir uma etapa: o que foi feito + comandos para o cliente validar no
  terminal, e **parar até a confirmação explícita**. Nunca avançar sozinho.
- **Nunca decidir questões de negócio sozinho.** Dúvidas uma de cada vez, pela ferramenta de
  perguntas (AskUserQuestion), com uma opção recomendada.
- Responder e documentar em português do Brasil.
- Commits com a linha `Co-Authored-By` do Claude; push na `main` deste repositório.

## Regras do projeto

- Este repositório é o **RecepClinic** (SaaS para várias clínicas). O **piloto** (sistema da
  Dra. Ana Karina) fica em `tluiz22/site-dra-ana-karina` e aqui é o remoto `piloto`, **só
  leitura**.
- **Sem merge cego** do piloto: cada mudança dele é avaliada e registrada em
  `docs/triagem-piloto.md` (classes A/B/C/D).
- **Nunca usar nada do piloto**: banco, agendador/Vault, número de WhatsApp, app da Meta ou
  segredos. O número de WhatsApp do piloto não pertence ao cliente; os testes do RecepClinic usam um
  chip próprio.
  **Revisto pelo cliente em 20/out:** o piloto está desativado e o número do app antigo "Consultório
  Dra. Ana Karina" é do cliente; o app antigo é excluído e esse número pode entrar no portfólio
  RecepClinic como número de testes de outra clínica do staging (o resto do piloto segue proibido).
- **Branches paralelas** (cliente, 30/out/2026): planejamento fica na `main` (cada frente no seu arquivo); branch
  paralela só quando há código, criada da `main` e de vida curta. A cada correção na `main`, o Claude traz a `main`
  para a branch (`git merge main`), roda os testes e avisa; com conflito, para e pergunta. Nunca o caminho inverso sem
  o OK do cliente: antes de juntar a branch na `main`, trazer a `main` para ela, rodar todos os testes e conferir que
  nenhuma correção da `main` voltou ao estado antigo. O bloco de retomada do README só é editado na `main`.
- **Jornada do bot** (cliente, 30/out/2026): toda mudança no caminho do paciente no WhatsApp (bot em
  `src/lib/data/whatsapp/bot/` ou mensagens automáticas) atualiza, no mesmo commit, o fluxograma de Tecnologia ›
  Jornada do bot (`src/components/admin/tecnologia/botJourney.ts`, com a data em `JOURNEY_UPDATED`).
- As decisões de arquitetura estão em `docs/arquitetura.md` (D1–D11) e o plano em `docs/plano.md`.
  Mudança de decisão só com o cliente, e registrada lá.

## Communication Style (Caveman Mode)
- Speak like a caveman. Use minimal words.
- No pleasantries, no conversational filler, no explanations unless explicitly asked.
- Output code diffs and file paths directly. Skip recap text.
