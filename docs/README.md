# RecepClinic

> **Estado atual (retomar daqui), 04/out/2026**
>
> - **Etapas 0 a 4 concluídas**: cópia isolada, [diagnóstico](diagnostico.md), [limites](limites.md),
>   [arquitetura](arquitetura.md) (decisões D1–D10) e [plano](plano.md) (fases F0–F10).
> - **Produto:**
>   - **F0 concluída**: site da Dra. fora do repositório; nome RecepClinic; Supabase local pela CLI;
>     Vitest e CI.
>   - **F1 concluída**: 197 testes das regras de cálculo; achados 1–5 anotados no plano para a F3/F4.
>   - **F2 concluída**: schema multi-clínica em 7 migrações (D2 e D6 revistas, D9 recorrência, D10
>     convênios só no banco); dados de teste locais com logins no README da raiz; 158 testes de
>     banco no CI, com varredura de isolamento automática.
>   - **F3 em andamento** (acesso ao banco e contexto da clínica): divisão em etapas aprovada em
>     04/out (F3.1 base técnica, F3.2 contexto da clínica, F3.3 credencial limitada, F3.4–F3.8
>     acesso por domínio; ver [`plano.md`](plano.md)). As telas só são ligadas ao schema novo na
>     F4. **F3.1 a F3.4 concluídas** (tipos do banco, variáveis de ambiente, datas com fuso;
>     contexto da clínica, papéis da D6 e registro das leituras do Suporte; credencial limitada à
>     clínica e service role presa a um arquivo; acesso à configuração, com a decisão de que a
>     sobreposição de horários vale por agenda). **Próxima etapa: F3.5** (acesso a pacientes).
>     Para rodar o banco: abrir o OrbStack, `npm run db:start`, `npm run db:reset` (carrega os
>     dados de teste) e `npm run test:db`.
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
> - **Triagem do piloto**: nenhum commit novo do piloto desde `aad94dd` até esta data.

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
