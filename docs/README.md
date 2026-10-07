# RecepClinic

> **Estado atual (retomar daqui), 07/out/2026 (fim da sessão)**
>
> - **Etapas 0 a 4 concluídas**: cópia isolada, [diagnóstico](diagnostico.md), [limites](limites.md),
>   [arquitetura](arquitetura.md) (decisões D1–D11) e [plano](plano.md) (fases F0–F10).
> - **Produto:**
>   - **F0 a F3 concluídas**: base de trabalho; 197 testes das regras do piloto; schema
>     multi-clínica; camada de acesso ao banco por domínio (configuração, pacientes, agenda, séries,
>     lista de espera, WhatsApp, lembrete e reenvios, resumo do dia e rotinas), com a matriz de
>     acesso (D11) e os achados 1–5 da F1 resolvidos. Detalhes de cada etapa no [plano](plano.md).
>   - **F4 concluída e validada pelo cliente em 05/out** (painel no banco novo, nove partes):
>     login e escolha de clínica; matriz de acesso; Configurações (clínica, profissionais, locais,
>     agendas, serviços, horários, feriados, convênios, equipe com nome, WhatsApp); Nova clínica e
>     pedido de informações; Agenda (Dia com colunas por agenda, Semana, Mês, Marcar pelo serviço,
>     Remarcar, bloqueios, cancelar selecionados com "Avisar", séries); Pacientes; Resumo do Dia
>     (com Aguardando remarcação e Envios) e trilha; Métricas. Detalhes e decisões de cada parte
>     no [plano](plano.md).
>   - **F5 concluída e validada pelo cliente em 06/out** (páginas públicas e domínio, cinco
>     partes): marca da clínica (logo, cor com cores prontas, site) nas páginas públicas;
>     `/agendar` e `/preparo` no banco novo com a credencial limitada à clínica (nenhuma página
>     pública usa mais a service role); link de remarcação na mensagem da tela "Avisar";
>     **staging no ar em `https://app.recepclinic.com.br`** (roteiro em [`staging.md`](staging.md)).
>   - **Em curso: F6** — WhatsApp por clínica e bot, detalhada e aprovada em 06/out em sete
>     partes (F6.1 conexão e webhook … F6.7 métricas do bot). **F6.1 (conexão e webhook) concluída e validada em 07/out. F6.2** (envio pela conexão da clínica e templates padrão) **implementada em 07/out, aguardando a validação do cliente no staging** (roteiro na parte F do [`staging.md`](staging.md); templates em análise na Meta). **F6.3** (bot I: marcar) **implementada em 07/out, aguardando a validação** (parte G do `staging.md`). **F6.3b** (jornada de configuração: guia, próximo passo e selos) **implementada em 07/out, aguardando a validação**. **F6.4** (bot II: cancelar, remarcar, lembrete, encaixe, recepção) **implementada em 07/out, aguardando a validação**; depois, F6.5 (cancelamento pela clínica automático). O número
>     de testes do RecepClinic vai direto na Cloud API (sem o app do celular).
>   - **Já combinado para as próximas fases:** F6 — envio pelo WhatsApp (lembrete, preparo,
>     avisos), cancelamento pela clínica com aviso automático e link (sai a tela "Avisar"), abas
>     Funil do bot e Retomar contato, aba "Mensagens"; F7 — rotinas automáticas (lembrete, resumo
>     do dia, ofertas da lista de espera, extensão das séries sem fim).
>   - **Decidido em 05/out para depois:** aba **"Mensagens"** em Configurações na **F6** (prévia no
>     balão do WhatsApp; com o item "Mensagens personalizadas", o Administrador edita as mensagens de
>     conversa e propõe os templates; D3b revista); envio dos templates personalizados pela API na
>     F8.
>   - **WhatsApp de testes:** `+55 61 9903-3143`, na Cloud API do app RecepClinic, ligado à
>     clínica de teste "Consultorio Tluiz22" no staging. **Nunca verificar esse número em app
>     nenhum** (sairia da API). Roteiro na parte E do [`staging.md`](staging.md).
>   - **Staging:** `https://app.recepclinic.com.br` (Vercel publica a cada push na `main`);
>     migrações novas vão com `npx supabase db push` (repositório ligado ao projeto
>     `recepclinic-staging`); variáveis no `.env.staging` (fora do git). "Esqueci minha senha" só
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
