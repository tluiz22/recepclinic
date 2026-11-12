---
name: juntar-branch
description: Junta uma branch curta na main com suíte completa e code-review do que ainda não foi revisto.
---
Só com o OK do cliente. Antes de qualquer outra branch receber a `main`, perguntar se deve atualizar.
1. Trazer a `main` para a branch (`git merge main`); conflito: parar e perguntar.
2. Suíte inteira (unidade, banco, Playwright completo) e build.
3. Conferir que nenhuma correção da `main` voltou ao estado antigo (`git diff main...HEAD` nos arquivos em comum).
4. `/code-review` só do delta desde `revisto até: <commit>` no `status.md`. Se nada mudou desde esse commit, **pular e
   dizer que pulou**. Corrigir achados; registrar o novo `revisto até`.
5. Juntar na `main`. Apagar a branch já juntada. Atualizar o bloco de retomada (`roadmap.md`) só na `main`.
