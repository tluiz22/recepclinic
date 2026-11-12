---
name: iniciar-etapa
description: Abre uma etapa de implementação do RecepClinic (leitura mínima, plano, perguntas de negócio).
---
1. Ler `docs/roadmap.md` e o `status.md` da frente (`docs/iniciativas/<frente>/`). Nada além; o resto por `grep`.
2. Confirmar branch: ajuste da validação vai direto na `main`; frente com código, branch curta criada da `main`.
3. Dúvida de negócio: uma por vez, AskUserQuestion, opção recomendada, termo explicado e exemplo. Decisão de UX:
   desenhar as opções antes de perguntar, partindo da tela real, pensando em clínica com 10+ profissionais.
4. Implementar. Tela nova ou refeita: skill `frontend-design`. Cada botão de ação da Agenda pede confirmação;
   todo "Voltar" leva à tela de onde o usuário veio; telefone em texto simples com o botão do WhatsApp.
5. A etapa termina em `fechar-etapa` (e em `juntar-branch` ao encerrar a branch).
