# Roadmap (fonte única do estado)

> Atualizado em 14/nov/2026 (Nota fiscal a replanejar; o que está implantado na produção conta como validado). Só se edita na `main`. Marcas: **Código** = conferido no
> git; **Doc** = só o que o documento afirma; **A confirmar** = depende do cliente. Detalhe de cada frente: `status.md`.

## Ambientes
- **Produção** (`app.recepclinic.com.br`, branch `producao` = `cd60a03b`, 12/nov): com a F3f e a F6. Fluxo: `producao.md`.
- **Staging** (`teste.recepclinic.com.br`) = `main`: produção + vários responsáveis (VR) + F3f + F6 (12/nov). Migrações até `20270121170000` (nota fiscal, 13/nov).

## Iniciativas abertas
| Frente | Estado | Branch | Bloqueio externo | Próxima ação |
|---|---|---|---|---|
| [Recepção digital](iniciativas/recepcao-digital/status.md) | F1–F6 na `main` e no staging, **tudo validado pelo cliente (12/nov)**, incluindo F3f, F5b e F6. **F3f e F6 na produção desde 12/nov**. **Limpeza do código do `/agendar` feita na `main` (12/nov, ainda não publicada)**; falta apagar a tabela `booking_links` (migração). **Correção do bot (E1–E5) na produção desde 13/nov (`8ee5a3d5`)**, com a migração `20270124120000` e a base publicada pelo Suporte; `main` e `producao` já no remoto | — (juntada) | Meta: modelo `rc_lembrete_v2`; reunião com a clínica (RD6, só se a clínica usar horário por convênio); advogado (LGPD) antes da produção | Publicar a limpeza do `/agendar` e a migração que apaga `booking_links` (só com autorização do cliente) |
| [Nota fiscal (NFS-e)](iniciativas/nota-fiscal/status.md) | **A REPLANEJAR (cliente, 14/nov): o Asaas deixa de emitir nota fiscal e fica só no faturamento do SaaS.** O código N1–N5 (emissão pelo Asaas) está na `main` e no staging, **ainda não publicado na produção, que não usa nota fiscal**; a D13 será revista | — (juntada) | Decisão do novo caminho (emissão direta no Emissor Nacional ou intermediário só de notas), contador, advogado | Replanejar a frente (levantar esforço, custo por nota e riscos) e rever a D13 com o cliente; publicar a `main` com o código N1–N5 não afeta a produção (sem uso de nota fiscal); decidir se sobe agora ou se remove antes (custo: migração de limpeza depois) |
| [Cadastro do profissional (abas e convite)](iniciativas/cadastro-profissional/status.md) | Validado pelo cliente, juntado na `main` e enviado ao staging (push 13/nov); sem migração | — (juntada) | — | Conferir a tela no staging e retomar a Nota fiscal no passo 2 |
| [Faturamento SaaS (Asaas)](iniciativas/faturamento-asaas/status.md) | Código na `main` e **na produção desde 07/nov** (F12.1–F12.8, validado no staging) | — (juntada) | Asaas: reanálise do BaaS e tokenização do cartão | Conferir tokenização antes do 1º contrato no cartão |
| [Funil do portal e Usabilidade](iniciativas/usabilidade/status.md) | U1 e U2 na `main`, no staging e **na produção desde 13/nov (validadas por estarem implantadas)** | — | — | Os sinais que pedem gravação nova (formulário com erro, cancelamento desfeito) |
| [Biomedical](iniciativas/biomedical/status.md) | Proposta enviada em 09/nov | — | Portal, F3, F5, F6 no ar | F3f já na produção; retomar a implantação quando o cliente pedir |
| [Segurança e conformidade (BaaS do Asaas)](iniciativas/seguranca-baas/status.md) | Planejamento; 7 políticas e planos adotados em 13/nov (acessos, logs, incidentes, vulnerabilidades, fornecedores, continuidade, código seguro); varredura no GitHub ativa; etapas S1–S10 a planejar | — | Advogado, contador, Asaas (avaliação BaaS) | S1: corrigir as 22 vulnerabilidades das bibliotecas (1 crítica) e tratar os PRs do Dependabot |
| [Painel de pendências do Suporte](iniciativas/painel-suporte/status.md) | Decidido; nada implementado | — | — | Só quando o cliente pedir |

## Frentes finalizadas
[Comprovantes no WhatsApp](iniciativas/comprovantes/status.md): na `main` e na produção desde 12/nov.

## Pendências avulsas
Limpeza de `booking_horizon_days`/`consultation_age_limit_years`; onde mostrar fotos; F11 (T3.1); 1º backup diário da
produção; advogado (páginas legais, contrato, termo de dados); verificação da empresa na Meta; site `www`
(`site-plano.md`, **A confirmar**).

## Validação
Multiprofissional, Central de Atendimento (com CA, PN, FE e NA), assistente/BC, implantação segura (IS), menu lateral
e vários responsáveis estão **na produção** (registro em `producao.md`, 02 a 12/nov): por decisão do cliente (14/nov),
o que está implantado conta como validado. **A confirmar:** só o site `www` (repositório `recepclinic-site`, fora
daqui; implantação não verificável neste repositório).

## Módulos (fichas curtas; o detalhe completo está em `arquivo/modulos/`, só por `grep`)
[Central de atendimento](modulos/central-atendimento.md) · [Bot e assistente](modulos/bot-assistente.md) ·
[Multiprofissional](modulos/multiprofissional.md) · [Vários responsáveis](modulos/varios-responsaveis.md) ·
[Ajuda contextual](modulos/ajuda-contextual.md) · CRM: `arquivo/crm.md`.
