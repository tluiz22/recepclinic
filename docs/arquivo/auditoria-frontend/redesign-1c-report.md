# Relatório de testes de interface: Agenda, tipo do atendimento (proposta 1C)

## 1. Resumo da execução

- **Data:** 2026-10-19
- **Executado por:** Claude (MCP Playwright)
- **Resultado geral:** nenhuma falha; 1 suspeita (turma sem o tipo), decidida pelo cliente, corrigida e retestada.
- **Síntese:** a faixa do tipo aparece no cartão do Dia e no Resumo do Dia, com o serviço e, no Retorno, a consulta
  de origem; a Semana mostra o tipo na primeira linha. Nada passa da tela de 360 a 1280px, o contraste fica acima de
  6,9:1, e o menu "Mais" e o "Voltar" da ficha seguem certos.

| Status | Quantidade |
| --- | --- |
| PASSOU | 11 |
| FALHOU | 0 |
| BLOQUEADO | 0 |
| NÃO APLICÁVEL | 1 |
| **Total executado** | 12 |

## 2. Ambiente

- **URL base:** `http://localhost:4321` (servidor de desenvolvimento)
- **Ambiente:** local, banco do seed (só leitura nesta rodada)
- **Navegador e viewport:** Chromium; 360, 390, 768 e 1280px de largura
- **Versão/commit da aplicação:** `81f4bee` com as mudanças da 1C ainda sem commit
- **Usuário de teste:** Administrador da Clínica Exemplo Saúde (seed)

## 3. Escopo

- **Incluído:** Agenda › Dia (`/admin/agenda`), Agenda › Semana (`/admin/agenda/semana`), Resumo do Dia
  (`/admin/consultas`, todas as abas), cartão compacto da turma, menu "Mais" do cartão, nome do paciente → ficha →
  "Voltar".
- **Fora do escopo:** Agenda › Mês e a busca de paciente (não mudaram); ações que gravam (Compareceu, Faltou, Cancelar).

## 4. Ferramentas utilizadas

- MCP Playwright (exploração e medidas no navegador); `npm test` (534 testes, 3 novos em `categoryStyle.test.ts`) e
  `npm run check`.

## 5. Cenários executados

| ID | Cenário | Critério | Tipo | Status | Severidade |
| --- | --- | --- | --- | --- | --- |
| V-01 | Dia 19/10: Consulta com a faixa "Consulta · Consulta pediátrica", fundo branco | Faixa do tipo | Adicional | PASSOU | — |
| V-02 | Dia 02/11: Retorno com a faixa roxa "Retorno · Retorno pediátrico · da consulta de 05/10/2026" | Faixa do tipo | Adicional | PASSOU | — |
| V-03 | Linha antiga "Retorno da consulta de …" no pé do cartão não aparece mais; etiqueta do serviço saiu | Sem repetição | Adicional | PASSOU | — |
| V-04 | Cartão cancelado (21/10, 09:00): faixa normal, horário riscado | Faixa do tipo | Adicional | PASSOU | — |
| V-05 | Semana 19/10 e 02/11: tipo na 1ª linha ("Consulta", "Exame", "Retorno" em roxo com a seta) | Semana | Adicional | PASSOU | — |
| V-06 | Resumo do Dia, abas "A registrar" e "Registradas": mesma faixa (com a data antes do horário) | Resumo do Dia | Adicional | PASSOU | — |
| V-07 | Larguras 360, 390, 768 e 1280px (Dia e Semana): sem rolagem lateral; faixa na largura toda do cartão, sem corte | Larguras de tela | Adicional | PASSOU | — |
| V-08 | Contraste da faixa: "Retorno" 6,92:1; serviço e origem 8,45:1; "Retorno" na Semana 7,71:1 | Contraste | Adicional | PASSOU | — |
| V-09 | Menu "Mais" do cartão do Retorno abre inteiro (a faixa não pôs `overflow: hidden` no cartão) | Menu do cartão | Adicional | PASSOU | — |
| NAV-01 | Dia 02/11 → nome do paciente → ficha → "Voltar": volta para `/admin/agenda?date=2026-11-02`, com o cartão do Retorno | Retorno à página anterior | Obrigatório | PASSOU | — |
| QA-01 | Console e rede nas telas acima: nenhum erro, nenhum 5xx | Qualidade | Adicional | PASSOU | — |
| FORM-01 | Preservação dos campos após erro | Preservação dos campos | Obrigatório | NÃO APLICÁVEL | — |

### 5.4 Não aplicáveis

- FORM-01: a 1C muda só a exibição do cartão e da Semana; nenhum formulário mudou.

## 6. Achados

### 6.1 Defeitos confirmados

Nenhum.

### 6.2 Suspeitas

#### S-01 · Turma sem o tipo do atendimento

- **Página ou fluxo:** Agenda › Dia, cartão da turma (Espirometria, 21/10, 07:00, agenda Exames)
- **Observado:** o cartão da turma mostra "Turma" e "Espirometria · 2 pacientes", mas não "Exame"; os cartões dos
  pacientes dentro dela são compactos e, como antes, não têm a faixa.
- **Por que é suspeita:** a proposta 1C não desenhou a turma. Na Semana, os pacientes da turma já aparecem com "Exame".
- **O que falta para confirmar:** o cliente decidir se a turma ganha a faixa do tipo no alto.
- **Evidência:** `evidencias/1c-dia-turma-1280.jpg`.

### 6.3 Pontos não verificados

| Item | Motivo |
| --- | --- |
| Retorno sem consulta de origem ("sem consulta de origem") e com a origem cancelada | Sem esse caso no seed; o texto é o mesmo de antes, só mudou de lugar |
| Retorno dentro de uma turma (linha "Retorno da consulta de …" no cartão compacto) | Sem esse caso no seed |

## 7. Limitações

- Só Chromium; sem leitor de tela (conferidos o texto e os ícones com `aria-hidden`).
- Nenhuma ação que grava foi executada.

## 8. Evidências

- **No repositório:** `docs/auditoria-frontend/evidencias/1c-dia-retorno-360.jpg`, `1c-dia-turma-1280.jpg`,
  `1c-semana-1280.jpg` (só dados fictícios do seed).
- **Fora do repositório:** as demais capturas, na pasta temporária da sessão.
- **Dados sensíveis:** nenhum; senha, cookies e tokens não registrados.

## 9. Recomendações

1. Decidir a S-01 (faixa do tipo também no cartão da turma).

## 10. Correção (19/out)

- **S-01 decidida pelo cliente:** a turma ganha a faixa do tipo no alto, como os outros cartões ("Exame ·
  Espirometria"); o selo "Turma" continua na linha do horário, e a linha de baixo fica só com o número de pacientes.
- **Retestada:** 21/10 em 360, 768 e 1280px: faixa na largura toda do cartão, sem rolagem lateral e sem erro no
  console. Evidência: `evidencias/1c-turma-faixa-1280.jpg`.
