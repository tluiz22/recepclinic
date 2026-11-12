# Relatório de testes de interface: R9 (Configurações)

## 1. Resumo da execução

- **Data:** 2026-10-17
- **Executado por:** Claude (skill `playwright-ui-form-best-practices`), a pedido do cliente
- **Resultado geral:** 3 falhas (2 Médias da R9 e 1 Baixa anterior a ela), **todas corrigidas e
  retestadas em 17/out** (seção 10); 1 não aplicável
- **Síntese:** o menu agrupado, o botão "Seção" do celular (também sem JavaScript), o guia com o
  progresso, as listas em linhas, os formulários em blocos e o "Voltar para a origem" (Início e
  DMED, no mesmo ano, também depois do erro e de salvar) funcionam. Todos os formulários testados
  mantêm os campos depois do erro, marcam o campo e põem o foco nele; na Clínica, um erro num bloco
  não grava nada e salvar um bloco não mexe nos outros. O defeito mais sério é novo da R9: em 14
  das 19 telas de Configurações o aviso ("Serviço salvo.", "Telefone inválido") **não é apagado**
  e reaparece nas telas seguintes, até no Início. O segundo: na Clínica, o erro de um bloco de baixo
  fica fora da tela, e o campo não tem marca visual.

| Status | Quantidade |
| --- | --- |
| PASSOU | 22 |
| FALHOU | 3 |
| BLOQUEADO | 0 |
| NÃO APLICÁVEL | 1 |
| **Total executado** | 25 (mais 1 não aplicável) |

## 2. Ambiente

- **URL base:** `http://localhost:4321` (servidor `npm run dev` do cliente)
- **Ambiente:** local, banco do seed (Supabase local). **Gravação**, só na Clínica Exemplo Saúde:
  - Identificação e Limites do bot da Clínica e dados fiscais da Nota fiscal salvos com valores de
    teste e **devolvidos aos do seed** em seguida (conferido na tela);
  - serviço **"Teste QA 01"** criado para ver o guia com pendências e depois **desativado**. Serviço
    não tem "Excluir" na tela, e a exclusão direta no banco local foi negada: ele continua no banco
    local, desativado, até o próximo `npm run db:reset`.
  Na Odonto Exemplo só houve envio com erro (nada gravado).
- **Navegador e viewport:** Chromium (MCP Playwright), 1280×900 e 390×844, com e sem JavaScript
- **Versão/commit da aplicação:** `7fd1a24` mais a R9 sem commit (árvore de trabalho)
- **Usuários de teste:** Administrador da Clínica Exemplo Saúde e da Odonto Exemplo; Suporte
  (Clínica Exemplo Saúde). Logins do seed, sem senhas neste relatório.

## 3. Escopo

- **Incluído:** as 13 seções de Configurações (menu, título, ação principal, "Seção" no celular);
  Clínica (guia, 5 blocos, erro e salvar por bloco, "Cancelar"); listas de Profissionais, Locais,
  Agendas, Serviços, Convênios e Equipe ("Ativos | Todos", linha → cadastro → "‹ lista");
  formulários Novo serviço e Novo profissional (erros); desativar com confirmação; Nota fiscal
  aberta do Início e da DMED ("Voltar para a origem", erro e salvar); origem forjada; Suporte
  (WhatsApp com o selo) e Administrador sem WhatsApp.
- **Fora do escopo:** erros de Horários, Feriados, Lembretes, Mensagens, Agendas, Locais e
  Convênios (só abertos); logo (envio de arquivo); certificado A1; convite da Equipe (manda
  e-mail).

## 4. Ferramentas utilizadas

- MCP Playwright (exploração, com `browser_run_code` para ler valores efetivos, foco, atributos
  ARIA, cookies, cabeçalhos `Set-Cookie`, larguras e status HTTP). O projeto não tem
  `@playwright/test`; não foram criadas specs.

## 5. Cenários executados

