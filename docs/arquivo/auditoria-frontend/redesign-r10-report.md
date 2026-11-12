# Relatório de testes de interface: R10 (Sistema e Acesso)

## 1. Resumo da execução

- **Data:** 2026-10-17
- **Executado por:** Claude (skill `playwright-ui-form-best-practices`), a pedido do cliente
- **Resultado geral:** 3 falhas Baixas (2 da R10 e 1 anterior a ela), nenhuma Alta ou Média,
  **as 3 corrigidas e retestadas em 17/out** a pedido do cliente (seção 10); 1 suspeita; 2 pontos
  não verificados (sem dados no seed)
- **Síntese:** as telas de acesso (Entrar, Esqueci minha senha, Senha nova) funcionam com a marca
  nova: depois da senha errada o e-mail continua no campo e o foco vai para a senha; o erro da senha
  nova fica embaixo do campo certo, com borda vermelha e foco; "Mostrar"/"Ocultar" troca o campo e,
  sem JavaScript, o botão some e o campo continua de senha. Escolher a clínica em cartões, "Abrir"
  na lista de Clínicas, Nova clínica (erros mantêm todos os campos), filtros do Uso e de Erros, abas
  de Vendas e atalhos da Tecnologia funcionam, também em 390px sem rolagem lateral. As falhas: o
  "‹ Todas as clínicas" da Matriz aberta pela tela da clínica não volta para a clínica (NAV-06); o
  contador dos grupos da Matriz aparece "3de 3", sem o espaço (QA-10); e a Matriz que volta com erro
  do servidor perde as marcações (FORM-09, anterior à R10).

| Status | Quantidade |
| --- | --- |
| PASSOU | 25 |
| FALHOU | 3 |
| BLOQUEADO | 0 |
| NÃO APLICÁVEL | 0 |
| **Total executado** | 28 |

## 2. Ambiente

