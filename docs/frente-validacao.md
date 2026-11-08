# Frente: validação do que está pendente

> **Estado atual (retomar daqui), 07/nov/2026.** Frente separada da nota fiscal a pedido do cliente (07/nov). Nada
> validado ainda nesta frente. O cliente valida no staging (`teste.recepclinic.com.br`, `main` em `c60ae26`), um item
> por vez, na ordem da tabela; o Claude registra o resultado aqui e corrige o que aparecer direto na `main` (ajustes da
> validação, sem branch). Validado o bloco multiprofissional (itens 1 e 2), a publicação na produção só com autorização.

## 1. O que validar

| # | O quê | Onde está o roteiro | Situação |
|---|---|---|---|
| 1 | Multiprofissional: especialidades (ME), convênios por profissional (MC), informações do bot por profissional (MI) e escolha do profissional no bot (MB) | [`planejamento-multiprofissional.md`](planejamento-multiprofissional.md), seção 8 | No staging, a validar |
| 2 | Serviços por profissional (MS: S2, S3, S1, S4) | [`planejamento-multiprofissional.md`](planejamento-multiprofissional.md), fim da seção 10 | No staging, a validar |
| 3 | Ajuste da Central que foi junto com o BaaS do Asaas (`9b22e00`) | [`planejamento-nfse-asaas.md`](planejamento-nfse-asaas.md), 13.10 | No staging e na produção, a validar |

Itens 1 e 2: conferir também, em clínica com **um profissional só** (a piloto do staging), que o bot e a Marcar ficaram
iguais a antes.

## 2. Depois de validar

- **Produção** (com autorização): publicar a `main` com as 5 migrações do bloco multiprofissional (`20261229120000`,
  `20261229130000`, `20261229140000`, `20261230120000`, `20261230130000`), pelo fluxo do [`producao.md`](producao.md)
  (simulação → aplicar → conferir → push na `producao`). Antes, conferir na produção quais serviços estão em várias
  agendas (viram cópias) e quais estão sem agenda (ficam desativados sem dono), e mostrar ao cliente.
- Registrar em cada plano o "Validado (data)" e atualizar este bloco de retomada.

## 3. Pendências fora do código (do cliente ou de terceiros)

Não são validação de tela; ficam aqui para não se perderem.

- **Asaas:** reanálise do BaaS (e-mail enviado em 07/nov; aguardando) e liberação da tokenização do cartão (pedida em
  07/nov; liberada, o Claude confere antes do 1º contrato com implantação no cartão).
- **Contrato × sistema** (divergências no [`planejamento-faturamento-saas.md`](planejamento-faturamento-saas.md)):
  multa e juros no Asaas e exportação dos dados em 60 dias.

## 4. Registro

(vazio: cada validação entra aqui com a data, o resultado e o que foi corrigido)
