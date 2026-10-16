# Relatório de testes de interface: R5 (Pagamento) e envio único do painel

## 1. Resumo da execução

- **Data:** 2026-10-16
- **Executado por:** Claude (skill `playwright-ui-form-best-practices`), a pedido do cliente
- **Resultado geral:** 3 falhas (1 Média, 2 Baixas), 3 bloqueios
- **Síntese:** a tela nova do Pagamento preserva todos os campos depois de um erro do servidor e grava
  um pagamento só mesmo com três toques seguidos. O envio único também funcionou num formulário sem
  confirmação (DMED) e deixou livre o "Baixar o arquivo da DMED". As falhas são de acessibilidade e
  de navegação: o erro de CPF de "Outra pessoa" é marcado num campo escondido (o foco se perde);
  "Fechar" num painel da nota perde o foco; o "Voltar" da ficha aberta pelo Pagamento pula o
  Pagamento (já era assim antes da R5).

| Status | Quantidade |
| --- | --- |
| PASSOU | 17 |
| FALHOU | 3 |
| BLOQUEADO | 3 |
| NÃO APLICÁVEL | 0 |
| **Total executado** | 23 |

## 2. Ambiente

- **URL base:** `http://localhost:4321` (servidor `npm run dev` do cliente)
- **Ambiente:** local, banco do seed (Supabase local). Gravação **autorizada pelo cliente** só no
  local, com limpeza no fim. A caixa "Emitir a nota fiscal agora" ficou sempre desmarcada: a clínica
  local está na Produção Restrita, e emitir chamaria a Receita.
- **Navegador e viewport:** Chromium (MCP Playwright), 1280×900 e 390×844
- **Versão/commit da aplicação:** `00083fc` + mudanças da R5 ainda sem commit
- **Usuários de teste:** Administrador, Recepção e Suporte da "Clínica Exemplo Saúde" (seed)

## 3. Escopo

- **Incluído:** Financeiro › Pagamento (`/admin/financeiro/pagamento/[id]`), vindo da Agenda (Dia) e
  da ficha do paciente; formulário "Registrar pagamento"; "Mais" do pagamento (Excluir pagamento,
  Cancelar nota); envio único (`src/scripts/sendOnce.ts`) no Pagamento e na DMED; celular; perfis.
- **Fora do escopo:** as outras telas do redesign (já testadas no relatório da R0 a R4).

## 4. Ferramentas utilizadas

- MCP Playwright (exploração). O projeto não tem `@playwright/test`; não foram criadas specs.
- `psql` no contêiner do banco local, para conferir o que foi gravado e limpar.

## 5. Cenários executados

| ID | Cenário | Critério | Tipo | Status | Severidade |
| --- | --- | --- | --- | --- | --- |
| NAV-01 | Agenda 19/10 › Mais › Pagamento › Voltar | Retorno à página anterior | Obrigatório | PASSOU | — |
| NAV-02 | Ficha do paciente › "Abrir" pagamento › Voltar | Retorno à página anterior | Obrigatório | PASSOU | — |
| NAV-03 | Pagamento › "Paciente: João Souza" › Voltar da ficha | Retorno à página anterior | Obrigatório | FALHOU | Baixa |
| NAV-04 | Registrar com sucesso, vindo da Agenda | Volta à origem com o aviso | Obrigatório | PASSOU | — |
| FORM-01 | Valor "abc" (forma, data, quem pagou, nome e CPF trocados) | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-02 | CPF inválido de "Outra pessoa" | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-03 | Cancelar nota com a explicação vazia | Validação antes da confirmação | Obrigatório | PASSOU | — |
| QA-01 | Erro de CPF de "Outra pessoa": aviso no campo e foco | Associação e foco | Adicional | FALHOU | Média |
| QA-02 | Envio duplo no Pagamento (3 toques: 2 na confirmação, 1 no botão) | Prevenção de duplicidade | Adicional | PASSOU | — |
| QA-03 | Duplo clique sem confirmação ("Salvar responsáveis" da DMED) | Prevenção de duplicidade | Adicional | PASSOU | — |
| QA-04 | "Baixar o arquivo da DMED" não trava | Exceção do envio único | Adicional | PASSOU | — |
| QA-05 | Voltar do navegador depois de um envio | Botões destravados | Adicional | PASSOU | — |
| QA-06 | "Mais" pelo teclado › Excluir pagamento › confirmação | Teclado e ação rara | Adicional | PASSOU | — |
| QA-07 | Painel "Cancelar nota": abrir pelo "Mais" e "Fechar" | Foco | Adicional | FALHOU | Baixa |
| QA-08 | Celular 390px: rolagem lateral, barra fixa e confirmação | Larguras de tela | Adicional | PASSOU | — |
| QA-09 | Perfil Recepção | Permissões na tela | Adicional | PASSOU | — |
| QA-10 | Perfil Suporte (só vê) | Permissões na tela | Adicional | PASSOU | — |
| QA-11 | Atendimento cancelado | Aviso no lugar do formulário | Adicional | PASSOU | — |
| QA-12 | Texto da confirmação (valor, forma, quem pagou, acima do preço) | Clareza | Adicional | PASSOU | — |
| QA-13 | Console e HTTP | Erros | Adicional | PASSOU | — |
| BLK-01 | PDF, XML e "Enviar nota" | — | Adicional | BLOQUEADO | — |
| BLK-02 | "Emitir nota" e "Emitir a nota fiscal agora" | — | Adicional | BLOQUEADO | — |
| BLK-03 | "Conferir na Receita" | — | Adicional | BLOQUEADO | — |

