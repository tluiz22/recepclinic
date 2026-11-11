# RecepClinic

> **Estado atual (retomar daqui, 11/nov).** Bloco enxuto: só ambientes e próximo passo. Histórico até 10/nov no
> [`historico.md`](historico.md) ("Bloco de retomada do README até 10/nov/2026").
>
> **Ambientes**
> - **Produção** (`app.recepclinic.com.br`, branch `producao`) = `main` em `64ec6b1` (08/nov). Fluxo: [`producao.md`](producao.md).
> - **Staging** (`teste.recepclinic.com.br`) = `main` atual: portal F2, F3a–F3e, F5a (agenda em colunas), ajustes da
>   validação. Migrações até `20270112120000` (turmas na faixa, aplicada 11/nov com OK do cliente).
>
> **Frente ativa: recepção digital integrada** ([`implementacao-recepcao-digital.md`](implementacao-recepcao-digital.md)).
> Duas sessões: validação (esta pasta, `main`, edita este bloco) e implementação (branch curta; quem junta e publica é
> a validação). Banco local único: migração só avisando.
> **Próximo:** roteiro 15.5.4 concluído (11/nov), com o ajuste da turma na faixa de dias no Marcar/Remarcar da recepção
> (no staging, validar). Depois: seção 16 (F5a) → F3f e produção (F3-9). Convênios de cada exame (CE-1 a CE-6, seção 15.5.7) feitos (11/nov).
> **Pendentes com o cliente:** "Minhas consultas" da tela "Consulta marcada!" pelo link do profissional; renomear o
> local "Consulta Domiciliar" do staging; capturas na fila (`agenda-dia`, `config-mensagens`, menu de Configurações,
> `config-horarios`); vários responsáveis por paciente (planejado: VR-1 a VR-7, D14). Teste
> `nao-atendimento-central` às vezes falha (depende do horário).
>
> **Outras frentes paradas**
> - **Biomedical** ([proposta](propostas/clinica-12-profissionais/README.md)): implantação depende do portal, F3, F5 e F6 no ar.
> - **Nota fiscal:** N1–N5 na branch `nota-fiscal` (só local), validação pendente (seção 15.2 do
>   [`planejamento-nfse-asaas.md`](planejamento-nfse-asaas.md)); N6 depende de Asaas, contador e advogado.
> - **Asaas:** reanálise do BaaS aguardando; tokenização do cartão em produção pedida (conferir antes do 1º contrato
>   com implantação no cartão). Faturamento: `planejamento-faturamento-saas.md`.
> - **Pendências:** limpeza de `booking_horizon_days`/`consultation_age_limit_years`; onde mostrar fotos; F11 (T3.1);
>   1º backup diário da produção; advogado (páginas legais, contrato, termo de dados); verificação da empresa na Meta.
>
> **Como trabalhar**
> - **Migrações:** staging com `supabase db push` (simular → aplicar → conferir → push do código); produção só com
>   autorização, pelo `producao.md` (`git push origin main:producao`).
> - **Local:** OrbStack, `npm run db:start`, `npm run dev`; `npm test`, `npm run test:db` (PATH com `/opt/homebrew/bin`).
> - **WhatsApp de testes:** `+55 61 9903-3143` ("Consultorio de Teste", staging).
> - **Demos:** antes de apresentar, `node --env-file=.env.staging scripts/demo-clinicas.mjs --confirmar`.
> - **Outras:** site em [`site-plano.md`](site-plano.md); triagem em [`triagem-piloto.md`](triagem-piloto.md).

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

## Documentos

- [`historico.md`](historico.md): andamento completo, sessão a sessão (arquivo; só por busca).
- [`planejamento-multiprofissional.md`](planejamento-multiprofissional.md): especialidades, convênios e bot por
  profissional (ponto de retomada).
- [`crm.md`](crm.md): etapa paralela do CRM (ponto de retomada); plano ativo em
  [`analises/plano-evolucao-relacionamento.md`](analises/plano-evolucao-relacionamento.md) e o que já foi feito em
  [`analises/crm-arquivo.md`](analises/crm-arquivo.md).
- [`planejamento-faturamento-saas.md`](planejamento-faturamento-saas.md): faturamento do SaaS pelo Asaas (planejamento,
  decisões pendentes e roadmap F12).
- [`producao.md`](producao.md): produção (`app.`), fluxo de publicação e registro.
- [`triagem-piloto.md`](triagem-piloto.md): registro das mudanças do piloto depois da cópia.
- [`diagnostico.md`](diagnostico.md): diagnóstico da arquitetura atual (etapa 1).
- [`limites.md`](limites.md): limites e problemas para várias clínicas (etapa 2).
- [`arquitetura.md`](arquitetura.md): decisões da arquitetura alvo (etapa 3).
- [`plano.md`](plano.md): plano de evolução em fases (etapa 4).
- [`site-plano.md`](site-plano.md): plano do site `www.recepclinic.com.br` (frente paralela).
- [`staging.md`](staging.md): roteiro do staging na nuvem (F5.5).
- [`meta-tech-provider.md`](meta-tech-provider.md): Análise do App e Tech Provider na Meta (textos e respostas).
- [`politica-pedidos-de-autoridades.md`](politica-pedidos-de-autoridades.md): pedidos de autoridades
  sobre dados (adotada na verificação da Meta; a revisar pelo advogado).
