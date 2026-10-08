# RecepClinic

> **Estado atual (retomar daqui), 07/out/2026, fim da sessão (noite)**
>
> - **Etapas 0 a 4 concluídas**: cópia isolada, [diagnóstico](diagnostico.md), [limites](limites.md),
>   [arquitetura](arquitetura.md) (decisões D1–D11) e [plano](plano.md) (fases F0–F10).
> - **Produto:**
>   - **F0 a F5 concluídas e validadas** (base, testes das regras do piloto, schema multi-clínica,
>     camada de dados, painel completo, páginas públicas e staging). Detalhes no [plano](plano.md).
>   - **F6 (WhatsApp por clínica e bot) toda implementada.** F6.1 validada em 07/out; F6.3 (bot I:
>     marcar) e F6.3b (jornada de configuração) validadas em 08/out. **Aguardam a validação do
>     cliente no staging:** F6.2 (envio e templates padrão), F6.4 (bot II: cancelar, remarcar, lembrete, encaixe, recepção só com coexistência; em 08/out o
>     encaixe passou a oferecer até 3 horários livres antes de entrar na lista),
>     F6.5 (cancelamento pela clínica com aviso e link; "Avisar" só para quem não recebeu), F6.6
>     (aba Mensagens e mensagens personalizadas com revisão do Suporte) e F6.7 (Funil do bot e
>     Retomar contato; corrigido o acesso a Métricas sem a Visão geral).
>   - **F7 (envios automáticos) implementada, aguardando a validação:** rotinas no `pg_cron`
>     (lembrete, resumo do dia, lista de espera, séries sem fim) e as opções em Configurações ›
>     WhatsApp (lembrete da véspera com enviar/horário, padrão 18h; resumo na véspera e no dia).
>     Saiu o código antigo do piloto; a service role só fica na plataforma (D1).
>   - **Templates na Meta (07/out):** os 11 do RecepClinic criados na conta do RecepClinic e **em
>     análise** (incluindo as versões 2 do resumo de hoje, recusado como formato inválido, e do
>     preparo, classificado como marketing). O cliente exclui na Meta os 3 antigos sem uso
>     (`rc_resumo_consultas_hoje_v1`, `rc_resumo_exames_hoje_v1`, `rc_preparo_exame_v1`). Quando
>     forem aprovados: conferir se o `rc_preparo_exame_v2` ficou como Utilidade e validar os envios
>     (partes F a K do [`staging.md`](staging.md)).
>   - **Próximo passo:** validação do cliente (F6.2 a F7). Depois, **F8** (Embedded Signup com
>     coexistência), que depende da aprovação do RecepClinic como Tech Provider na Meta.
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
>   - advogado para revisar as páginas legais (antes do 1º piloto).
>   - provedor de e-mail (ex.: Resend) com o domínio `recepclinic.com.br` (antes do 1º piloto;
>     convites, pedido de informações e "Esqueci minha senha" na nuvem; também vira o SMTP do
>     Supabase, para os modelos de e-mail).
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
