# Roadmap (fonte única do estado)

> Atualizado em 13/nov/2026 (nota fiscal na `main`). Só se edita na `main`. Marcas: **Código** = conferido no
> git; **Doc** = só o que o documento afirma; **A confirmar** = depende do cliente. Detalhe de cada frente: `status.md`.

## Ambientes
- **Produção** (`app.recepclinic.com.br`, branch `producao` = `cd60a03b`, 12/nov): com a F3f e a F6. Fluxo: `producao.md`.
- **Staging** (`teste.recepclinic.com.br`) = `main`: produção + vários responsáveis (VR) + F3f + F6 (12/nov). Migrações até `20270121170000` (nota fiscal, 13/nov).

## Iniciativas abertas
| Frente | Estado | Branch | Bloqueio externo | Próxima ação |
|---|---|---|---|---|
| [Recepção digital](iniciativas/recepcao-digital/status.md) | F1–F6 na `main` e no staging, **tudo validado pelo cliente (12/nov)**, incluindo F3f, F5b e F6. **F3f e F6 na produção desde 12/nov**. **Limpeza do código do `/agendar` feita na `main` (12/nov, ainda não publicada)**; falta apagar a tabela `booking_links` (migração) | — (juntada) | Meta: modelo `rc_lembrete_v2`; reunião com a clínica (RD6, só se a clínica usar horário por convênio); advogado (LGPD) antes da produção | Publicar a limpeza; depois a migração que apaga `booking_links` (detalhe no `status.md`) |
| [Nota fiscal (NFS-e)](iniciativas/nota-fiscal/status.md) | N1–N5 na `main` e no staging (13/nov), revisão feita; validação pelo roteiro 15.2 pendente; N6 bloqueada | — (juntada) | Asaas (BaaS), contador, advogado | Validar pelo roteiro 15.2 no staging |
| [Faturamento SaaS (Asaas)](iniciativas/faturamento-asaas/status.md) | Código na `main` (F12.1–F12.8) | — (juntada) | Asaas: reanálise do BaaS e tokenização do cartão | Conferir tokenização antes do 1º contrato no cartão |
| [Funil do portal e Usabilidade](iniciativas/usabilidade/status.md) | U1 e U2 juntas na `main`, no staging e na produção (13/nov), aguardando a validação do cliente | — | — | Validar a aba Usabilidade e o funil na produção; depois, os sinais que pedem gravação nova (formulário com erro, cancelamento desfeito) |
| [Biomedical](iniciativas/biomedical/status.md) | Proposta enviada em 09/nov | — | Portal, F3, F5, F6 no ar | F3f já na produção; retomar a implantação quando o cliente pedir |
| [Segurança e conformidade (BaaS do Asaas)](iniciativas/seguranca-baas/status.md) | Planejamento; 7 políticas e planos adotados em 13/nov (acessos, logs, incidentes, vulnerabilidades, fornecedores, continuidade, código seguro); varredura no GitHub ativa; etapas S1–S10 a planejar | — | Advogado, contador, Asaas (avaliação BaaS) | S1: corrigir as 22 vulnerabilidades das bibliotecas (1 crítica) e tratar os PRs do Dependabot |
| [Painel de pendências do Suporte](iniciativas/painel-suporte/status.md) | Decidido; nada implementado | — | — | Só quando o cliente pedir |

## Frentes finalizadas
[Comprovantes no WhatsApp](iniciativas/comprovantes/status.md): na `main` e na produção desde 12/nov.

## Pendências avulsas
Limpeza de `booking_horizon_days`/`consultation_age_limit_years`; onde mostrar fotos; F11 (T3.1); 1º backup diário da
produção; advogado (páginas legais, contrato, termo de dados); verificação da empresa na Meta; site `www`
(`site-plano.md`, **A confirmar**).

## A confirmar com o cliente (estado de validação)
Multiprofissional (ME/MC/MI/MB/MS), Central de Atendimento, assistente/BC, implantação segura (IS), pedido não
concluído (PN), menu lateral, vários responsáveis na produção e site `www`. Os documentos antigos dizem "cliente
valida", mas a linha do tempo indica que estão publicados; **não tratar como concluídos sem confirmação**.

## Módulos (fichas curtas; o detalhe completo está em `arquivo/modulos/`, só por `grep`)
[Central de atendimento](modulos/central-atendimento.md) · [Bot e assistente](modulos/bot-assistente.md) ·
[Multiprofissional](modulos/multiprofissional.md) · [Vários responsáveis](modulos/varios-responsaveis.md) ·
[Ajuda contextual](modulos/ajuda-contextual.md) · CRM: `arquivo/crm.md`.
