# RecepClinic

> **Estado atual: ver [`roadmap.md`](roadmap.md).** O histórico do bloco de retomada até 10/nov está no
> [`historico.md`](historico.md).

> **RecepClinic — a recepção inteligente da sua clínica.**

Plataforma SaaS para automatizar a recepção de clínicas: atendimento inicial pelo WhatsApp,
identificação da necessidade do paciente, agendamento, confirmação, cancelamento, remarcação,
lembretes, recuperação de pacientes, follow-ups e organização da agenda. Não é só um chatbot: é
uma recepção automatizada.

## Origem

Este repositório nasceu de uma cópia do sistema de gestão do consultório da Dra. Ana Karina
(repositório `tluiz22/site-dra-ana-karina`, branch `feature/gestao-consultorio`), no commit
`aad94dd`, marcado aqui com a tag **`piloto-base`**. O histórico anterior foi mantido para permitir
comparar as duas linhas.

## Duas linhas em paralelo

| | Projeto atual (piloto) | RecepClinic |
|---|---|---|
| Repositório | `tluiz22/site-dra-ana-karina` | `tluiz22/recepclinic` (este) |
| Papel | estabilidade, testes finais, possível produção e primeiro piloto | evolução para SaaS multi-clínica, nova arquitetura, possível piloto |
| Clínicas | uma (Dra. Ana Karina) | várias, com dados isolados |

Qualquer uma das duas pode virar o primeiro piloto. Nenhum dos dois cenários está descartado.

## Regras

1. **Sem merge cego.** O piloto é o remoto `piloto`, só leitura (`push` desativado). Nenhuma
   mudança dele entra aqui por merge ou cherry-pick automático. Cada uma é avaliada e registrada em
   [`triagem-piloto.md`](triagem-piloto.md).
2. **Classificação** de cada mudança do piloto:
   - **A — correção específica:** fica só no piloto.
   - **B — regra de negócio geral:** avaliar e implementar aqui do jeito da nova arquitetura.
   - **C — funcionalidade descoberta no piloto:** avaliar antes de incorporar.
   - **D — mudança arquitetural:** não copiar; analisar a necessidade aqui.
3. **Entender antes de mudar.** A sequência é: diagnóstico → limites e problemas → arquitetura alvo →
   plano de evolução → implementação aos poucos, com validação a cada etapa. Nenhuma mudança
   arquitetural grande antes de apresentar a análise e a estratégia.
4. **Sem generalizar antes da hora.** Nada de billing completo, planos complexos, marketplace ou
   dezenas de configurações antes de validar com uso real.
5. **Isolamento por clínica** em todos os níveis: banco, RLS, backend, APIs, autenticação,
   autorização, jobs, webhooks e integrações.
6. **O site da médica é externo.** O site institucional sai do produto e passa a ser um cliente dele.
7. **O piloto vem primeiro.** Nunca arriscar o piloto para acelerar o RecepClinic, nem limitar o
   RecepClinic só para preservar decisões do piloto.

## Infraestrutura

Banco (Supabase), Vercel e app da Meta próprios: staging em [`staging.md`](staging.md) e produção em
[`producao.md`](producao.md). Os segredos ficam fora do git (`.env` local e `.env.staging`); nunca usar as
credenciais do piloto (banco, agendador e Vault do Supabase, número e app da Meta, segredos).

## Como trabalhar (permanente)

- **Migrações:** staging com `supabase db push` (simular → aplicar → conferir → push do código); produção só com
  autorização, pelo [`producao.md`](producao.md) (`git push origin main:producao`).
- **Local:** OrbStack, `npm run db:start`, `npm run dev`; `npm test`, `npm run test:db` (PATH com `/opt/homebrew/bin`).
- **WhatsApp de testes:** `+55 61 9903-3143` ("Consultorio de Teste", staging).
- **Demos:** antes de apresentar, `node --env-file=.env.staging scripts/demo-clinicas.mjs --confirmar`.

## Documentos

**Manual de uso:** [`manual-de-uso.md`](manual-de-uso.md). **Comece por:** [`roadmap.md`](roadmap.md) (estado de tudo) e `iniciativas/<frente>/status.md` (a frente em andamento).

- **Permanentes:** [`arquitetura.md`](arquitetura.md) (D1–D14), [`triagem-piloto.md`](triagem-piloto.md),
  [`politica-pedidos-de-autoridades.md`](politica-pedidos-de-autoridades.md).
- **Operação:** [`staging.md`](staging.md), [`producao.md`](producao.md) (fluxo de publicação e registro).
- **Integrações:** [`meta-tech-provider.md`](meta-tech-provider.md), `integracoes/` (Asaas: playbook BaaS e selos).
- **Módulos:** fichas curtas em [`modulos/`](modulos/); detalhe completo em `arquivo/modulos/` (só por `grep`).
- **Em andamento:** [`iniciativas/`](iniciativas), mais [`implementacao-recepcao-digital.md`](implementacao-recepcao-digital.md),
  [`planejamento-nfse-asaas.md`](planejamento-nfse-asaas.md), [`planejamento-faturamento-saas.md`](planejamento-faturamento-saas.md).
- **Arquivo (só por `grep`):** [`plano.md`](plano.md), [`historico.md`](historico.md) e [`arquivo/`](arquivo)
  (diagnósticos, limites, propostas pré-implementação, CRM, auditoria do frontend, roteiros antigos). `plano.md` e
  `historico.md` ficam na raiz de `docs/` porque comentários do código apontam para eles.
- **Fila de capturas da Ajuda:** [`capturas-pendentes.md`](capturas-pendentes.md). **Site:** [`site-plano.md`](site-plano.md).
