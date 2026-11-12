# Manual de uso: como trabalhar com o Claude no RecepClinic

## 1. Começar uma sessão
1. `/clear` (sessão nova) e, para tarefa mecânica (docs, merge, testes), `/model sonnet`.
2. Diga a frente. O Claude lê só `docs/roadmap.md` e o `status.md` da frente. Exemplos:
   - "Retomar a F3f: roteiro de validação no staging."
   - "Retomar a nota fiscal."
   - "Nova frente: <descreva o pedido>."
3. Para saber onde parou: "Qual o estado do roadmap?" (ele responde pelo `roadmap.md`).

## 2. As skills (peça pelo nome ou diga o que quer)
| Skill | Quando | Frase para pedir |
|---|---|---|
| `/iniciar-etapa` | Abrir uma etapa de código | "/iniciar-etapa <frente> <etapa>" |
| `/fechar-etapa` | Terminar a etapa: testes, code-review, status | "/fechar-etapa" |
| `/juntar-branch` | Juntar branch curta na `main` | "/juntar-branch <branch>" (só com seu OK) |
| `/publicar` | Staging ou produção | "/publicar staging" · "/publicar produção" |
| `/recapturar-ajuda` | Atualizar capturas da Ajuda | só depois de você autorizar |

Outras skills que o Claude já aciona sozinho: `frontend-design` (telas), `playwright-ui-form-best-practices` (testes de UI), `code-review`.

## 3. Fluxo de uma etapa
`iniciar-etapa` → implementar → `fechar-etapa` (testes, `/code-review` do diff da etapa, `status.md`, commit) →
**o Claude para e espera sua confirmação** → próxima etapa. Ao fim da branch: `juntar-branch` (suíte completa +
`/code-review` só do que não foi revisto; pula se nada mudou).

## 4. O que o Claude faz sozinho e o que pede
- **Sozinho:** ajustes da validação direto na `main`, testes, commit, atualizar `status.md` e `roadmap.md`.
- **Pergunta antes (uma dúvida por vez, com opção recomendada):** regra de negócio, decisão de tela, atualizar outras
  branches com a `main`, recapturar a Ajuda, push de código que depende de migração.
- **Só com sua autorização explícita:** produção, ações externas (Meta, Asaas, Vercel), `/code-review max` ou `ultra`.
- Para dispensar paradas numa frente: diga "pode seguir sem parar, valido no fim".

## 5. Como pedir bem
- Diga **frente + resultado esperado**: "Na Agenda, o botão X deve fazer Y".
- Decisão de tela: peça "desenhe as opções antes" (o Claude parte da tela atual e pensa em clínicas com 10+ profissionais).
- Bug: tela/clínica, o que fez, o que esperava, o que apareceu.
- Fim de etapa: peça "o que falta validar?" e ele lista os comandos/roteiro.

## 5b. Frases úteis
"Atualize o roadmap." · "Registre essa decisão no status da frente." · "Revise o diff com /code-review medium." ·
"O que está a confirmar no roadmap?" · "Mostre o que mudou desde o último `revisto até`."

## 6. Onde estão as coisas
`CLAUDE.md` (regras) · `docs/roadmap.md` (estado) · `docs/iniciativas/<frente>/status.md` · `docs/modulos/` (fichas) ·
`docs/arquivo/` (detalhe, só por `grep`) · `.claude/skills/` e `.claude/rules/` (procedimentos).