### 5.1 Aprovados

- **NAV-01:** o "Pagamento" do cartão (no "Mais", porque o atendimento não estava confirmado) abriu
  com `volta=/admin/agenda?date=2026-10-19`; o "Voltar" levou à Agenda de 19/10 ("1 atendimento em 4
  agendas" e o cartão do João Souza às 08:00).
- **NAV-02:** da ficha do João Souza, o "Abrir" do cartão de pagamentos levou ao Pagamento com a volta
  para a ficha; o "Voltar" voltou à ficha.
- **NAV-04:** o registro válido levou à Agenda de 19/10 com "Pagamento de R$ 120,00 registrado para
  João Souza.".
- **FORM-01:** antes do envio: valor `abc`, data `2026-10-15`, forma `credit_card`, quem pagou
  `other`, nome `Teste QA 01`, CPF `111.444.777-35`, nota desmarcada. Aviso "Informe um valor maior
  que zero." Depois: os mesmos valores, o bloco de "Outra pessoa" à vista, o valor com
  `aria-invalid="true"` e `aria-describedby="amount-hint erro-do-formulario"` e o foco nele. Só o
  valor corrigido (`120,00`) e enviado de novo: gravado 1 pagamento com os dados certos e nenhuma
  nota (conferido no banco).
- **FORM-02:** com o CPF `123.456.789-00`, o aviso "CPF inválido: confira os 11 dígitos." voltou e
  todos os campos ficaram iguais (valor `50,00`, `2026-10-14`, Dinheiro, Outra pessoa, `Teste QA 02`).
  Só o CPF corrigido: gravado.
- **FORM-03:** "Cancelar nota" com a explicação vazia: o navegador barrou ("Preencha este campo."),
  pôs o foco no campo e não abriu a confirmação. Nada foi enviado à Receita.
- **QA-02:** com a confirmação aberta, três toques seguidos (dois em "Registrar pagamento" do diálogo
  e um no botão da tela): **1** pagamento gravado. Os dois botões (tela e barra do celular) ficaram
  desabilitados, com `aria-busy="true"`, e o da tela com "Registrando…".
- **QA-03:** duplo clique em "Salvar responsáveis": 1 envio e 1 barrado; a tela seguinte abriu com
  "Responsáveis da DMED salvos." e o botão destravado.
- **QA-04:** o formulário do arquivo tem `data-envio-livre`; o arquivo baixou e o botão continuou
  habilitado, sem `aria-busy`.
- **QA-05:** depois de "Excluir pagamento", o Voltar do navegador reabriu a tela sem botão travado.
  No `npm run dev` a página pode não vir do cache do navegador; o destravar pelo `pageshow` não foi
  isolado.
- **QA-06:** Enter no "Mais" abriu o menu com o foco em "Excluir pagamento"; Enter abriu a confirmação
  ("Excluir o pagamento?", com valor, forma e quem pagou) e fechou o menu. Confirmado: "Pagamento
  excluído.", "Pagamentos (1)", Pago voltou a R$ 120,00 e o excluído ficou em "1 pagamento excluído",
  riscado, com "excluído em 16/10 às 19:38".
- **QA-08:** em 390px, `scrollWidth` 375 (sem rolagem lateral); o último link da tela fica acima da
  barra fixa; o botão da tela some e o "Registrar" da barra abre a mesma confirmação
  ("João Souza: R$ 180,00 (Pix), pago por Maria Souza.").
- **QA-09:** a Recepção vê o formulário; num pagamento com nota emitida não há "Mais" (excluir só sem
  nota; cancelar nota só o Administrador).
- **QA-10:** o Suporte vê "Só a Recepção e o Administrador da clínica registram pagamentos.", sem
  formulário, sem barra do celular, sem "Mais" e sem "Emitir nota".
- **QA-11:** atendimento cancelado: selo "Cancelado", "Atendimento cancelado ou com falta: não recebe
  pagamento novo." e nenhum formulário.
- **QA-12:** a confirmação traz o valor, a forma e quem pagou, e o aviso "fica acima do preço" quando
  vale. O botão mostra o valor ("Registrar R$ 120,00").
- **QA-13:** nenhum erro no console nas telas testadas; nenhuma resposta 5xx (a única 404 foi a do
  endereço inexistente usado de propósito na conferência anterior do envio único).

### 5.2 Falhas

Ver a seção 6.

### 5.3 Bloqueios

- **BLK-01:** a nota do seed não tem XML; sem ele, PDF, XML e "Enviar nota" não aparecem.
- **BLK-02:** emitir chamaria a Produção Restrita da Receita (serviço externo).
- **BLK-03:** "Conferir na Receita" só aparece com a nota emitindo ou cancelando e também chamaria a
  Receita.

### 5.4 Não aplicáveis

- Nenhum.

## 6. Achados

### 6.1 Defeitos confirmados

#### QA-01 · O erro de CPF de "Outra pessoa" é marcado num campo escondido

- **Severidade:** Média
- **Página ou fluxo:** Pagamento › Registrar pagamento
- **URL:** `/admin/financeiro/pagamento/e43e1032-…?volta=…`
- **Critério avaliado:** qualidade adicional (associação da mensagem ao campo e foco)
- **Pré-condições:** paciente sem CPF no cadastro (João Souza), o que gera o campo escondido
  `payer_cpf_patient`.
- **Passos executados:**
  1. Escolher "Outra pessoa", preencher o nome e o CPF `123.456.789-00`.
  2. Registrar e confirmar.
- **Resultado esperado:** o CPF de "Outra pessoa" com `aria-invalid` e o foco nele.
- **Resultado observado:** `aria-invalid="true"` foi para `payer_cpf_patient` (escondido e
  desabilitado); o campo à vista ficou sem marca e o foco foi para o `BODY`.
- **Campos perdidos:** nenhum (os valores ficaram, ver FORM-02).
- **Impacto:** quem usa teclado ou leitor de tela não é levado ao campo errado.
- **Evidência:** leitura dos campos `payer_cpf` depois do erro (seção 5.1, FORM-02).
- **Causa provável:** `pointToError` (`src/scripts/keepFormValues.ts`) roda antes do script da tela
  mostrar o bloco de quem pagou; nessa hora todos os `payer_cpf` estão à vista e habilitados, e o
  primeiro é o do paciente. A ordem dos campos é a mesma de antes da R5, então é provável que já
  acontecesse.
- **Recomendação:** apontar o erro depois do script da tela (ex.: o Pagamento chama de novo, ou o
  `pointToError` espera o próximo quadro) ou escolher o campo `payer_cpf` que fica à vista.

#### QA-07 · "Fechar" num painel da nota perde o foco

- **Severidade:** Baixa
- **Página ou fluxo:** Pagamento › "Mais" › Cancelar nota (o "Enviar nota" usa o mesmo código)
- **URL:** `/admin/financeiro/pagamento/c7b1872e-…`
- **Critério avaliado:** qualidade adicional (teclado e foco)
- **Passos executados:**
  1. "Mais" › "Cancelar nota": o painel abre com o foco no motivo (ok).
  2. "Fechar".
- **Resultado esperado:** o foco volta ao botão que abriu o painel ("Mais" ou "Enviar nota").
- **Resultado observado:** o foco foi para o `BODY` (quem usa teclado recomeça do topo). O item
  "Cancelar nota" do "Mais" não tem `aria-controls`.
- **Recomendação:** guardar quem abriu e devolver o foco a ele ao fechar; `aria-controls` no item.

#### NAV-03 · O "Voltar" da ficha aberta pelo Pagamento pula o Pagamento

- **Severidade:** Baixa
- **Página ou fluxo:** Agenda › Pagamento › "Paciente: João Souza ›" (ou o nome no alto) › Voltar
- **URL:** ficha `…/pacientes/89be3d5f-…?volta=%2Fadmin%2Fagenda%3Fdate%3D2026-10-19`
- **Critério avaliado:** retorno à página anterior
- **Resultado esperado:** voltar ao Pagamento.
- **Resultado observado:** voltou à Agenda de 19/10. Os links do paciente levam a volta do próprio
  Pagamento (`volta`), e não o endereço do Pagamento. O link do rodapé já fazia isso antes da R5; o
  nome no alto, que é novo, segue igual.
- **Evidência:** `nav03-voltar-ficha.png`.
- **Recomendação:** nos dois links, usar como volta o endereço atual do Pagamento (com a volta dele).
  Regra do cliente: todo "Voltar" leva à tela de onde se veio.

### 6.2 Suspeitas

#### S-01 · O "Registrar pagamento" do diálogo não confere a trava

- O diálogo fecha no primeiro toque, então uma pessoa não consegue tocar duas vezes nele. Num toque
  repetido por script, `form.submit()` é chamado duas vezes; no teste ficou 1 pagamento só, porque a
  segunda navegação substitui a primeira, mas isso depende do navegador.
- **O que falta para confirmar:** repetir em outros navegadores (Safari e Firefox). Reforço barato:
  o diálogo ignora o aceite quando o formulário já está com `data-sending`.

### 6.3 Pontos não verificados

| Item | Motivo |
| --- | --- |
| PDF, XML e Enviar nota | A nota do seed não tem XML |
| Emitir nota e Conferir na Receita | Chamariam a Receita (Produção Restrita) |
| Destravar pelo `pageshow` com a página vinda do cache | O `npm run dev` pode não usar o cache do navegador |
| Leitor de tela | Verificados atributos e foco, não a fala |
| Perfil Profissional | Não testado |

## 7. Limitações

- A emissão da nota ficou de fora (caixa sempre desmarcada) para não chamar a Receita.
- Gravados só no banco local: 2 pagamentos de teste (um deles excluído pela tela), 1 registro de
  geração da DMED e 3 acessos do Suporte. **Tudo apagado no fim**; as contagens voltaram às de antes
  (pagamentos 1, notas 1, registro fiscal 1). Os cadastros financeiros (`contact_finance`,
  `patient_finance`) não mudaram. O "Salvar responsáveis" da DMED regravou os mesmos valores; só a
  data de alteração dessa linha ficou com 16/10.

## 8. Evidências

- **Local:** `~/.playwright-mcp/r5-teste/` (fora do repositório)
- **Arquivos:** `form01-erro-valor.png`, `nav03-voltar-ficha.png`, `qa07-celular-confirmacao.png`
- **Dados sensíveis:** só dados fictícios do seed; senhas não aparecem. O arquivo da DMED baixado
  no QA-04 foi apagado.

## 9. Recomendações

1. QA-01: apontar o erro de CPF no campo à vista e pôr o foco nele.
2. NAV-03: os links do paciente no Pagamento voltam para o Pagamento.
3. QA-07: devolver o foco ao botão que abriu o painel.
4. S-01: o aceite do diálogo respeita a trava do envio único.
5. Campo com erro sem marca visual (só `aria-invalid`): no Valor, a borda ficou verde (foco), sem
   vermelho. Sugestão: borda vermelha em `[aria-invalid=true]` nos campos do redesign.

## 10. Status das correções

> 16/10/2026, a pedido do cliente ("sim": corrigir as 3 falhas e a suspeita antes do commit da R5).
> Retestadas no mesmo ambiente local, como Administrador, sem gravar dados (o CPF inválido e o valor
> "abc" são recusados pelo servidor). Checagem de tipos sem erros e 496 testes automáticos passando.

| ID | Correção | Reteste |
| --- | --- | --- |
| QA-01 | `pointToError` (`src/scripts/keepFormValues.ts`) escolhe, entre os campos com o mesmo nome, o que está à vista, e roda depois dos scripts da tela (`DOMContentLoaded` + `setTimeout`) | CPF `123.456.789-00` em "Outra pessoa": `aria-invalid` e foco em `payer_cpf_other`; o do paciente sem marca. Valor "abc": marca e foco no Valor, como antes. CORRIGIDO |
| NAV-03 | Os links do paciente no Pagamento levam como volta o endereço do próprio Pagamento (com a volta dele) | Agenda 19/10 › Pagamento › Paciente › Voltar: Pagamento; Voltar: Agenda 19/10. CORRIGIDO |
| QA-07 | Ao fechar um painel da nota, o foco volta a quem abriu (o "Mais", quando foi por ele); `aria-controls` no item do "Mais" | "Mais" › Cancelar nota › Fechar: foco em "Mais ações do pagamento de R$ 300,00"; `aria-expanded="false"`. CORRIGIDO |
| S-01 | O aceite do diálogo (`src/scripts/confirmDelete.ts`) não envia de novo um formulário já enviado | Dois aceites seguidos por script: 1 `submit()`. CORRIGIDO |

A sugestão da borda vermelha no campo com erro (recomendação 5) fica para decisão do cliente.
