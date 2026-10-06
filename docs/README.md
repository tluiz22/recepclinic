# RecepClinic

> **Estado atual (retomar daqui), 05/out/2026**
>
> - **Etapas 0 a 4 concluídas**: cópia isolada, [diagnóstico](diagnostico.md), [limites](limites.md),
>   [arquitetura](arquitetura.md) (decisões D1–D11) e [plano](plano.md) (fases F0–F10).
> - **Produto:**
>   - **F0 a F3 concluídas**: base de trabalho; 197 testes das regras do piloto; schema
>     multi-clínica; camada de acesso ao banco por domínio (configuração, pacientes, agenda, séries,
>     lista de espera, WhatsApp, lembrete e reenvios, resumo do dia e rotinas), com a matriz de
>     acesso (D11) e os achados 1–5 da F1 resolvidos. Detalhes de cada etapa no [plano](plano.md).
>   - **F4 em andamento** (painel no banco novo), em nove partes (cliente, 05/out):
>     - **Concluídas:** F4.1 (login, convite e senha, escolha de clínica, vocabulário, tela
>       inicial); F4.2 (matriz de acesso e limite de profissionais); F4.3 e F4.4a/b
>       (Configurações, Nova clínica, convites, pedido de informações, equipe e WhatsApp); F4.5
>       (Agenda: Dia, Semana e Mês, cartão com as ações, Marcar pelo serviço com "com quem?",
>       Remarcar e cadastro rápido do paciente).
>     - **F4.6 a F4.9 concluídas** (Agenda II; Pacientes; Resumo do Dia com Envios e trilha;
>       Métricas com seletor de agenda, e a retirada do código antigo sem uso). Itens "Envios" e
>       "Relatórios" saíram da matriz; Funil do bot e Retomar contato ficam para a F6.
>     - **A validar pelo cliente:** F4.9 (comandos na mensagem da etapa). Com ela, **a F4 termina**.
>     - **Próxima: F5** Páginas públicas e domínio (a detalhar com o cliente).
>   - **Decidido em 05/out para depois:** aba **"Mensagens"** em Configurações na **F6** (prévia no
>     balão do WhatsApp; com o item "Mensagens personalizadas", o Administrador edita as mensagens de
>     conversa e propõe os templates; D3b revista); envio dos templates personalizados pela API na
>     F8; envio do **logo** da clínica na F5.
>   - **Para rodar:** abrir o OrbStack, `npm run db:start`, `npm run db:reset` (dados de teste) e
>     `npm run dev` com o `.env` local (ver "Painel local" no README da raiz); testes com `npm test`
>     e `npm run test:db`.
> - **Frente paralela, o site** `www.recepclinic.com.br`: [`site-plano.md`](site-plano.md), etapas
>   S0–S6, a executar numa **sessão separada, na pasta `~/Documents/Desenvolvimento/recepclinic-site`**
>   (nunca nesta pasta, para as duas sessões não se cruzarem). **S0 concluída em 03/out**: repositório
>   `tluiz22/recepclinic-site` criado e clonado nessa pasta; próxima é a S1, na sessão do site.
>   Cloudflare e DNS podem vir depois (até a S5).
> - **Depois do site**: cadastro como Tech Provider na Meta (ver "Frentes paralelas" no plano).
> - **Pendências do cliente**:
>   - abrir o CNPJ (SLU, ME, Simples Nacional);
>   - conta na Cloudflare e troca do DNS no registro.br (até a S5 do site);
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
