# CRM (etapa paralela)

> **Estado atual (retomar daqui), 27/out/2026**
>
> - Branch `CRM` criada a partir da `main` em 27/out (commit `eca4b79`).
> - **Próximo:** o cliente descreve o CRM; depois, o planejamento (subetapas, decisões e validação) entra aqui.

## Como trabalhar nesta etapa

- Todo o código e a documentação do CRM ficam na branch **`CRM`**. A `main` segue com as etapas do piloto (B e C) e
  publica no staging a cada push; a `producao` publica na produção.
- **Parar o CRM e voltar ao piloto:** commit e push do que estiver em andamento na `CRM`, atualizar o bloco
  "Estado atual" deste arquivo e `git switch main`.
- **Voltar ao CRM:** `git switch CRM`, trazer o que mudou na `main` (`git merge main`) e retomar pelo bloco acima.
- Um push na `CRM` pode gerar só uma *preview* na Vercel; não muda o staging nem a produção.
- O CRM entra na `main` só com a aprovação do cliente, e as decisões de arquitetura novas vão para
  [`arquitetura.md`](arquitetura.md), como as D1–D11.

## Descrição do cliente

(a preencher)

## Planejamento

(a preencher depois da descrição)