| ID | Cenário | Critério | Tipo | Status | Severidade |
| --- | --- | --- | --- | --- | --- |
| NAV-01 | Aviso do Início → Nota fiscal → "Voltar para o Início" | Retorno à origem | Obrigatório | PASSOU | — |
| NAV-02 | Nota fiscal aberta do Início: erro e salvar mantêm o "Voltar para o Início" | Retorno à origem | Obrigatório | PASSOU | — |
| NAV-03 | DMED 2024 → Nota fiscal → erro → "Voltar para a DMED" em 2024 | Retorno à origem | Obrigatório | PASSOU | — |
| NAV-04 | Nota fiscal pelo menu: sem "Voltar"; menu a partir de seção com origem não leva a origem | Retorno à origem | Obrigatório | PASSOU | — |
| NAV-05 | Origem forjada (`https://…`) não vira link; origem do painel sem rótulo próprio: "Voltar" | Retorno à origem | Obrigatório | PASSOU | — |
| NAV-06 | 6 listas com "Todos" → cadastro → "‹ lista" (e "Cancelar") | Retorno com o estado | Obrigatório | FALHOU → corrigida | Baixa |
| NAV-07 | Celular: "Seção: Serviços" abre a lista com a atual marcada e navega | Navegação | Obrigatório | PASSOU | — |
| NAV-08 | Celular sem JavaScript: "Seção" abre e navega | Navegação | Obrigatório | PASSOU | — |
| NAV-09 | Pagamento → seção de Configurações | Retorno à origem | Obrigatório | NÃO APLICÁVEL | — |
| FORM-01 | Clínica › Atendimento: prazo 9999 (perfil, fuso e idade alterados) | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-02 | Clínica › Identificação: nome vazio ("Outro" com nome e artigo); corrigir só o nome | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-03 | Clínica › Limites: um campo vazio; corrigir só ele; outros blocos intactos | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-04 | Clínica › Informações do bot: "Cancelar" desfaz e fecha | Comportamento do bloco | Obrigatório | PASSOU | — |
| FORM-05 | Nota fiscal (Exemplo): CNPJ inválido; corrigir só o CNPJ | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-06 | Nota fiscal (Odonto, vinda da DMED): CNPJ inválido com tudo preenchido | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-07 | Novo serviço: valor "abc" (agenda, local e valor por local marcados) | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-08 | Novo serviço: duração 0 | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-09 | Novo profissional: telefone "123" (conselho, UF e RQE preenchidos) | Preservação dos campos | Obrigatório | PASSOU | — |
| QA-01 | Clínica: erro num bloco de baixo | Mensagem visível e campo marcado | Adicional | FALHOU → corrigida | Média |
| QA-02 | Aviso de salvo/erro apagado depois de mostrado | Aviso mostrado uma vez | Adicional | FALHOU → corrigida | Média |
| QA-03 | Guia com pendências: "4 de 6 passos prontos · 3 pendências", barra, números no menu, selos na linha | Decisão 4 | Adicional | PASSOU | — |
| QA-04 | Desativar: confirmação abre; "Voltar" fecha sem mudar nada | Decisão 6 | Adicional | PASSOU | — |
| QA-05 | 390px: sem rolagem lateral em 15 telas (seções e formulários) | Larguras | Adicional | PASSOU | — |
| QA-06 | Suporte: WhatsApp com o selo "Suporte"; 13 seções com HTTP 200; console sem erros | Perfis | Adicional | PASSOU | — |
| QA-07 | Administrador em `/whatsapp`: vai para Lembretes, sem o item no menu | Perfis | Adicional | PASSOU | — |
| QA-08 | Campo com erro: foco, `aria-invalid` e `aria-describedby` na mensagem | Acessibilidade | Adicional | PASSOU | — |

### 5.1 Aprovados

- **NAV-01 a NAV-05:** a Nota fiscal mostra "‹ Voltar para o Início" / "‹ Voltar para a DMED"
  acima do título; a origem vai na ação dos 4 formulários e continua depois do erro e de salvar; a
  DMED volta em `?ano=2024`. Aberta pelo menu, sem "Voltar".
- **NAV-07 e NAV-08:** no celular o menu lateral some e o "Seção: <nome>" (um `<details>`) abre a
  lista nos 4 grupos, com JavaScript ou sem.
- **FORM-01 a FORM-09:** em todos, os valores efetivos depois do erro são iguais aos de antes
  (textos, números, selects, rádios e caixas, inclusive o valor por local do serviço); a mensagem
  é a da regra ("Prazo para oferecer horários: de 7 a 365 dias", "Informe o nome da clínica",
  "Cadastros pelo bot por contato: de 1 a 10", "CNPJ inválido: confira os 14 caracteres.",
  "Valor inválido", "Duração em minutos inteiros, maior que 0", "Telefone inválido"); o foco vai ao
  campo. Na Clínica, o bloco com erro volta aberto, nada é gravado (conferido no modo leitura) e,
  depois de corrigir só o campo, "Identificação salva." / "Limites do bot salvos." sem mexer nos
  outros blocos.
- **QA-03:** com o serviço de teste sem agenda, sem local e sem horário: guia "4 de 6 passos
  prontos · 3 pendências", `role=progressbar` com `aria-valuenow=4` de 6, passos 5 e 6 em "Atenção"
  com o motivo; no menu "Serviços 2" e "Horários 1"; na lista, os selos "sem agenda", "sem local"
  e "sem horário" na linha.

### 5.2 Falhas

