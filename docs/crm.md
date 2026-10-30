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
> - **P3 Lembretes** (28/out, no staging, validada): aba "Lembretes" na ficha e "Lembretes da equipe" no
>   Relacionamento (seção 19.3 do plano).
> - **CRM concluído (cliente, 28/out).** Nada na produção: vai junto com o resto, depois das correções na `main`.
> - **Branches:** a `CRM` entrou toda na `main` e foi excluída em 30/out. Linha de base dos testes em 28/out: 723 de
>   unidade e 676 de banco.

## Como trabalhar nesta etapa

- A branch **`CRM`** (28/out) entrou na `main` e foi excluída em 30/out. Etapa nova do CRM com código: branch
  recriada da `main`, pelas regras de branch paralela do `CLAUDE.md`.
- O CRM entra na `main` só com a aprovação do cliente, e as decisões de arquitetura novas vão para
  [`arquitetura.md`](arquitetura.md), como as D1–D11.
