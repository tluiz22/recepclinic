# Roadmap (fonte única do estado)

> Atualizado em 12/nov/2026 (etapas que faltam da recepção digital). Só se edita na `main`. Marcas: **Código** = conferido no
> git; **Doc** = só o que o documento afirma; **A confirmar** = depende do cliente. Detalhe de cada frente: `status.md`.

## Ambientes
- **Produção** (`app.recepclinic.com.br`, branch `producao` = `2fffd62`, 11/nov): sem a F3f (bot enxuto). Fluxo: `producao.md`.
- **Staging** (`teste.recepclinic.com.br`) = `main`: produção + vários responsáveis (VR) + F3f. Migrações até `20270119120000`.

## Iniciativas abertas
| Frente | Estado | Branch | Bloqueio externo | Próxima ação |
|---|---|---|---|---|
| [Recepção digital](iniciativas/recepcao-digital/status.md) | F1–F5b na `main`; F3f validada no staging, **aguarda autorização do cliente para a produção**. **Faltam:** produção da F3f, validação da F5b, **F6 (Métricas e recuperação)**, limpeza do `/agendar` | — (juntada) | Meta: modelo `rc_lembrete_v2`; reunião com a clínica (RD6) antes da F6; advogado (LGPD) antes da produção | Etapas que faltam em ordem: 1) produção da F3f; 2) F5b validada; 3) F6; 4) limpeza do `/agendar` (detalhe no `status.md`) |
| [Nota fiscal (NFS-e)](iniciativas/nota-fiscal/status.md) | N1–N5 na branch; validação pendente; N6 bloqueada | `nota-fiscal` (10 à frente, 14 atrás da `main`) | Asaas (BaaS), contador, advogado | Decidir com o cliente se atualiza com a `main` |
| [Faturamento SaaS (Asaas)](iniciativas/faturamento-asaas/status.md) | Código na `main` (F12.1–F12.8) | — (juntada) | Asaas: reanálise do BaaS e tokenização do cartão | Conferir tokenização antes do 1º contrato no cartão |
| [Biomedical](iniciativas/biomedical/status.md) | Proposta enviada em 09/nov | — | Portal, F3, F5, F6 no ar | Parada até a F3f ir à produção |
| [Painel de pendências do Suporte](iniciativas/painel-suporte/status.md) | Decidido; nada implementado | — | — | Só quando o cliente pedir |

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
