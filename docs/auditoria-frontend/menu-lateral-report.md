# Relatório de testes de interface: menu lateral (L1 e L2)

## 1. Resumo da execução

- **Data:** 2026-10-31
- **Executado por:** Claude (MCP Playwright)
- **Resultado geral:** 2 falhas Baixas (QA-01 e QA-02), **ambas corrigidas e retestadas** no mesmo dia; nenhum
  bloqueio.
- **Síntese:** o menu lateral mostra os grupos e itens certos para cada papel, marca a tela aberta em todas as 15
  telas do menu, troca para a barra inferior abaixo de 1024px e não gera erro de console nem resposta 5xx. As duas
  falhas eram de lateral com muitos itens em telas baixas: o "Sair" fora da vista (Suporte) e a seção aberta de
  Configurações fora da vista.

| Status | Quantidade |
| --- | --- |
| PASSOU | 17 |
| FALHOU (corrigido e retestado) | 2 |
| BLOQUEADO | 0 |
| NÃO APLICÁVEL | 1 |
| **Total executado** | 19 |

## 2. Ambiente

- **URL base:** http://localhost:4321/admin
- **Ambiente:** local (banco do seed; nenhuma gravação feita)
- **Navegador e viewport:** Chromium; 1440×900, 1280×800, 1280×720, 1024×800, 1023×800, 900×800 e 390×844
- **Versão/commit da aplicação:** `8f0f80d` (L2) + correções do QA-01 e QA-02
- **Usuários de teste:** Administrador, Recepção, Recepção restrita, Profissional (Clínica Exemplo Saúde),
  Administrador + Profissional (Odonto Exemplo) e Suporte RecepClinic

## 3. Escopo

- **Incluído:** menu lateral (`AdminLayout`), seções de Configurações na lateral (`ConfigShell`), barra inferior e
  "Mais" no celular e no tablet, Administração do sistema, teclado.
- **Fora do escopo:** conteúdo das telas (não mudou); formulários.

## 4. Ferramentas utilizadas

- MCP Playwright (exploração e scripts de verificação).

## 5. Cenários executados

| ID | Cenário | Critério | Tipo | Status | Severidade |
| --- | --- | --- | --- | --- | --- |
| MENU-01 | Grupos e itens: Administrador | Itens por acesso | Adicional | PASSOU | — |
| MENU-02 | Grupos e itens: Recepção e Recepção restrita | Itens por acesso | Adicional | PASSOU | — |
| MENU-03 | Grupos e itens: Profissional | Itens por acesso | Adicional | PASSOU | — |
| MENU-04 | Grupos e itens: Administrador + Profissional (outra clínica) | Itens por acesso | Adicional | PASSOU | — |
| MENU-05 | Suporte na clínica: Sistema por último, faixa amarela, "Trocar clínica" | Itens por acesso | Adicional | PASSOU | — |
| MENU-06 | Administração do sistema: só os itens do Sistema, "Abrir uma clínica" | Itens por acesso | Adicional | PASSOU | — |
| MENU-07 | Tela aberta marcada (`aria-current`) nas 15 telas, por clique no menu | Navegação | Adicional | PASSOU | — |
| NAV-01 | "‹ Menu principal" e "Seções de Configurações ›" | Retorno (troca na tela) | Obrigatório | PASSOU | — |
| NAV-02 | Seção pela lateral e "‹ Profissionais" no formulário | Retorno à página anterior | Obrigatório | PASSOU | — |
| NAV-03 | "Trocar clínica" abre a escolha e volta para a clínica | Navegação | Adicional | PASSOU | — |
| FORM-01 | Preservação dos campos | Preservação dos campos | Obrigatório | NÃO APLICÁVEL | — |
| QA-01 | "Sair" à vista na lateral com muitos itens (Suporte, 1280×800) | Qualidade adicional | Adicional | FALHOU → corrigido | Baixa |
| QA-02 | Seção aberta à vista na lateral (Configurações › WhatsApp, 1280×720) | Qualidade adicional | Adicional | FALHOU → corrigido | Baixa |
| QA-03 | "Pular para o conteúdo" e ordem do Tab | Teclado | Adicional | PASSOU | — |
| QA-04 | Foco ao trocar menu × seções pelo teclado | Teclado | Adicional | PASSOU | — |
| QA-05 | Lateral parada ao rolar uma página longa | Layout | Adicional | PASSOU | — |
| QA-06 | Corte em 1024px (lateral) × 1023px (cabeçalho e barra inferior) | Larguras | Adicional | PASSOU | — |
| QA-07 | Agenda Dia com 4 colunas em 1280px, sem rolar de lado | Larguras | Adicional | PASSOU | — |
| QA-08 | Celular: "Mais" com grupos, soma das pendências, sem rolagem lateral | Larguras | Adicional | PASSOU | — |
| QA-09 | Console e respostas 5xx nas 15 telas | Qualidade adicional | Adicional | PASSOU | — |

### 5.1 Aprovados

- **MENU-01:** Hoje (Início, Agenda, Resumo do Dia), Pacientes (Pacientes, Atendimento 1, Relacionamento 2), Gestão
  (Métricas, Financeiro, Configurações); pé "Administrador · Sair"; sem "Trocar clínica" (uma clínica só).
