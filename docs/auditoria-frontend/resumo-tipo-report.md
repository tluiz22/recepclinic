# Relatório de testes de interface: Resumo do Dia com a etiqueta do tipo (proposta A)

## 1. Resumo da execução

- **Data:** 2026-10-19
- **Executado por:** Claude (MCP Playwright)
- **Resultado geral:** nenhuma falha; 2 abas sem dados para conferir a etiqueta na tela.
- **Síntese:** na aba "Resumo do dia", a coluna Atendimento mostra a etiqueta do tipo na cor do serviço (Exame em
  ciano, Consulta em oliva), o serviço e, abaixo, a agenda e o local; no celular, na mesma ordem. A Lista de espera
  traz a etiqueta no título do grupo; Envios, ao lado do serviço. Nenhuma aba passa da tela.

| Status | Quantidade |
| --- | --- |
| PASSOU | 6 |
| FALHOU | 0 |
| BLOQUEADO | 2 |
| NÃO APLICÁVEL | 1 |
| **Total executado** | 9 |

## 2. Ambiente

- **URL base:** `http://localhost:4321/admin/consultas`
- **Ambiente:** local, banco do seed (só leitura)
- **Navegador e viewport:** Chromium; 390 e 1280px
- **Versão/commit da aplicação:** `ce92ab8` com a mudança ainda sem commit
- **Usuário de teste:** Administrador da Clínica Exemplo Saúde (seed)

## 3. Escopo

- **Incluído:** abas Resumo do dia, Lembretes, Lista de espera, Aguardando remarcação, Envios e A registrar (as que
  mostram o serviço).
- **Fora do escopo:** ações das abas (não mudaram).

## 4. Ferramentas utilizadas

- MCP Playwright; `npm test` (539) e `npm run check` (0 erros).

## 5. Cenários executados

| ID | Cenário | Critério | Tipo | Status | Severidade |
| --- | --- | --- | --- | --- | --- |
| V-01 | Resumo do dia 21/10 (1280px): "Exame" e "Consulta" como etiquetas na cor do serviço; serviço abaixo; agenda e local por último | Proposta A | Adicional | PASSOU | — |
| V-02 | Resumo do dia 21/10 (390px): etiqueta e serviço na mesma linha, agenda e local abaixo; sem rolagem lateral | Proposta A | Adicional | PASSOU | — |
| V-03 | Lista de espera: etiqueta "Consulta" no título do grupo, antes de "Dra. Helena Costa · Consulta pediátrica" | Decisão do cliente | Adicional | PASSOU | — |
| V-04 | Envios: etiqueta ao lado do serviço do atendimento com falha | Decisão do cliente | Adicional | PASSOU | — |
| V-05 | Todas as abas abrem (200) e nenhuma passa da tela em 1280px | Larguras | Adicional | PASSOU | — |
| V-06 | Cancelado: etiqueta e serviço continuam, com o horário riscado | Proposta A | Adicional | PASSOU | — |
| B-01 | Lembretes com a etiqueta | Decisão do cliente | Adicional | BLOQUEADO | — |
| B-02 | Aguardando remarcação com a etiqueta | Decisão do cliente | Adicional | BLOQUEADO | — |
| FORM-01 | Preservação dos campos após erro | Preservação dos campos | Obrigatório | NÃO APLICÁVEL | — |

### 5.3 Bloqueios

- B-01 e B-02: nenhum lembrete enviado nem atendimento aguardando remarcação no seed. O código usa a mesma etiqueta das
  outras abas; conferir no staging.

## 6. Achados

Nenhum defeito e nenhuma suspeita.

## 7. Limitações

- Só Chromium; leitura sem gravar dados.

## 8. Evidências

- `docs/auditoria-frontend/evidencias/resumo-tipo-1280.png`, `resumo-tipo-390.png`, `resumo-tipo-lista-espera.png`

## 9. Recomendações

1. No staging, conferir Lembretes e Aguardando remarcação.
