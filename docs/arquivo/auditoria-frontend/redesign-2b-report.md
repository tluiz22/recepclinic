# Relatório de testes de interface: menu de Configurações com ícones (proposta 2B)

## 1. Resumo da execução

- **Data:** 2026-10-19
- **Executado por:** Claude (MCP Playwright)
- **Resultado geral:** nenhuma falha; 2 pontos não verificados.
- **Síntese:** no computador, cada seção tem o ícone e o grupo é um título pequeno, sem maiúsculas, com a linha ao
  lado; no celular, os mesmos ícones nos cartões. Navegação por clique e por teclado, "Voltar" dos formulários, selo
  "Suporte" e larguras de 360 a 1280px conferidos.

| Status | Quantidade |
| --- | --- |
| PASSOU | 10 |
| FALHOU | 0 |
| BLOQUEADO | 1 |
| NÃO APLICÁVEL | 1 |
| **Total executado** | 12 |

## 2. Ambiente

- **URL base:** `http://localhost:4321` (servidor de desenvolvimento)
- **Ambiente:** local, banco do seed
- **Navegador e viewport:** Chromium; 360, 390, 768, 1024 e 1280px de largura
- **Versão/commit da aplicação:** `c29bd0e` com as mudanças da 2B ainda sem commit
- **Usuários de teste:** Administrador da Clínica Exemplo Saúde; Suporte RecepClinic (seed)

## 3. Escopo

- **Incluído:** menu de seções de Configurações (`ConfigShell.astro`) no computador (a partir de 1024px) e no celular
  (botão "Seção: …"), em `/admin/configuracoes/*`.
- **Fora do escopo:** o conteúdo das seções (a 3B muda Horários depois).

## 4. Ferramentas utilizadas

- MCP Playwright; `npm test` (534) e `npm run check` (0 erros).

## 5. Cenários executados

| ID | Cenário | Critério | Tipo | Status | Severidade |
| --- | --- | --- | --- | --- | --- |
| V-01 | Computador (1024 e 1280px): 12 seções, todas com ícone; "Horários" marcada (`aria-current`) | Proposta 2B | Adicional | PASSOU | — |
| V-02 | Grupos "A clínica", "Atendimento", "Mensagens", "Financeiro": 13px, sem maiúsculas, com a linha ao lado | Proposta 2B | Adicional | PASSOU | — |
| V-03 | Celular (360, 390 e 768px): o mesmo menu nos cartões, com os ícones, grupos sem maiúsculas, linhas de 50px | Proposta 2B | Adicional | PASSOU | — |
| V-04 | Contraste: grupo 5,91:1; seção 13,03:1; seção atual 6,64:1; ícone 5,91:1 | Contraste | Adicional | PASSOU | — |
| V-05 | Larguras 360 a 1280px: sem rolagem lateral | Larguras de tela | Adicional | PASSOU | — |
| V-06 | Suporte dentro da clínica: "WhatsApp" com ícone e o selo "Suporte" dentro da linha | Selo | Adicional | PASSOU | — |
| NAV-01 | Clique em "Feriados" (menu do computador) abre Configurações › Feriados | Navegação | Adicional | PASSOU | — |
| NAV-02 | Teclado: foco visível em "Serviços"; Enter abre Serviços; Tab segue Clínica → Equipe → Profissionais → Locais | Teclado | Adicional | PASSOU | — |
| NAV-03 | Profissionais → "Novo profissional" → "‹ Profissionais" volta à lista (`/admin/configuracoes/profissionais`, título "Profissionais") | Retorno à página anterior | Obrigatório | PASSOU | — |
| QA-01 | Console e rede: nenhum erro, nenhum 5xx | Qualidade | Adicional | PASSOU | — |
| QA-02 | "Abrindo…" na linha tocada no celular | Estado de carregamento | Adicional | BLOQUEADO | — |
| FORM-01 | Preservação dos campos após erro | Preservação dos campos | Obrigatório | NÃO APLICÁVEL | — |

### 5.3 Bloqueios

- QA-02: o prefetch do Astro já tinha a página de destino; mesmo com a resposta atrasada de propósito, a troca foi na
  hora e o estado intermediário não apareceu (como na regressão de 18/out). O script do "Abrindo…" não mudou.

### 5.4 Não aplicáveis

- FORM-01: a 2B muda só o menu; nenhum formulário mudou.

## 6. Achados

### 6.1 Defeitos confirmados

Nenhum.

### 6.2 Suspeitas

Nenhuma.

### 6.3 Pontos não verificados

| Item | Motivo |
| --- | --- |
| Número de pendências do guia ao lado da seção | Nenhuma clínica do seed tem pendência; ocupa o mesmo lugar do selo "Suporte" (V-06) |
| "Abrindo…" no celular | Ver QA-02 |

## 7. Limitações

- Só Chromium; sem leitor de tela (ícones com `aria-hidden`; o nome acessível de cada link é o da seção).
- Entrar como Suporte gravou o registro de acesso que o sistema mantém, no banco local.

## 8. Evidências

- **No repositório:** `docs/auditoria-frontend/evidencias/2b-menu-1280.jpg`, `2b-menu-celular-390.jpg`,
  `2b-menu-suporte-1280.jpg` (só dados fictícios do seed).
- **Dados sensíveis:** nenhum; senha, cookies e tokens não registrados.

## 9. Recomendações

1. Nenhuma correção necessária. Na validação, conferir o número de pendências numa clínica nova no staging.
