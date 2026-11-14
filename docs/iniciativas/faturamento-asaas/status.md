# Faturamento do SaaS (Asaas)
**Plano:** `../../planejamento-faturamento-saas.md` (o cabeçalho dele diz "branch local", **desatualizado**: a
`faturamento` foi juntada na `main`, commit `3919ca4e`, F12.1–F12.8).
- **Código (na `main` e na produção desde 07/nov, `47e086d`; validado):** F12.1–F12.8. Demos sem o módulo financeiro até ficar pronto.
- **Tokenização do cartão em produção: aprovada pelo Asaas (cliente, 14/nov); falta validar com um pagamento real no Checkout** (a API não confirma sem os dados de um cartão).
- **Contrato:** texto revisado e aprovado como está (cliente, 14/nov); qualquer ajuste, o cliente traz.
- **Nota fiscal:** o Asaas não emitirá mais (burocracia, cliente, 14/nov); fica só no faturamento do SaaS.
- **Bloqueio externo restante:** reanálise do BaaS pelo Asaas, em andamento (e-mail de 07/nov).
- **Divergências contrato × sistema:** multa e juros no Asaas; exportação dos dados em 60 dias (seção do plano).
- **Próxima ação:** validar a tokenização com um pagamento real no cartão (valor baixo, na clínica piloto) e fazer o 1º teste de ciclo em produção; faltam o valor combinado com a clínica piloto, conferir avisos do Asaas desligados (11.11) e o módulo financeiro ligado na clínica. Validação e produção: feitas (14/nov: implantado conta como validado).
- **Teste em produção combinado (cliente, 14/nov):** cartão, R$ 25,00/mês, implantação 0, só para provar a tokenização. Banco de produção conferido (só leitura): 1 clínica (Dra. Ana Karina), sem `finance`, sem conta, contrato nem cobrança; 0 eventos do webhook; 4 rotinas ativas. **O cliente fará depois:** ligar `finance` na Matriz, criar a conta de cobrança e o contrato (Asaas automático, cartão, primeiro vencimento próximo), aceitar e cadastrar um cartão real no Checkout. **Claude então:** conferir no banco (contrato ativo, token, eventos, conciliação) e a 1ª cobrança; depois cancelar (arrependimento até 7 dias estorna e **suspende a clínica**; avaliar clínica de teste de produção). Conferir antes os avisos do Asaas desligados (11.11).
