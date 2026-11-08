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

- **08/nov:** ajuste pedido pelo cliente ao validar o item 1/2: escolha do profissional em Serviços e Horários (sem
  lembrar a escolha; só vem escolhido vindo de outra tela), especialidade em negrito e filtro em Agendas e
  Profissionais. Detalhe e roteiro: seção 11 do [`planejamento-multiprofissional.md`](planejamento-multiprofissional.md).
- **08/nov, melhorias pedidas pelo cliente (4 itens, um por vez):**
  1. **Desativar serviço desativa os horários só dele** (decisão: reativar traz de volta só os que saíram junto; o que
     cruza com outro horário fica desativado e a tela avisa). Migração `20270101120000` (`availability_windows.off_with_service`).
     Teste `tests/db/horarios-com-o-servico.test.ts`. Validar: serviço com horário próprio › Desativar (o aviso diz
     quantos horários) › Horários (sumiram) › Reativar (voltam).
  2. Boas-vindas do bot com o nome de quem já é cadastrado: **feito** (main). Decisões do cliente (08/nov): primeiro nome do contato; no texto próprio da clínica, o campo `{nome}` (sem cadastro, some com a vírgula da frente); número sem cadastro, a mensagem de antes.
  3. Menu do profissional sem exames e Informações gerais sem exames (com vários profissionais): a fazer.
  4. Perfil, prazo para oferecer horários e idade limite por profissional: a fazer (plano antes, tem migração).
- **08/nov, fotos (pedido do cliente):** cartão "Foto" no cadastro do profissional e no da pessoa da Equipe (PNG, JPG
  ou WebP até 4 MB; bucket privado `profile-photos`; o Administrador envia para todos, o profissional com login a
  própria). Migração `20270101130000`. Teste `tests/db/fotos-do-cadastro.test.ts`. **Pendente (cliente, 08/nov):**
  planejar e fazer, numa etapa posterior, onde a foto aparece fora do cadastro (listas, caixa de seleção do
  profissional, menu, página de agendar, bot).
