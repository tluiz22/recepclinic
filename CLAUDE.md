# RecepClinic: instruções para o Claude

Antes de qualquer coisa, leia `docs/README.md`. O bloco **"Estado atual (retomar daqui)"** diz
onde o trabalho parou.

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
- As decisões de arquitetura estão em `docs/arquitetura.md` (D1–D11) e o plano em `docs/plano.md`.
  Mudança de decisão só com o cliente, e registrada lá.