Ver a seção 6.

### 5.3 Bloqueios

- Nenhum.

### 5.4 Não aplicáveis

- **NAV-09:** a tela do Pagamento não tem link para Configurações (só o Início e a DMED mandam a
  origem). O rótulo "Voltar para o pagamento" existe em `returnLabel`, mas nada o usa hoje.

## 6. Achados

### 6.1 Defeitos confirmados

#### QA-02 · Aviso não é apagado em 14 telas e reaparece nas seguintes

- **Severidade:** Média (nova da R9)
- **Página ou fluxo:** Configurações › Equipe, Horários, Feriados, Convênios, Lembretes,
  Mensagens, Nota fiscal e todos os formulários (`/novo` e `/<id>`)
- **URL:** ex.: `/admin/configuracoes/profissionais/novo`
- **Critério avaliado:** qualidade adicional: aviso mostrado uma vez
- **Pré-condições:** Administrador da Clínica Exemplo Saúde
- **Passos executados:**
  1. Novo profissional com telefone "123" → "Cadastrar" (aviso "Telefone inválido", certo).
  2. No menu, "Feriados"; depois "Horários"; depois o Início.
- **Resultado esperado:** o aviso aparece só na tela do formulário.
- **Resultado observado:** "Telefone inválido" aparece em Feriados, em Horários e no Início. O mesmo
  com aviso de sucesso ("Serviço salvo." em Equipe duas vezes seguidas). Só some ao abrir uma das 5
  telas que apagam o cookie: Clínica e as listas de Profissionais, Locais, Agendas e Serviços.
- **Causa (conferida):** nessas 14 telas a resposta não traz o `Set-Cookie` que apaga `rc_aviso`.
  Só as 5 telas que passam o `setup` já carregado ao `ConfigShell` apagam. Nas outras, o
  `ConfigShell` espera o `loadSetupStatus` antes de desenhar, a página já começou a ser enviada e o
  `takeFlash` do `FlashMessage` não consegue mais mexer no cookie. Antes da R9, o `FlashMessage`
  ficava na própria página, antes de qualquer espera.
- **Impacto:** um erro de um formulário aparece em telas sem relação (até no Início), e um "salvo"
  aparece onde nada foi salvo.
- **Evidência:** `evidencias/r9-aviso-repetido-feriados-1280.png`; cabeçalhos `Set-Cookie` por tela
  (só `/`, `/profissionais`, `/locais`, `/agendas` e `/servicos` trazem `rc_aviso`).
- **Recomendação:** ler o aviso na página (ou no `ConfigShell`, antes do `await`) e passá-lo
  pronto ao `FlashMessage`; ou carregar o `setup` em todas as páginas, como as 5 que funcionam.
  Conferir de novo as 19 telas.

#### QA-01 · Erro num bloco de baixo da Clínica fica fora da tela, e o campo não tem marca

- **Severidade:** Média
- **Página ou fluxo:** Configurações › Clínica (blocos Atendimento, Páginas públicas,
  Informações do bot e Limites do bot)
- **URL:** `/admin/configuracoes`
- **Critério avaliado:** qualidade adicional: mensagem visível e indicação visual do erro
- **Pré-condições:** Administrador; computador (1280×900)
- **Passos executados:**
  1. "Editar" em Limites do bot; esvaziar "Pacientes novos" (sem o `required`, para chegar ao
     servidor) → "Salvar".
- **Resultado esperado:** a mensagem à vista, junto do bloco, e o campo marcado.
- **Resultado observado:** a tela rola até o campo (foco certo), mas a mensagem "Cadastros pelo
  bot por contato: de 1 a 10" fica no topo, fora da tela (`top` negativo), e a borda do campo com
  erro é igual à dos outros (`aria-invalid` sem estilo). Quem olha vê o bloco aberto, sem saber o
  porquê. Mesmo no Atendimento.
- **Impacto:** com o salvar por bloco, o erro de baixo deixa de ser visto; leitor de tela anuncia
  (`aria-describedby`), a vista não.
- **Evidência:** `evidencias/r9-clinica-erro-atendimento-1280.png`,
  `evidencias/r9-clinica-erro-limites-1280.png`
- **Recomendação:** mostrar a mensagem dentro do bloco que falhou (acima do "Salvar") e dar estilo
  ao `aria-invalid` (borda vermelha) nos campos do padrão novo (`formStyles.ts`).

#### NAV-06 · "‹ lista" e "Cancelar" do cadastro perdem o filtro "Todos"

