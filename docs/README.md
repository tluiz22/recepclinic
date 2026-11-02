# RecepClinic

> **Estado atual (retomar daqui), 31/out/2026.** Detalhes e datas no [`historico.md`](historico.md) (só por busca).
>
> **Próximo (cliente, 01/nov):** validado no staging: Base de Conhecimento, "Como funciona?" de Configurações e Central de
> Ajuda. No staging para validar: **25 capturas reais de tela** nos artigos da Central (`public/ajuda/`, refazer quando a
> tela mudar). Falta informar o WhatsApp do suporte (Sistema › Suporte), se ainda não foi. Detalhes em
> [`ajuda-contextual.md`](ajuda-contextual.md), fim. Cliente vai pedir novos ajustes.
>
> **Em produção (cliente, 02/nov):** `93ab8cd` (2 migrações, `migrar_agenda` e `migrar_agenda_por_servico`; depois, linhas "Livre" por serviço, na agenda de exames e nas turmas): redesign da Recepção, Central de Ajuda
> atualizada e Migrar de agenda. Detalhe no [`producao.md`](producao.md) (Publicações).
>
> **Ambientes**
> - **Produção** (`app.recepclinic.com.br`, branch `producao`) = `main` em `93ab8cd` (ver acima). Fluxo em [`producao.md`](producao.md).
> - **Staging** (`teste.recepclinic.com.br`, branch `main`): produção + redesign da Recepção (RX1 a RX9, sem migração) +
>   cartão do Asaas (`ASAAS_PREVIEW=1`) + Base de Conhecimento do bot (migração aplicada).
>   Roteiros em [`staging.md`](staging.md).
> - **Branch `faturamento`** (só local, sem push): todo código do financeiro. Tem a `main` até `76d2688` (merge de 02/nov); atualizar
>   só quando o cliente pedir (cliente, 01/nov).
>
> **Frentes**
> - **Ajustes da produção (C1–C16) e revisão da jornada do bot:** todos na produção; nada pendente. Decisões da
>   revisão no [`historico.md`](historico.md) (busca "Revisão da jornada do bot").
> - **Evolução do assistente** ([`evolucao-assistente.md`](evolucao-assistente.md)): texto livre na entrada, motivo antes
>   da recepção e taxa de resolução sem a recepção. Código na branch **`assistente`** (só local), testes passando.
>   Próximo: o cliente valida; com o OK, juntar na `main` e aplicar a migração no staging.
> - **Faturamento do SaaS:** F12.1 e F12.2 validadas no local. Próximo: **F12.2b** (aceite do contrato e aviso de 30
>   dias); texto do contrato com o advogado. Retomar pelo `planejamento-faturamento-saas.md` **na branch**.
> - **NFS-e pelo Asaas** (`planejamento-nfse-asaas.md`, seção 13): N0; formulário BaaS enviado (30/out). Aguarda
>   Asaas e contador (PIS/COFINS, e-CNPJ A1).
> - **Piloto (F10, [plano](plano.md)):** clínica piloto criada na produção, WhatsApp conectado, templates em análise
>   na Meta. Próximo: templates aprovados → configuração → ativação → testes do bot. Depois: lembrete com botões no
>   staging e etapa B.
> - **Redesign da Recepção (UX)** ([`redesign-recepcao.md`](redesign-recepcao.md)): RX1 a RX9 e os ajustes da validação
>   (Meu dia, Agenda opção B, Pacientes/ficha A, Relatório do dia opção C) **na `main` e no staging (02/nov)**, sem
>   produção. **Central de Ajuda atualizada com o redesign (02/nov):** artigos e as 25 capturas refeitas, no staging após o push; falta o cliente validar. Avisos técnicos só do Suporte; tela
>   de pendências do Suporte pendente em [`painel-suporte.md`](painel-suporte.md).
>
> **Pendências**
> - **Cliente valida no staging (no fim):** F8.1, F8.2, F8.2b, F8.3, ajuda contextual e menu lateral.
> - **F11:** roteiro a partir do T3.1; Produção Restrita (A1), template `rc_nota_fiscal_v1`, termo com o advogado.
> - **Operação:** 1º backup diário da produção; sessão do painel que caiu (parte P do `staging.md`).
> - **Do cliente:** advogado (páginas legais, [pedidos de autoridades](politica-pedidos-de-autoridades.md), contrato,
>   termo de dados); número do app antigo como 2ª clínica de testes do staging.
>
> **Como trabalhar**
> - **Migrações:** staging com `supabase db push` (simular → aplicar → conferir → push do código); produção só com
>   autorização, pelo `producao.md` (`git push origin main:producao`).
> - **Local:** OrbStack, `npm run db:start`, `npm run dev`; `npm test`, `npm run test:db` (PATH com `/opt/homebrew/bin`).
> - **WhatsApp de testes:** `+55 61 9903-3143` ("Consultorio de Teste", staging).
> - **Outras:** site em [`site-plano.md`](site-plano.md) (pasta `recepclinic-site`); triagem em
>   [`triagem-piloto.md`](triagem-piloto.md).

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
