# RecepClinic

> **Estado atual (retomar daqui), 10/out/2026**
>
> - **Etapas 0 a 4 concluídas**: cópia isolada, [diagnóstico](diagnostico.md), [limites](limites.md),
>   [arquitetura](arquitetura.md) (decisões D1–D11) e [plano](plano.md) (fases F0–F10).
> - **Produto:**
>   - **F0 a F5 concluídas e validadas** (base, testes das regras do piloto, schema multi-clínica,
>     camada de dados, painel completo, páginas públicas e staging). Detalhes no [plano](plano.md).
>   - **F6 (WhatsApp por clínica e bot) toda implementada.** F6.1 validada em 07/out; F6.3 (bot I:
>     marcar) e F6.3b (jornada de configuração) validadas em 08/out; F6.4 (bot II: cancelar,
>     remarcar, encaixe) validada em 08/out, com o ajuste do encaixe (até 3 horários livres antes
>     da lista, também para quem já está nela), com os botões do lembrete; F6.2 (envio e templates
>     padrão) validada em 08/out, menos o preparo do exame (template em análise); F6.6 (aba
>     Mensagens) validada em 08/out, com os ajustes do dia (combo bot/Meta, item da matriz dividido
>     em dois e as orientações gerais da consulta, template `rc_orientacoes_consulta_v1`).
>     F6.7 (Funil do bot e Retomar contato) e F6.5 (cancelamento pela clínica, com o template
>     aprovado) validadas em 08/out; saiu o "Cancelar selecionados" da Agenda (cliente: cancelar
>     vários é pelo "Bloquear e cancelar"). **F6 toda validada**, menos as conferências que
>     dependem de templates em análise (preparo do exame e orientações gerais fora das 24h).
>   - **F7 (envios automáticos) validada em 09/out** com os templates aprovados: rotinas no
>     `pg_cron` e Configurações › **Lembretes** (um lembrete por público: paciente, profissional e
>     equipe, na véspera ou no dia, das 6h às 20h). O cliente segue testando em paralelo e traz os
>     ajustes; resumo do dia e oferta de vaga a conferir quando a Meta aprovar os templates.
>   - **Templates na Meta (09/out):** aprovados confirmação, remarcação, cancelamento, lembrete e
>     cancelamento pela clínica. **Em análise:** preparo do exame (`rc_preparo_exame_v2`; conferir
>     se ficou como Utilidade), orientações gerais (`rc_orientacoes_consulta_v1`), os 4 do resumo do
>     dia, a oferta de vaga e as versões próprias da Confirmação/Remarcação da clínica de teste. Os 3
>     antigos sem uso a excluir estão nas pendências do cliente, abaixo.
>   - **F9 (operação e segurança) validada em 09/out**, em 5 subetapas (detalhes no [plano](plano.md)):
>     cabeçalhos de segurança, CSP e `robots.txt`; logs sem dados pessoais; erros em tabela própria
>     (Administração › Erros) e monitor externo **Better Stack** (4 monitores, alerta por e-mail);
>     anonimização de paciente a pedido (LGPD); contadores de uso (Administração › Uso).
>   - **Meta:** análise do app **enviada em 09/out** (clínica demo do analista no staging: "Clínica
>     Demonstração RecepClinic", `analista.meta@recepclinic.com.br`, dados fictícios; desativar o
>     login quando a análise terminar). Falta a **Verificação do acesso** (textos prontos em
>     [`meta-tech-provider.md`](meta-tech-provider.md); antes, os dados da empresa no rodapé do site).
>   - **F9.6a (limites do bot por contato) validada em 10/out**, com os ajustes do dia ("Revisado",
>     liberar contato dos limites, contato desativado conta). **F9.6b (bloquear contato)
>     implementada em 10/out, aguarda a validação do cliente no staging** (migrações até
>     `20261010140000` aplicadas lá; detalhes no [plano](plano.md)). **Próximo passo (retomar
>     daqui): validação da F9.6b.** Depois: F8 (quando a Meta aprovar) e F10.
>   - **Migrações no staging:** o Claude aplica com `supabase db push` (permissão liberada em
>     09/out), sempre na ordem simulação → aplicar → conferir no banco → só então o push do código.
>   - **WhatsApp de testes:** `+55 61 9903-3143`, na Cloud API do app RecepClinic, ligado à
>     clínica de teste "Consultorio Tluiz22" no staging. **Nunca verificar esse número em app
>     nenhum** (sairia da API). Roteiro na parte E do [`staging.md`](staging.md).
>   - **Staging:** `https://app.recepclinic.com.br` (Vercel publica a cada push na `main`);
>     migrações novas vão com `supabase db push` antes do push (repositório ligado ao projeto
>     `recepclinic-staging`; a senha do banco está em `SUPABASE_DB_PASSWORD` no `.env.staging`);
>     agendador ligado (`scripts/agendador.mjs`); variáveis no `.env.staging` (fora do git). "Esqueci minha senha" só
>     funciona lá depois do provedor de e-mail; até lá, `scripts/link-de-senha.mjs` gera o link.
>   - **Para rodar:** abrir o OrbStack, `npm run db:start`, `npm run db:reset` (dados de teste) e
>     `npm run dev` com o `.env` local (ver "Painel local" no README da raiz); testes com `npm test`
>     e `npm run test:db`.
> - **Frente paralela, o site** `www.recepclinic.com.br`: [`site-plano.md`](site-plano.md), feito numa
>   **sessão separada, na pasta `~/Documents/Desenvolvimento/recepclinic-site`** (nunca nesta pasta).
>   **No ar** (conferido em 05/out), com `/privacidade` e `/termos`; DNS de `recepclinic.com.br` já
>   na Cloudflare.
> - **Meta**: verificação da empresa aprovada e app RecepClinic criado (06/out); faltam a análise
>   do app e o Tech Provider (destravam a F8). Ver "Frentes paralelas" no plano.
> - **Pendências do cliente**:
>   - abrir o CNPJ (SLU, ME, Simples Nacional);
>   - advogado para revisar as páginas legais e a [política de pedidos de autoridades](politica-pedidos-de-autoridades.md)
    (antes do 1º piloto).
>   - provedor de e-mail (ex.: Resend) com o domínio `recepclinic.com.br` (antes do 1º piloto;
>     convites, pedido de informações e "Esqueci minha senha" na nuvem; também vira o SMTP do
>     Supabase, para os modelos de e-mail).
>   - excluir na Meta (conta do RecepClinic) os 3 templates antigos sem uso:
>     `rc_resumo_consultas_hoje_v1`, `rc_resumo_exames_hoje_v1` e `rc_preparo_exame_v1`.
> - **Triagem do piloto**: nenhum commit novo do piloto desde `aad94dd` até 06/out/2026 (início da F6).

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

Ainda **não há** banco, projeto na Vercel nem app na Meta próprios. Eles serão criados quando a
implementação precisar rodar o sistema. **Este repositório não tem `.env`** e nunca deve usar as
credenciais do piloto (banco, agendador e Vault do Supabase, número e app da Meta, segredos).

## Documentos

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
