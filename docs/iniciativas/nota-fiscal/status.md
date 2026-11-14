# Nota fiscal (NFS-e pelo Asaas)
> **A REPLANEJAR (cliente, 14/nov/2026):** o Asaas **não emitirá mais as notas**; ele fica só no faturamento do SaaS (F12). Motivo: o cadastro da subconta (documentos do titular, aprovação manual) pesa demais para o profissional. A D13 será revista. Caminhos a levantar: emissão direta no Emissor Nacional (certificado A1, sem terceiros) ou intermediário só de notas. Tudo abaixo descreve o que foi feito pelo Asaas (N1–N5), hoje no staging.
**Plano novo (aprovado pelo cliente em 14/nov):** `../../planejamento-nfse-provedor.md`, com a Focus NFe como primeiro provedor, a cobrança por CNPJ emissor e o preço configurável (inicial: R$ 49,90/mês, 100 notas, R$ 0,50 por excedente). Decididas: DP-1 (Start da Focus quando houver 3 clínicas), DP-2 (uma contratação por CNPJ, valendo em todas as clínicas) e DP-5. Faltam DP-3, DP-4 e DP-6 a DP-10; depois vem a P0. O cliente vai avisar o Asaas por e-mail (14/nov) que a emissão de notas sai do Asaas e que o faturamento do SaaS continua lá. No e-mail, pergunta se a reanálise do BaaS ainda é necessária sem subcontas; falta a resposta.
**Plano antigo:** `../../planejamento-nfse-asaas.md` (decisão D13; N-P1 a N-P7 na seção 14.7; roteiro da validação na 15.2).
- **Código:** N1–N5 na branch `nota-fiscal` (6 migrações `20270121120000`–`20270121170000`), **na `main` e no staging desde 13/nov** (branch apagada). Em
  12/nov: recebeu a `main` (merge `3b12ef3d`, 0 atrás e 11 à frente) e foi enviada ao `origin/nota-fiscal`.
- **Testes (12/nov, na branch):** `astro check` 0 erros; `npm test` 1226 ok; `npm run test:db` 1153 ok (após `db reset`).
- **Migrações no staging:** as 6 aplicadas em 13/nov (181 iguais ao local).
- **Revisão (13/nov, `/code-review` da branch inteira, 10 achados):** os 4 graves foram corrigidos: (1) `finish_asaas_*`
  só para `service_role`, o servidor grava o resultado pela plataforma; (2) erro 4xx depois de a nota existir no Asaas, 408 e
  429 não viram "recusada"; (3) a conciliação só dá por perdida a nota sem registro no Asaas depois de 15 min (era 3);
  (4) as 6 migrações renomeadas para `20270121120000`–`20270121170000`. Os 6 médios também: RPS só enviado no 1º envio
  (depois o Asaas conta), PDF sem fila de reenvio da mensagem (sem duplicar), fila de arquivos só dos últimos 7 dias e das
  mais novas, falha passageira (5xx/rede) não desliga a emissão, chave da subconta com 3 tentativas e aviso claro, subconta
  barrada se e-mail, celular, rua ou bairro do emissor migrado ainda forem provisórios.
- **Não implementado:** N6 (emissão real).
- **Bloqueios externos:** reanálise do BaaS pelo Asaas (aguardando), contador (PIS/COFINS), advogado (contrato do
  profissional pagador).
- **Validação no staging (14/nov, Claude + Playwright, Clínica Exemplo com o financeiro ligado):** passos 2 a 7 do roteiro 15.2
  passaram até onde o Asaas permite: emissor e lista de profissionais; troca "Como emite"; dados fiscais (CNPJ inválido mantém
  os campos); **subconta criada no Sandbox** (CEP e CNPJ repetido recusados com mensagem clara); contrato do profissional
  (Suporte define, profissional aceita); "Quem paga" (profissional exige login); CPF/e-mail/CEP do paciente (CEP preenche
  rua e bairro); pagamento com confirmação; nota bloqueada com "emissão não ligada".
- **Não validado:** envio da configuração fiscal/certificado (o Asaas recusa até aprovar o cadastro geral, manual); emitir,
  conferir, PDF, enviar e cancelar nota; cartão "Notas fiscais" da Assinatura (exige o preço da nota no contrato da clínica).
- **Dados de teste que ficaram no staging:** `finance` ligado na Clínica Exemplo; Dr. Bruno com CNPJ próprio fictício
  (13.897.827/0001-91), subconta Sandbox, pagador = profissional, contrato aceito e ligado ao login da recepção; 1 pagamento de R$ 600.
- **Próxima ação:** aprovar o cadastro da subconta no painel do Asaas Sandbox e repetir o envio do certificado e a emissão.
