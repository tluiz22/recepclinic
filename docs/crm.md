# CRM (etapa paralela)

> **Estado atual (retomar daqui), 28/out/2026.** Plano ativo e decisões que valem em
> [`analises/plano-evolucao-relacionamento.md`](analises/plano-evolucao-relacionamento.md); o que veio antes, em
> [`analises/crm-arquivo.md`](analises/crm-arquivo.md) (só por busca).
>
> - **No staging, validado pelo cliente** (nada na produção):
>   - **Relacionamento** A1/A2 (27/out): central de pendências com 8 abas, item próprio na Matriz.
>   - **B0** (28/out): o texto das conversas fica no app do WhatsApp (D12).
>   - **P1 Documentos** (28/out): aba "Documentos" na ficha do paciente; foto ou PDF até 10 MB; para todas as
>     clínicas (Q25).
>   - **P2 Anotações** (28/out): aba "Anotações" no lugar das Observações (as antigas viraram a 1ª anotação).
> - **Desfeito a pedido do cliente:** o "Registrar contato" (C2, Q18).
> - **P3 Lembretes** (28/out, **no staging**, aguardando a validação do cliente): aba "Lembretes" na ficha e
>   "Lembretes da equipe" no Relacionamento (seção 19.3 do plano).
> - **Branches:** `main` e `CRM` iguais em 28/out. Linha de base dos testes: 723 de unidade e 676 de banco.

## Como trabalhar nesta etapa

- Todo o código e a documentação do CRM ficam na branch **`CRM`**. A `main` segue com as etapas do piloto (B e C) e
  publica no staging a cada push; a `producao` publica na produção.
- **Parar o CRM e voltar ao piloto:** commit e push do que estiver em andamento na `CRM`, atualizar o bloco
  "Estado atual" deste arquivo e `git switch main`.
- **Voltar ao CRM:** `git switch CRM`, trazer o que mudou na `main` (`git merge main`) e retomar pelo bloco acima.
- Um push na `CRM` pode gerar só uma *preview* na Vercel; não muda o staging nem a produção.
- O CRM entra na `main` só com a aprovação do cliente, e as decisões de arquitetura novas vão para
  [`arquitetura.md`](arquitetura.md), como as D1–D11.
