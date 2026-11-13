# Nota fiscal (NFS-e pelo Asaas)
**Plano:** `../../planejamento-nfse-asaas.md` (decisão D13; N-P1 a N-P7 na seção 14.7; roteiro da validação na 15.2).
- **Código:** N1–N5 na branch `nota-fiscal` (6 migrações `20261231120000`–`20261231170000`), **fora da `main`**. Em
  12/nov: recebeu a `main` (merge `3b12ef3d`, 0 atrás e 11 à frente) e foi enviada ao `origin/nota-fiscal`.
- **Testes (12/nov, na branch):** `astro check` 0 erros; `npm test` 1226 ok; `npm run test:db` 1153 ok (após `db reset`).
- **Migrações no staging:** as 6 têm timestamp anterior às já aplicadas lá (até `20270120140000`): `db push` exigirá
  `--include-all`, ou renomear para depois de `20270120140000` ao juntar.
- **Não implementado:** N6 (emissão real).
- **Bloqueios externos:** reanálise do BaaS pelo Asaas (aguardando), contador (PIS/COFINS), advogado (contrato do
  profissional pagador).
- **Próxima ação:** validação pelo roteiro 15.2; depois juntar
  (skill `juntar-branch`). revisto até: **A confirmar**.
