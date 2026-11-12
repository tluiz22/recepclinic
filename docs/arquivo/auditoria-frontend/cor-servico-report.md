# Relatório de testes de interface: cor de cada serviço (Agenda e Horários)

## 1. Resumo da execução

- **Data:** 2026-10-19
- **Executado por:** Claude (MCP Playwright)
- **Resultado geral:** nenhuma falha. Uma suspeita de usabilidade foi corrigida na rodada: na Semana, só o texto
  colorido ficava sutil, e o tipo virou uma etiqueta com o fundo da cor.
- **Síntese:**
  - Cada serviço sai com a sua cor na faixa do cartão (Dia), na etiqueta da Semana e na faixa do horário (Horários).
  - O Retorno continua roxo.
  - O horário de todos os serviços continua verde-claro.
  - Nada passa da tela, nas larguras e telas da seção 5 (V-05).

| Status | Quantidade |
| --- | --- |
| PASSOU | 7 |
| FALHOU | 0 |
| BLOQUEADO | 0 |
| NÃO APLICÁVEL | 1 |
| **Total executado** | 8 |

## 2. Ambiente

- **URL base:** `http://localhost:4321`
- **Ambiente:** local. 2 horários criados por SQL na agenda da Dra. Helena Costa (Terça, só Retorno pediátrico;
  Quinta, só Consulta pediátrica) e **apagados no fim**. Estado final igual ao inicial.
- **Navegador e viewport:** Chromium; 360, 390, 768, 1024, 1280 e 1440px
- **Versão/commit da aplicação:** `76faa16` com a mudança ainda sem commit
- **Usuário de teste:** Administrador da Clínica Exemplo Saúde (seed)

## 3. Escopo

- **Incluído:**
  - Agenda › Dia, incluindo o cartão da turma;
  - Agenda › Semana;
  - Resumo do Dia › A registrar;
  - Configurações › Horários.
- **Fora do escopo:** ações dos cartões (não mudaram).

## 4. Ferramentas utilizadas

- MCP Playwright.
- `npm test` (539 testes, 3 novos em `categoryStyle.test.ts`: ordem de criação, serviço novo sem mudar as outras
  cores, paleta que recomeça, Retorno roxo).
- `npm run check` (0 erros).

## 5. Cenários executados

| ID | Cenário | Critério | Tipo | Status | Severidade |
| --- | --- | --- | --- | --- | --- |
| V-01 | Semana 19/10: Consulta pediátrica (oliva), Avaliação inicial (índigo) e Espirometria (ciano) em cores diferentes | Decisão do cliente | Adicional | PASSOU | — |
| V-02 | Dia 19/10: faixa da Consulta pediátrica em oliva | Decisão do cliente | Adicional | PASSOU | — |
| V-03 | Horários: Consulta (oliva), Retorno (roxo) e todos os serviços (verde-claro) distintos | Decisão do cliente | Adicional | PASSOU | — |
| V-04 | Contraste do tipo sobre a faixa: oliva 6,97, rosa 7,16, sépia 7,39, índigo 8,41, ciano 7,47 (sobre o cartão âmbar, acima de 7,7) | Contraste | Adicional | PASSOU | — |
| V-05 | Sem rolagem lateral: Horários de 360 a 1440px; Dia, Semana e Resumo do Dia (A registrar) em 1440px | Larguras | Adicional | PASSOU | — |
| V-06 | Console: nenhum erro no Dia e na Semana | Qualidade | Adicional | PASSOU | — |
| S-01 | Semana: o tipo só com o texto colorido ficava sutil (oliva parecia marrom) | Usabilidade | Adicional | PASSOU após ajuste | — |
| FORM-01 | Preservação dos campos após erro | Preservação dos campos | Obrigatório | NÃO APLICÁVEL | — |

### 5.4 Não aplicáveis

- FORM-01: a mudança é só de exibição.

## 6. Achados

### 6.1 Defeitos confirmados

Nenhum.

### 6.2 Suspeitas

- S-01 (Semana, cor só no texto): ajustada na rodada. O tipo virou uma etiqueta com o fundo e a linha da cor do serviço.

### 6.3 Pontos não verificados

| Item | Motivo |
| --- | --- |
| Paleta recomeçando com mais de 5 Consultas e Exames | Coberta pelo teste automático; o seed tem 6 Consultas e Exames (o 6º repete a 1ª cor), mas eles não aparecem juntos nas telas testadas |
| Resumo do Dia com cartões | Sem atendimento a registrar no seed; o cartão é o mesmo do Dia |

## 7. Limitações

- Só Chromium.
- A cor depende da ordem de criação dos serviços do staging, que não é a do seed.

## 8. Evidências

- `docs/auditoria-frontend/evidencias/cor-servico-dia-1280.png`
- `docs/auditoria-frontend/evidencias/cor-servico-semana-1280.png`
- `docs/auditoria-frontend/evidencias/cor-servico-horarios-1280.png`

## 9. Recomendações

1. No staging, conferir "Consulta" e "Consulta Domiciliar" lado a lado na Semana e em Horários.
