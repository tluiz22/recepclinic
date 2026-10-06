# RecepClinic

> **Estado atual (retomar daqui), 05/out/2026 (fim da sessão)**
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
>   - **Em curso: F5** — Páginas públicas e domínio, detalhada e aprovada em 05/out em cinco
>     partes (F5.1 marca da clínica, F5.2 `/agendar`, F5.3 `/preparo`, F5.4 link na tela "Avisar",
>     F5.5 domínio `app.recepclinic.com.br`). **F5.1 validada; F5.2 (`/agendar` no banco novo) feita, aguardando a validação do cliente**; depois, F5.3. Decisões no [plano](plano.md).
>   - **Já combinado para as próximas fases:** F6 — envio pelo WhatsApp (lembrete, preparo,
>     avisos), cancelamento pela clínica com aviso automático e link (sai a tela "Avisar"), abas
>     Funil do bot e Retomar contato, aba "Mensagens"; F7 — rotinas automáticas (lembrete, resumo
>     do dia, ofertas da lista de espera, extensão das séries sem fim).
>   - **Ambiente local:** a agenda "Thiago - TI", criada na validação, faz 2 testes de banco
>     falharem até um `npm run db:reset`.
>   - **Decidido em 05/out para depois:** aba **"Mensagens"** em Configurações na **F6** (prévia no
>     balão do WhatsApp; com o item "Mensagens personalizadas", o Administrador edita as mensagens de
>     conversa e propõe os templates; D3b revista); envio dos templates personalizados pela API na
>     F8; envio do **logo** da clínica na F5.
>   - **Para rodar:** abrir o OrbStack, `npm run db:start`, `npm run db:reset` (dados de teste) e
>     `npm run dev` com o `.env` local (ver "Painel local" no README da raiz); testes com `npm test`
>     e `npm run test:db`.
> - **Frente paralela, o site** `www.recepclinic.com.br`: [`site-plano.md`](site-plano.md), feito numa
>   **sessão separada, na pasta `~/Documents/Desenvolvimento/recepclinic-site`** (nunca nesta pasta).
>   **No ar** (conferido em 05/out), com `/privacidade` e `/termos`; DNS de `recepclinic.com.br` já
>   na Cloudflare.
> - **Depois do site**: cadastro como Tech Provider na Meta (ver "Frentes paralelas" no plano).
> - **Pendências do cliente**:
>   - abrir o CNPJ (SLU, ME, Simples Nacional);
>   - comprar o chip de testes do RecepClinic (necessário na F6);
>   - advogado para revisar as páginas legais (antes do 1º piloto).
>   - provedor de e-mail (ex.: Resend) com o domínio `recepclinic.com.br` (antes do 1º piloto;
>     pedido de informações e convites na nuvem).
> - **Triagem do piloto**: nenhum commit novo do piloto desde `aad94dd` até 05/out/2026.

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