- **URL base:** `http://localhost:4321` (servidor `npm run dev` já no ar)
- **Ambiente:** local, banco do seed (Supabase local). Gravação: só "Salvar matriz" da Clínica
  Exemplo Saúde **sem nenhuma mudança** (mesmos valores; o histórico continuou "Nenhuma mudança
  registrada"). Os demais envios voltaram com erro (nada gravado). "Esqueci minha senha" foi enviado
  com um e-mail que não existe (nenhum e-mail sai). Nenhuma clínica, convite ou pedido criado.
- **Navegador e viewport:** Chromium (MCP Playwright), 1280×900 e 390×844; login também sem
  JavaScript
- **Versão/commit da aplicação:** `9748a35` mais a R10 sem commit (árvore de trabalho)
- **Usuários de teste:** Suporte, Administrador da Clínica Exemplo Saúde (logins do seed, sem senhas
  neste relatório)

## 3. Escopo

- **Incluído:** Entrar no painel, Esqueci minha senha, Senha nova (com sessão do Administrador),
  Escolher a clínica, Sistema › Clínicas, a tela da clínica, Nova clínica, Matriz de acesso (lista
  e clínica, resumo e barra do celular), Uso, Erros, Vendas (abas) e Tecnologia (atalhos).
- **Fora do escopo:** criar clínica de verdade, reenviar convite e enviar o pedido de informações
  (mandam e-mail e gravam); mudar a matriz de verdade.

## 4. Ferramentas utilizadas

- MCP Playwright (exploração, com `browser_run_code` para ler valores efetivos, foco, atributos
  ARIA, larguras e status HTTP). O projeto não tem `@playwright/test`; não foram criadas specs.

## 5. Cenários executados

| ID | Cenário | Critério | Tipo | Status | Severidade |
| --- | --- | --- | --- | --- | --- |
| NAV-01 | Esqueci minha senha → "‹ Voltar para o login" | Retorno | Obrigatório | PASSOU | — |
| NAV-02 | Clínicas → nome da clínica → "‹ Clínicas" | Retorno | Obrigatório | PASSOU | — |
| NAV-03 | Clínicas → seta da linha → "‹ Clínicas" | Retorno | Obrigatório | PASSOU | — |
| NAV-04 | Clínicas → Nova clínica → "Cancelar" e "‹ Clínicas" | Retorno | Obrigatório | PASSOU | — |
| NAV-05 | Matriz (lista) → clínica → "‹ Todas as clínicas" | Retorno | Obrigatório | PASSOU | — |
| NAV-06 | Tela da clínica → "Matriz de acesso" → "‹ Todas as clínicas" | Retorno | Obrigatório | FALHOU | Baixa |
| FORM-01 | Entrar: senha errada | Preservação | Obrigatório | PASSOU | — |
| FORM-02 | Senha nova: senhas diferentes | Preservação/erro no campo | Obrigatório | PASSOU | — |
| FORM-03 | Senha nova: menos de 8 (validação do navegador desligada) | Preservação/erro no campo | Obrigatório | PASSOU | — |
| FORM-04 | Senha nova igual à atual | Mensagem | Obrigatório | PASSOU | — |
| FORM-05 | Esqueci: e-mail que não existe | Mesma resposta | Obrigatório | PASSOU | — |
| FORM-06 | Nova clínica: nome só com espaços | Preservação | Obrigatório | PASSOU | — |
| FORM-07 | Nova clínica: e-mail inválido no servidor (`qa01@exemplo`) | Preservação | Obrigatório | PASSOU | — |
| FORM-08 | Clínica: pedido de informações com e-mail inválido | Preservação | Obrigatório | PASSOU | — |
| FORM-09 | Matriz: limite 0 (validação do navegador desligada) | Preservação | Obrigatório | FALHOU | Baixa |
| QA-01 | "Mostrar"/"Ocultar" na senha; ao enviar, volta a ser senha | Adicional | Adicional | PASSOU | — |
| QA-02 | Entrar sem JavaScript | Adicional | Adicional | PASSOU | — |
| QA-03 | Escolher a clínica: cartões, iniciais fora do nome acessível, "Aberta agora" | Adicional | Adicional | PASSOU | — |
| QA-04 | "Abrir" na lista de Clínicas entra na clínica | Adicional | Adicional | PASSOU | — |
| QA-05 | Uso: filtro "Clínica", "Total em 6 meses", filtro inválido | Adicional | Adicional | PASSOU | — |
| QA-06 | Erros: selos das rotinas, filtro com rótulo, filtro inválido | Adicional | Adicional | PASSOU | — |
| QA-07 | Vendas: abas sublinhadas, URL e aba atual | Adicional | Adicional | PASSOU | — |
| QA-08 | Tecnologia: atalhos "Nesta página" (8, todos com destino) | Adicional | Adicional | PASSOU | — |
| QA-09 | Matriz: resumo, mensalidade e barra do celular acompanham | Adicional | Adicional | PASSOU | — |
| QA-10 | Matriz: contador dos grupos ("n de m") | Adicional | Adicional | FALHOU | Baixa |
| QA-11 | 390px: telas do sistema e de acesso sem rolagem lateral, "Sair" à vista | Adicional | Adicional | PASSOU | — |
| QA-12 | Salvar matriz (duplo clique, sem mudanças) | Adicional | Adicional | PASSOU | — |
| QA-13 | Console sem erros; nenhuma resposta 5xx | Adicional | Adicional | PASSOU | — |

### 5.1 Aprovados

- **NAV-01 a NAV-05:** cada retorno levou à URL e ao título da tela de origem ("Entrar no painel",
  "Clínicas", "Matriz de acesso").
- **FORM-01:** volta em `/admin/login?error=1` com "E-mail ou senha inválidos.", o e-mail no campo,
  a senha vazia (dado sensível, limpeza esperada), `aria-invalid` e `aria-describedby` na senha e o
  foco nela. A senha não vai para a URL.
- **FORM-02/03:** "As duas senhas não são iguais." embaixo de "Repita a senha" (borda vermelha,
  `aria-invalid`, foco); "A senha precisa ter pelo menos 8 caracteres." embaixo de "Senha nova". As
  duas senhas voltam vazias (sensível). Botão "Mostrar" centrado no campo (6px acima e abaixo).
- **FORM-04:** "Esta já é a sua senha atual: ela já está valendo. Entre no painel com ela."
- **FORM-05:** "Se este e-mail tiver acesso ao painel, enviamos um link…" (mesma resposta).
- **FORM-06/07:** nome, perfil (alterado para "mixed"), fuso (alterado para Noronha) e e-mail
  mantidos; erro no campo certo, com `aria-invalid` e foco. O envio corrigido não foi feito (criaria
  a clínica e mandaria o convite).
- **FORM-08:** "E-mail inválido.", valor mantido, campo marcado e com foco.
- **QA-01:** "Mostrar" vira o campo em texto e o botão em "Ocultar", com o foco no campo; depois do
  envio o campo é de senha de novo.
- **QA-02:** sem JavaScript o botão "Mostrar" fica escondido e o campo é de senha; o login funciona
  (o e-mail não volta depois do erro, porque isso é feito por script; ver limitações).
- **QA-03:** nomes acessíveis "Clínica Exemplo Saúde Suporte RecepClinic" (iniciais com
  `aria-hidden`); "Aberta agora" na clínica ativa; "Administração do sistema" com Clínicas e Matriz
  no pé; 390px sem rolagem lateral.
- **QA-04:** "Abrir" (nome acessível "Abrir Odonto Exemplo") vai para o Início com "Odonto Exemplo"
  no cabeçalho.
- **QA-05/06:** abre em "Todas"; escolher "Odonto Exemplo" envia sozinho
  (`?clinica=…`, com botão no `noscript`), mantém a escolha e mostra só a clínica (Uso); "Total em
  6 meses" em cada tabela; `?clinica=lixo` responde 200 e mostra Todas.
- **QA-07:** `?tab=planos|demonstracao|roteiro`, com a aba atual marcada.
- **QA-09:** limite 6 → R$ 532,00 nos dois lugares; "Básico" → R$ 382,00, rótulo "Básico" e
  contadores 3, 0, 0; recarregar volta ao salvo (R$ 485,00, Completo). No celular a barra fixa
  ("Completo · R$ 485,00 · Salvar matriz") fica acima do menu de baixo.
- **QA-12:** duplo clique em "Salvar matriz" deu uma tela "Matriz salva." e o histórico não mudou.
- **QA-13:** 0 erros e 0 avisos no console; todas as telas responderam 200.

## 6. Achados

### 6.1 Defeitos confirmados

#### NAV-06 · Matriz aberta pela tela da clínica volta para a lista da Matriz

- **Severidade:** Baixa
- **Página ou fluxo:** Sistema › Clínicas › clínica › "Matriz de acesso" (botão novo da R10)
- **URL:** `/admin/sistema/matriz?clinica=0a000000-…`
- **Critério avaliado:** retorno à tela anterior (regra do cliente: o "Voltar" leva à tela de onde
  se veio)
- **Passos executados:**
  1. Abrir `/admin/sistema/clinicas/0a000000-…` (Clínica Exemplo Saúde).
  2. Clicar em "Matriz de acesso" no cabeçalho.
  3. Clicar em "‹ Todas as clínicas".
- **Resultado esperado:** voltar à tela da Clínica Exemplo Saúde (convites e pedidos).
- **Resultado observado:** vai para `/admin/sistema/matriz` ("Matriz de acesso", lista). O link fixo
  existia antes, mas só agora a Matriz é aberta pela tela da clínica. Há o "Ver a clínica ›" como
  contorno.
- **Evidência:** `evidencias/r10-nav-matriz-volta-lista-1280.png`, `evidencias/r10-matriz-clinica-1280.png`
- **Recomendação:** o botão da clínica passar a origem (`withReturn`/`safeReturnPath`, como na R9)
  e a Matriz mostrar "‹ Clínica Exemplo Saúde" nesse caso; sem origem, "‹ Todas as clínicas".

#### QA-10 · Contador dos grupos da Matriz sem espaço ("3de 3")

- **Severidade:** Baixa
- **Página ou fluxo:** Matriz de acesso de uma clínica, selos dos grupos
- **Critério avaliado:** qualidade adicional (texto)
- **Passos executados:** abrir `/admin/sistema/matriz?clinica=0a000000-…` em 1280px ou 390px.
- **Resultado esperado:** "3 de 3", "7 de 7", "2 de 2".
- **Resultado observado:** "3de 3", "7de 7", "2de 2". O selo (`config/Badge.astro`) é `inline-flex`;
  o número fica num `<span>` e o texto " de 3" é outro item do flex, que perde o espaço do começo.
- **Evidência:** `evidencias/r10-matriz-clinica-390.png` (selos dos grupos); `innerText` do selo:
  `"3\nde 3"`.
- **Recomendação:** pôr o texto todo num elemento só (ex.: `<span><span data-group-count>3</span> de 3</span>`)
  ou um `gap-1` no selo.

#### FORM-09 · Matriz que volta com erro do servidor perde as marcações (anterior à R10)

- **Severidade:** Baixa (o navegador e o script da tela evitam os erros "limite" e "dependência";
  sobra o "Não foi possível salvar", de falha do servidor)
- **Página ou fluxo:** Matriz de acesso de uma clínica
- **Critério avaliado:** preservação dos campos após erro
- **Pré-condições:** validação do navegador desligada (`noValidate`) para o servidor receber o
  limite 0.
- **Passos executados:**
  1. Abrir a Matriz da Clínica Exemplo Saúde (limite 5, todos os itens marcados).
  2. Desmarcar "Séries recorrentes" e "Módulo financeiro"; limite 0; "Salvar matriz".
- **Resultado esperado:** mensagem de erro, as duas caixas continuam desmarcadas e o limite marcado
  como inválido.
- **Resultado observado:** "O limite de profissionais precisa ser de pelo menos 1. Nada foi salvo."
  (com foco na mensagem), mas as duas caixas voltam marcadas e o limite volta a 5 (o salvo), sem
  `aria-invalid`.
- **Campos perdidos:** `item=series`, `item=finance` (desmarcados → marcados); `max_professionals`.
- **Causa:** a Matriz mostra o erro com `FormMessage` direto, sem o `data-flash='error'` do
  `FlashMessage`; o `keepFormValues` só devolve os valores quando acha esse marcador. O mesmo uso
  direto existe em `pacientes/novo.astro` e `agenda/bloquear.astro` (fora deste teste).
- **Evidência:** `evidencias/r10-matriz-erro-limite-1280.png`
- **Recomendação:** usar o `FlashMessage` (ou o marcador `data-flash='error'` com `data-fields`) na
  Matriz, para devolver as marcações e marcar o limite.

### 6.2 Suspeitas

#### S-01 · "Abrir a clínica para configurar" abre o Início, não Configurações

- **Página:** tela da clínica no Sistema. O botão entra na clínica e vai para `/admin/dashboard`
  (igual a antes da R10; só o texto mudou de lugar). O nome sugere Configurações.
- **O que falta para confirmar:** o cliente dizer qual é o destino esperado (Início ou
  Configurações › Clínica). Não é defeito sem essa decisão.
- **Decisão do cliente (17/out):** Configurações. Ver a seção 10.

### 6.3 Pontos não verificados

| Item | Motivo |
| --- | --- |
| Busca "Buscar clínica" (acima de 6 clínicas), aqui e em Clínicas | o seed tem 2 clínicas; coberta pelo teste de unidade `clinicSearch.test.ts` |
| Clínica suspensa (cinza na lista, selo "Suspensa" em Escolher a clínica) | não há clínica suspensa no seed |
| Envio corrigido de Nova clínica e do pedido de informações | criaria clínica/pedido e mandaria e-mail |
| Duplo envio no servidor do "Salvar matriz" | só a tela foi observada (uma mensagem); requisições não contadas |
| Escolher a clínica para quem não é Suporte e tem mais de uma clínica | não há esse usuário no seed |

## 7. Limitações

- Sem JavaScript, o e-mail não volta depois da senha errada (é o `keepFormValues`, um script);
  o login funciona.
- A barra de ferramentas do Astro (`npm run dev`) aparece por cima do rodapé nas capturas; não existe
  no staging.
- Sem leitor de tela; acessibilidade vista pelo snapshot e pelos atributos ARIA.

## 8. Evidências

- **Local:** `docs/auditoria-frontend/evidencias/` (prefixo `r10-`)
- **Arquivos:** `r10-login-erro-1280.png`, `r10-login-390.png`, `r10-login-sem-js-390.png`,
  `r10-esqueci-enviado-1280.png`, `r10-nova-senha-mismatch-1280.png`, `r10-nova-senha-curta-1280.png`,
  `r10-nova-senha-mesma-1280.png`, `r10-escolher-clinica-1280.png`, `r10-escolher-clinica-aberta-1280.png`,
  `r10-escolher-clinica-390.png`, `r10-clinicas-1280.png`, `r10-clinicas-390.png`,
  `r10-clinica-detalhe-1280.png`, `r10-clinica-390.png`, `r10-nova-clinica-1280.png`,
  `r10-nova-clinica-erro-nome-1280.png`, `r10-nova-clinica-erro-email-1280.png`, `r10-nova-390.png`,
  `r10-pedido-email-invalido-1280.png`, `r10-matriz-1280.png`, `r10-matriz-390.png`,
  `r10-matriz-clinica-1280.png`, `r10-matriz-clinica-390.png`, `r10-matriz-clinica-390-tela.png`,
  `r10-matriz-erro-limite-1280.png`, `r10-nav-matriz-volta-lista-1280.png`, `r10-uso-1280.png`,
  `r10-uso-filtro-1280.png`, `r10-uso-390.png`, `r10-erros-1280.png`, `r10-erros-filtro-1280.png`,
  `r10-erros-390.png`, `r10-vendas-1280.png`, `r10-vendas-390.png`, `r10-tecnologia-1280.png`,
  `r10-tecnologia-390.png`
- **Dados sensíveis:** só dados do seed e fictícios; nenhuma senha, token ou cookie registrado.

## 9. Recomendações

1. NAV-06: "Voltar" da Matriz para a clínica de onde se veio.
2. QA-10: espaço no "n de m" dos grupos da Matriz.
3. FORM-09: Matriz com o `FlashMessage`, para manter as marcações depois do erro (anterior à R10).
4. S-01: "Abrir a clínica para configurar" leva a Configurações (decidido e feito em 17/out).

## 10. Correções (17/out, a pedido do cliente) e reteste

| ID | Correção | Reteste |
| --- | --- | --- |
| NAV-06 | O botão "Matriz de acesso" da tela da clínica abre a Matriz com `de=clinica`; aí o "Voltar" é "‹ Clínica Exemplo Saúde" (para a tela da clínica) e o "Ver a clínica ›" some. A rota de gravação devolve o `de` (campo escondido) no salvar e nos erros. Vinda da lista, continua "‹ Todas as clínicas" e "Ver a clínica ›". | **PASSOU**: clínica → Matriz → "‹ Clínica Exemplo Saúde" volta para `/admin/sistema/clinicas/0a…`, também depois do erro e de "Matriz salva."; da lista, "‹ Todas as clínicas". |
| QA-10 | Número e texto do selo num elemento só. | **PASSOU**: "3 de 3", "7 de 7", "2 de 2"; os números acompanham as marcações. |
| FORM-09 | O erro da Matriz vai com o marcador `data-flash="error"` (e `data-fields="max_professionals"` no erro do limite), e o `keepFormValues` devolve os valores. O script da Matriz ignora o aviso do rádio desmarcado, que antes remarcaria os itens do plano. | **PASSOU**: com "Lembrete à equipe" e "Módulo financeiro" desmarcados e limite 0, as duas caixas continuam desmarcadas, o limite fica 0 com `aria-invalid` e foco, e o resumo mostra "Básico + adicionais · R$ 329,00"; corrigindo só o limite, a mensalidade é recalculada. Com "Básico" escolhido pelo rádio, o plano e os 9 itens desmarcados também voltam. Recarregar sem o erro mostra o salvo (nada gravado pelo erro). |

| S-01 | Decisão do cliente: o botão manda `destino=configuracoes` e a rota da clínica ativa leva a `/admin/configuracoes` (único destino aceito; sem ele, o Início). | **PASSOU**: Odonto Exemplo → "Abrir a clínica para configurar" → Configurações › Clínica com "Odonto Exemplo" no cabeçalho; "Abrir" da lista e Escolher a clínica continuam no Início. Evidência: `evidencias/r10-corr-abrir-configurar-1280.png`. |

Depois, a Matriz foi salva de novo com os valores do seed (Completo, todos os itens, limite 5);
o histórico continuou "Nenhuma mudança registrada". `astro check` sem erros e `npm test` (506).
Evidências: `evidencias/r10-corr-matriz-erro-limite-1280.png`, `evidencias/r10-corr-matriz-contador-1280.png`.