- **MENU-02:** Recepção: Gestão só com Financeiro (sem Métricas e Configurações, como a matriz de acesso).
- **MENU-03:** Profissional: Pacientes sem Relacionamento; Gestão só com Métricas.
- **MENU-04:** Odonto Exemplo: grupos completos; pé "Administrador + Profissional".
- **MENU-05:** grupo "Sistema · só o Suporte" por último, com os 6 itens; pé "Suporte RecepClinic".
- **MENU-06:** em Sistema › Clínicas, a lateral mostra só o Sistema, com "Administração do sistema" e "Abrir uma
  clínica" no alto.
- **MENU-07:** cada clique abriu a tela certa, com o item marcado e sem rolagem lateral da página. Em
  Configurações, o item marcado no menu principal (escondido) e a seção "Clínica" na lateral.
- **NAV-01:** "Menu principal" mostra o menu (Configurações marcada) e leva o foco a "Seções de Configurações";
  esse botão volta às seções e leva o foco a "Menu principal".
- **NAV-02:** Profissionais pela lateral marca a seção; o formulário abre e "‹ Profissionais" volta à lista, com as
  seções na lateral.
- **NAV-03:** "Trocar clínica" abre `/admin/escolher-clinica`; escolher a clínica volta ao painel.
- **QA-03:** 1º Tab = "Pular para o conteúdo" (Enter leva o foco a `#conteudo`); depois "Trocar clínica", Início,
  Agenda, Resumo do Dia, Pacientes.
- **QA-04:** ver NAV-01.
- **QA-05:** Tecnologia › Jornada do bot rolada 3000px: a lateral fica no topo, com o "Sair" à vista.
- **QA-06:** 1024px: lateral, sem cabeçalho e sem barra inferior; 1023px: cabeçalho curto e barra inferior; sem
  rolagem lateral nos dois.
- **QA-07:** colunas da Agenda com largura de rolagem igual à visível (977 × 977).
- **QA-08:** "Mais" ativo no Relacionamento, com o contador 3 (1 + 2) e os grupos Pacientes, Gestão e Sistema.
- **QA-09:** nenhum erro de console e nenhuma resposta 5xx.

### 5.2 Falhas

Ver a seção 6.

### 5.3 Bloqueios

Nenhum.

### 5.4 Não aplicáveis

- **FORM-01:** a L1 e a L2 não mudaram formulários.

## 6. Achados

### 6.1 Defeitos confirmados

#### QA-01 · "Sair" fora da vista na lateral do Suporte

- **Severidade:** Baixa
- **Página ou fluxo:** qualquer tela da clínica aberta pelo Suporte
- **URL:** http://localhost:4321/admin/dashboard
- **Critério avaliado:** qualidade adicional (controle à vista)
- **Pré-condições:** Suporte dentro da Clínica Exemplo Saúde; janela 1280×800.
- **Passos executados:**
  1. Abrir o Início.
  2. Medir a posição do "Sair" na lateral.
- **Resultado esperado:** "Sair" à vista no pé da lateral.
- **Resultado observado:** a lateral inteira rolava (939px de conteúdo em 800px); o "Sair" ficava em 922px, abaixo
  da janela.
- **Impacto:** o Suporte precisa rolar a lateral para sair.
- **Evidência:** medição pelo navegador (`scrollHeight` 939, `clientHeight` 800, base do botão 922,75).
- **Correção (31/out):** só os itens rolam; a clínica (no alto) e o "Sair" (no pé) ficam fixos. **Retestado:** base
  do "Sair" em 784px numa janela de 800px.

#### QA-02 · Seção aberta de Configurações fora da vista

- **Severidade:** Baixa
- **Página ou fluxo:** Configurações › WhatsApp
- **URL:** http://localhost:4321/admin/configuracoes/whatsapp
- **Critério avaliado:** qualidade adicional (onde estou)
- **Pré-condições:** Suporte; janela 1280×720.
- **Passos executados:**
  1. Abrir Configurações › WhatsApp.
  2. Medir a posição da seção marcada na lateral.
- **Resultado esperado:** a seção aberta à vista.
- **Resultado observado:** "WhatsApp" marcada em 725–763px, abaixo da janela de 720px.
- **Impacto:** não se vê qual seção está aberta sem rolar a lateral.
- **Evidência:** medição pelo navegador.
- **Correção (31/out):** ao abrir a tela, a lateral rola até o item aberto. **Retestado:** item à vista (rolagem da
  lateral em 144px).

### 6.2 Suspeitas

Nenhuma.

### 6.3 Pontos não verificados

| Item | Motivo |
| --- | --- |
| Safari e iPhone real | só Chromium no local; o cliente valida no fim |
| Leitor de tela | sem leitor de tela no ambiente |
| Nome de clínica muito longo (3 linhas ou mais) | sem dado no seed; o nome quebra em até 2 linhas, com o nome inteiro no `title` |

## 7. Limitações

- Sem gravação de dados: só navegação e leitura.
- Contadores conferidos com os dados do seed (Atendimento 1, Relacionamento 2).

## 8. Evidências

- **Local:** `~/.playwright-mcp/` (fora do repositório)
- **Arquivos:** capturas de 1280×800 (Agenda e Configurações), 1440×900 (Agenda, Suporte), 900×800 e 390×844 ("Mais").
- **Dados sensíveis:** só dados fictícios do seed; nenhuma senha nas evidências.

## 9. Recomendações

1. Validar no staging pelo Safari do Mac e pelo iPhone (cliente, no fim).
2. Se o Suporte achar a lateral longa, avaliar recolher o grupo Sistema (decisão do cliente).
