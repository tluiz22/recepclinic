# Cadastro do profissional em abas e acesso ao painel
**Pedido:** cliente, 13/nov/2026, antes de seguir a validação da Nota fiscal (passo 5 do roteiro 15.2 precisa de profissional com login).
**Desenho aprovado:** Opção A, abas (https://claude.ai/artifact/DgoinspdLKPdwNKNcfRc7c).

- **Código:** branch `tela-profissional` (worktree `../recepclinic-impl`), commits `53dfa542` (abas, leitura com Editar,
  especialidades por busca, foto num botão), `eadc6d31` (aba Acesso ao painel e e-mail no cadastro novo) `1f718c32`
  (correções da revisão) e um último commit (13/nov): aba Bot vira **Orientações** (sempre visível; sem o bot, só as
  observações, que o portal mostra), página na largura das outras uma explicação sob cada aba, o botão "Como funciona?" e o artigo da ajuda atualizado (sem captura nova). Sem migração. Ainda **não** está na `main` nem no staging.
- **Decisões do cliente (13/nov):** Opção A; foto num botão só (escolher já envia; Trocar e Remover com confirmação);
  e-mail de quem já é da Equipe → confirmação e ligação ao login existente (soma o papel Profissional); e-mail opcional
  no cadastro novo (preenchido, o convite já sai).
- **Testes:** `astro check` 0 erros; `npm test` 1306 ok; Playwright da tela (abas, editar e salvar em cada aba,
  especialidades, foto, convite, trocar e-mail, cancelar, ligar ao login, visão do profissional, volta da Equipe);
  390 e 1280 px conferidos. Revisão `/code-review high`: 10 achados, todos corrigidos.
- **Próxima ação:** validação do cliente no `npm run dev` da branch; depois `juntar-branch` e publicar no staging;
  então retomar a Nota fiscal no passo 2 do roteiro 15.2.