- **Severidade:** Baixa (anterior à R9: o link antigo também ia para a lista pura)
- **Página ou fluxo:** Profissionais, Locais, Agendas, Serviços e Convênios
- **URL:** ex.: `/admin/configuracoes/servicos?todos=1` → `/admin/configuracoes/servicos/<id>`
- **Critério avaliado:** retorno à página anterior com o estado
- **Passos executados:**
  1. Lista com "Todos" (`?todos=1`); clicar num cadastro.
  2. "‹ Serviços" (ou "Cancelar").
- **Resultado esperado:** volta à lista em "Todos" (a regra do cliente: "Voltar" leva à tela de
  onde veio).
- **Resultado observado:** volta a `/admin/configuracoes/servicos`, em "Ativos". Quem abriu um
  desativado não o encontra na volta.
- **Evidência:** URLs registradas nas 5 listas (Equipe não tem o filtro).
- **Recomendação:** levar `?todos=1` no link da linha e devolvê-lo no "‹ lista", no "Cancelar" e
  depois de salvar.

### 6.2 Suspeitas

- Nenhuma.

### 6.3 Pontos não verificados

| Item | Motivo |
| --- | --- |
| Erros de Horários, Feriados, Lembretes, Mensagens, Agendas, Locais e Convênios | Fora do escopo desta rodada (só abertos, sem erro HTTP) |
| Logo nas Páginas públicas | Envio de arquivo não testado |
| Convite da Equipe | Manda e-mail |
| Envio duplo (duplo clique) | Não testado nesta rodada |

## 7. Limitações

- Os erros do servidor foram provocados tirando `required`/`min`/`max` do campo no navegador; com
  eles, o próprio navegador barra antes.
- O serviço "Teste QA 01" ficou desativado no banco local (ver seção 2).

## 8. Evidências

- **Local:** `docs/auditoria-frontend/evidencias/` (como nos relatórios anteriores)
- **Arquivos:** `r9-clinica-erro-atendimento-1280.png`, `r9-clinica-erro-limites-1280.png`,
  `r9-clinica-guia-pendencia-1280.png`, `r9-servicos-pendencia-1280.png`,
  `r9-aviso-repetido-feriados-1280.png`, `r9-servico-erro-preco-1280.png`, `r9-local-form-1280.png`,
  `r9-secao-aberta-390.png`, `r9-servicos-390.png`, `r9-clinica-390.png`,
  `r9-whatsapp-suporte-1280.png`
- **Dados sensíveis:** só dados do seed e de teste; sem senhas, cookies ou tokens.

## 9. Recomendações

1. ~~Corrigir QA-02 antes de publicar~~ feito.
2. ~~Corrigir QA-01~~ feito.
3. ~~NAV-06~~ feito (cliente pediu as 3, 17/out).

## 10. Correções e reteste (17/out)

O cliente pediu as 3 correções. `astro check` sem erros e `npm test` (502) passando.

- **QA-02:** o `ConfigShell` lê o aviso (`takeFlash`) antes de esperar o guia e o passa pronto ao
  `FlashMessage` (nova prop `flash`; sem ela, lê como antes). **Reteste:** com um aviso no cookie,
  as 19 telas de Configurações e mais Início, Pacientes, Financeiro e DMED (23) mostram o aviso
  uma vez e apagam o cookie; o "Telefone inválido" do Novo profissional não aparece mais em
  Feriados.
- **QA-01:** num formulário dentro de um cartão "Editar", o `keepFormValues` põe a mensagem de erro
  no topo do formulário e, quando a mensagem e o campo cabem juntos na tela, rola até a mensagem;
  os campos do padrão novo (`formStyles.ts`) ganharam a borda vermelha com `aria-invalid` (sai ao
  digitar). **Reteste:** Atendimento, Limites e Identificação, em 390px e 1280px: mensagem e campo à
  vista, foco no campo, valores mantidos, nada gravado
  (`evidencias/r9-clinica-erro-limites-corrigido-1280.png`,
  `evidencias/r9-clinica-erro-atendimento-corrigido-390.png`). Vale também para os cartões da DMED
  (Responsáveis da declaração, R8) e da ficha (Dados, R6), conferidos: mensagem no cartão, à vista.
- **NAV-06:** `withAllFilter` e `allFilterOn` (`returnPath.ts`, com teste): a linha da lista em
  "Todos" abre o cadastro com `?todos=1`, que vai na ação do formulário e volta no "‹ lista", no
  "Cancelar", depois de salvar e depois de erro. **Reteste:** nas 5 listas, "‹ lista" e "Cancelar"
  voltam em "Todos"; salvar (Locais, Agendas, Serviços, Convênios, sem mudar nada) mantém o filtro;
  erro em Serviços mantém o filtro e o valor digitado; sem o filtro, os links são os de antes.
  Profissionais não foi salvo: o cadastro do seed não tem telefone (obrigatório) e o navegador
  barra antes.
