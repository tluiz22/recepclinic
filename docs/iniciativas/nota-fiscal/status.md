# Nota fiscal (NFS-e pelo Asaas)
**Plano:** `../../planejamento-nfse-asaas.md` (decisão D13; N-P1 a N-P7 na seção 14.7; roteiro da validação na 15.2).
- **Código:** N1–N5 na branch `nota-fiscal` (6 migrações `20270121120000`–`20270121170000`), **fora da `main`**. Em
  12/nov: recebeu a `main` (merge `3b12ef3d`, 0 atrás e 11 à frente) e foi enviada ao `origin/nota-fiscal`.
- **Testes (12/nov, na branch):** `astro check` 0 erros; `npm test` 1226 ok; `npm run test:db` 1153 ok (após `db reset`).
- **Migrações no staging:** as 6 têm timestamp anterior às já aplicadas lá (até `20270120140000`): `db push` exigirá
  `--include-all`, ou renomear para depois de `20270120140000` ao juntar.
- **Revisão (13/nov, `/code-review` da branch inteira, 10 achados):** os 4 graves foram corrigidos: (1) `finish_asaas_*`
  só para `service_role`, o servidor grava o resultado pela plataforma; (2) erro 4xx depois de a nota existir no Asaas, 408 e
  429 não viram "recusada"; (3) a conciliação só dá por perdida a nota sem registro no Asaas depois de 15 min (era 3);
  (4) as 6 migrações renomeadas para `20270121120000`–`20270121170000`. **Ainda abertos (médios):** RPS reiniciado no
  reenvio da configuração, PDF duplicado na entrega, notas sem PDF travando a fila de 50, timeout desligando a emissão,
  chave da subconta perdida se o Vault falhar, dados falsos do emissor migrado indo ao Asaas.
- **Não implementado:** N6 (emissão real).
- **Bloqueios externos:** reanálise do BaaS pelo Asaas (aguardando), contador (PIS/COFINS), advogado (contrato do
  profissional pagador).
- **Próxima ação:** validação pelo roteiro 15.2; depois juntar
  (skill `juntar-branch`). revisto até: **A confirmar** (revisão de 13/nov em andamento; fecha com os médios).
