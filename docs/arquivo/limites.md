# Limites e problemas

> Etapa 2 do RecepClinic. Parte do [diagnóstico](diagnostico.md) (base `aad94dd`) e registra o que
> impede ou põe em risco o RecepClinic atender várias clínicas. **Não propõe solução**: o que está
> marcado como "decisão" fica para a etapa 3 (arquitetura alvo). Cada item tem um código (L01…) para
> ser citado nas próximas etapas.

## Como ler

**Gravidade**

- **Bloqueante**: impede uma 2ª clínica no mesmo sistema, ou permite que uma clínica veja ou afete
  os dados de outra.
- **Alta**: risco de perda de dados, de vazamento, de parar de funcionar ou de descumprir regra
  (Meta, LGPD, termos dos provedores).
- **Média**: custo ou esforço que cresce a cada clínica nova; atrapalha, mas não impede.
- **Baixa**: acabamento.

**Quando precisa estar resolvido.** O primeiro piloto do RecepClinic pode ser a própria Dra. Ana
Karina (cenário B). Por isso há três horizontes:

- **P1, antes do 1º piloto do RecepClinic**: o que precisa estar pronto mesmo com uma clínica só,
  porque mudar depois, com dados reais, custa muito mais.
- **P2, antes da 2ª clínica.**
- **P3, pode esperar**: conforme o uso.

**Piloto atual?** "Sim" quando o mesmo problema também existe no projeto atual e vale levar para a
triagem no sentido contrário (do RecepClinic para o piloto), sem mexer na arquitetura dele.

---

## 1. Modelo de dados: clínica e profissional

| Cód. | Limite | Gravidade | Quando | Piloto atual? |
|---|---|---|---|---|
| L01 | **Não existe clínica no banco.** Nenhuma das 21 tabelas diz a quem pertence o dado. Sem isso, não há como isolar, filtrar, configurar ou cobrar por clínica. | Bloqueante | P1 | não |
| L02 | **Não existe profissional nem agenda por profissional.** Tudo cai numa linha do tempo única (`busyIntervals`, `appointments_no_overlap`). Uma clínica com dois médicos, ou um exame feito pela secretária ao mesmo tempo que uma consulta, não cabe. **Decisão:** a 1ª versão terá mais de uma agenda por clínica? | Bloqueante | P2 (decidir em P1) | não |
| L03 | **A trava de sobreposição é global.** Com mais de uma clínica no mesmo banco, um atendimento da clínica A bloquearia o mesmo horário na clínica B. | Bloqueante | P1 (junto de L01) | não |
| L04 | **Telefone do responsável único no banco inteiro** (`guardians.phone`, `conversation_state.guardian_phone`). A mesma mãe em duas clínicas seria o mesmo cadastro, e conversaria com o bot das duas no mesmo estado. | Bloqueante | P1 (junto de L01) | não |
| L05 | **Configuração em linha única** (`appointment_settings.id = 1`) e dados iniciais por migração (local "Instituto Andre Camurça"). | Bloqueante | P1 | não |
| L06 | **Tipos de atendimento fixos** (Consulta, Retorno, Exame) no `check` do banco, no gatilho de preço e nas regras do retorno (prazo, grátis, domiciliar sem retorno). Outra clínica pode ter outros tipos ou outra regra de retorno. **Decisão:** quanto disso vira configuração na 1ª versão, sem generalizar demais. | Média | P2 | não |
| L07 | **Modelo pediátrico**: paciente sempre ligado a um responsável; adulto só como "o próprio responsável" no exame; idade limite. Serve ao nicho inicial (pediatras e alergistas), não a uma clínica de adultos. **Decisão de escopo**: o nicho inicial continua pediatria? | Média | decidir em P1 | não |
| L08 | **Local fictício "Exames"** (`clinic_locations.type = 'exam'`) para todos os exames, e local físico decidido pelo horário. Funciona, mas mistura "onde" com "o quê". | Baixa | P3 | não |
| L09 | Colunas sem uso (`google_event_id`, `confirmed_at`) e estados do bot validados por `check` (cada estado novo exige migração). | Baixa | P3 | sim (limpeza) |

## 2. Isolamento e acesso

| Cód. | Limite | Gravidade | Quando | Piloto atual? |
|---|---|---|---|---|
| L10 | **O RLS só distingue "logado" de "não logado".** Qualquer usuário logado lê e escreve todas as linhas. Com várias clínicas, a secretária de uma veria os pacientes da outra. | Bloqueante | P1 | não |
| L11 | **Bot, agendador e páginas públicas usam a service role**, que ignora o RLS, sem filtro de clínica. O isolamento nesses caminhos dependeria só do código lembrar de filtrar em cada consulta. | Bloqueante | P1 | não |
| L12 | **Acesso ao banco espalhado**: 309 consultas em 111 arquivos, sem camada intermediária. Colocar o filtro de clínica em todas, e garantir que nenhuma fique para trás, é o maior risco de vazamento da migração. | Alta | P1 | não |
| L13 | **Usuário sem vínculo com clínica.** O login não sabe a que clínica pertence, nem permite pertencer a mais de uma (ex.: a mesma secretária em dois consultórios, ou a equipe do RecepClinic dando suporte). | Bloqueante | P1 | não |
| L14 | **Perfis fixos e "sem perfil = secretária".** Só dois papéis (`secretaria`, `medica`), sem papel de administrador da clínica nem de suporte do RecepClinic. O padrão por omissão dá acesso a quem não tem perfil. | Alta | P1 | sim (padrão por omissão) |
| L15 | **Autorização só no middleware.** O banco não conhece os papéis; uma rota esquecida fora da lista do middleware fica aberta para qualquer logado. | Média | P2 | sim |
| L16 | **Gestão de usuários manual**: sem convite, recuperação ou troca de senha; logins criados no painel do Supabase e perfis por SQL. Não escala e exige acesso de administrador ao banco a cada clínica nova. | Alta | P1 | sim (recuperação de senha) |
| L17 | **Sem 2FA nem bloqueio por tentativas** próprio, num sistema com dados de saúde. | Média | P2 | sim |

## 3. WhatsApp e Meta

| Cód. | Limite | Gravidade | Quando | Piloto atual? |
|---|---|---|---|---|
| L18 | **Um número só, fixo nas variáveis de ambiente** (token, `PHONE_NUMBER_ID`, app secret). O sistema não sabe enviar por um número escolhido por clínica. | Bloqueante | P2 (a estrutura entra em P1) | não |
| L19 | **O webhook não identifica a clínica.** Ignora o `metadata.phone_number_id` do payload; com vários números, não saberia de qual clínica é a mensagem. | Bloqueante | P2 (a estrutura entra em P1) | não |
| L20 | **Ligar o número de outra clínica (coexistência) exige Embedded Signup** e, provavelmente, ser **Tech Provider** da Meta ou usar um BSP. Não depende de código, tem prazo de aprovação e pode exigir CNPJ e site da empresa. | Bloqueante | P2 (começar já) | não |
| L21 | **Templates presos ao texto deste consultório** e aprovados por conta (WABA). Cada clínica nova teria 12 templates para aprovar, e o nome da Dra. está no texto aprovado. **Decisão:** templates por clínica ou templates genéricos com o nome da clínica como variável. | Alta | P2 (decidir em P1) | não |
| L22 | **Nomes de template por variável de ambiente** (12 nomes + 3 chaves de layout). Por clínica, isso não cabe em env. | Média | P2 | não |
| L23 | **Webhook processa tudo antes de responder 200.** A Meta espera resposta rápida e reenvia em caso de demora; com mais volume (várias clínicas), o risco de reenvio duplicado cresce. | Média | P2 | sim (baixo volume hoje) |
| L24 | **Textos do bot fixos no código** (946 linhas em `messages.ts`), com nome da Dra., pagamento, convênio, regras de idade. | Alta | P1 | não |

## 4. Identidade e regras da clínica no código

| Cód. | Limite | Gravidade | Quando | Piloto atual? |
|---|---|---|---|---|
| L25 | **Identidade da Dra. no código**: nome, especialidade, CRM e RQE na assinatura das mensagens; título e rodapé de `/agendar` e `/preparo`; nome do app instalado (PWA). | Bloqueante | P1 | não |
| L26 | **Regras comerciais no código**: formas de pagamento, "particular, sem convênio", recibo para reembolso. | Alta | P1 | não |
| L27 | **Domínio da Dra. como base dos links** enviados por WhatsApp (`draanakarinapneumo.com.br`). O produto precisa do próprio domínio. | Bloqueante | P1 | não |
| L28 | **Prazos de negócio fixos no código**: pausa de 24h da secretária, inatividade de 15 min, oferta de 60 min, antecedência de 2h, busca de 60 dias, resumo 1h antes, lembrete das 7h às 20h. São padrões razoáveis; **decisão** de quais viram configuração. | Baixa | P3 | não |
| L29 | **Fuso `America/Fortaleza` fixo** no código e no SQL (incluindo os horários dos jobs em UTC) e **feriados só nacionais + pedidos deste cliente** (Carnaval, Cinzas, Corpus Christi). Clínica em outro fuso do Brasil ou com feriado municipal não é atendida. | Média | P2 | não |
| L30 | **Locais só por SQL**: a tela muda o preço, mas não cria, renomeia ou desativa um local nem muda o endereço. Toda clínica nova dependeria de SQL. | Alta | P1 | sim |

## 5. Site institucional

| Cód. | Limite | Gravidade | Quando | Piloto atual? |
|---|---|---|---|---|
| L31 | **Site e sistema no mesmo projeto e deploy.** O site é pequeno (~5% do código) e não lê o banco, mas o sistema usa o rodapé e o CSS dele, e a política de privacidade dele serve ao app da Meta. Precisa sair do produto antes da 1ª clínica do RecepClinic. | Alta | P1 | não |
| L32 | **Política de privacidade e termos do produto não existem.** Hoje usa a do site da Dra.; o RecepClinic, como operador de dados de várias clínicas, precisa dos próprios (também exigidos pela Meta para Tech Provider). | Alta | P1 | não |

## 6. Envios automáticos

| Cód. | Limite | Gravidade | Quando | Piloto atual? |
|---|---|---|---|---|
| L33 | **Jobs pensados para uma clínica**: uma hora de lembrete, um resumo do dia, uma lista de contatos, um fuso. Com várias clínicas, cada execução precisa percorrer as clínicas, cada uma com seu horário e seus contatos, sem que a falha de uma pare as outras. | Bloqueante | P1 (desenho) / P2 (várias) | não |
| L34 | **Agendador configurado à mão** (Vault com URL e segredo, token de bypass da Vercel só no preview). Fácil de esquecer ou trocar entre ambientes. | Média | P1 | sim |
| L35 | **Gatilho da lista de espera chama a rota de dentro do banco** (`pg_net`). Funciona, mas espalha a lógica entre banco e aplicação, o que dificulta testar e acompanhar com várias clínicas. | Baixa | P3 | não |

## 7. Operação: ambientes, migrações, testes

| Cód. | Limite | Gravidade | Quando | Piloto atual? |
|---|---|---|---|---|
| L36 | **Um projeto Supabase para dev e preview, sem staging.** Teste e uso real dividem o mesmo banco, e os envios automáticos saem de verdade a partir do preview. | Alta | P1 | sim |
| L37 | **Migrações aplicadas à mão no SQL Editor**, sem registro de quais já rodaram. Com mais de um ambiente (e mudanças estruturais grandes), o risco de um banco ficar diferente do outro é alto. | Alta | P1 | sim |
| L38 | **Sem testes automatizados.** A regra de horários, o bot e o isolamento por clínica (L10–L12) não têm teste. Uma refatoração do tamanho da multi-clínica sem testes é o maior risco técnico do projeto. | Alta | P1 | sim |
| L39 | **Variáveis de ambiente sem validação na subida.** Faltando uma, o problema só aparece quando a função é usada. | Baixa | P2 | sim |
| L40 | **Código sem biblioteca de datas**, com fuso tratado à mão (17 pontos). Com fuso por clínica (L29), o tratamento manual fica mais arriscado. | Média | P2 | não |

## 8. Segurança, LGPD, backup e observabilidade

| Cód. | Limite | Gravidade | Quando | Piloto atual? |
|---|---|---|---|---|
| L41 | **Sem backup** (Supabase Free). Perda de dados de saúde sem volta. | Alta | P1 | **sim** |
| L42 | **LGPD como operador de várias clínicas**: não há contrato, termo de tratamento de dados, rotina de exclusão ou exportação a pedido do titular, nem política de retenção. Pacientes são só desativados. | Alta | P1 (o mínimo) / P2 | sim (exclusão a pedido) |
| L43 | **Telefones e dados pessoais nos logs** (`console.*`), guardados pela Vercel. | Média | P1 | sim |
| L44 | **Sem cabeçalhos de segurança** (CSP, proteção contra ser aberto dentro de outro site) e `robots.txt` liberando tudo, inclusive o admin. | Média | P1 | sim |
| L45 | **Sem ferramenta de erros nem monitor externo.** Com várias clínicas, um erro precisa dizer de qual clínica é, e uma queda precisa ser vista antes dos pacientes. | Alta | P1 (mínimo) | sim |
| L46 | **Proteção de formulários dependente do padrão do Astro** (`checkOrigin` não configurado explicitamente). | Baixa | P2 | sim |

## 9. Produto: onboarding, custos e cobrança

| Cód. | Limite | Gravidade | Quando | Piloto atual? |
|---|---|---|---|---|
| L47 | **Onboarding é uma cópia inteira feita à mão**, com mudança de código (8 passos no diagnóstico). Inviável a partir da 2ª clínica. | Bloqueante | P2 | não |
| L48 | **Planos gratuitos não servem para vender**: a Vercel Hobby proíbe uso comercial; o Supabase Free pausa sem uso e não tem backup. | Alta | P1 | sim (decisão já tomada no piloto: ir no gratuito) |
| L49 | **Sem cobrança do produto** (planos, assinatura, limites). Conforme a regra de não generalizar, não é necessário no início; a única exigência agora é **não fechar a porta**: saber, por clínica, o que foi usado (mensagens, atendimentos). | Baixa | P3 | não |
| L50 | **Custo da Meta por clínica não levantado** (cobrança por mensagem de template). Afeta o preço do produto. | Média | P2 | não |

---

## Resumo

**Bloqueantes (15):** L01, L02, L03, L04, L05, L10, L11, L13, L18, L19, L20, L25, L27, L33, L47. Eles
se resumem a quatro ausências: **clínica no modelo de dados**, **isolamento real por clínica**,
**WhatsApp por clínica** e **identidade e configuração da clínica fora do código**.

**O que precisa estar pronto antes do 1º piloto do RecepClinic (P1), mesmo com uma clínica só:**

- modelo com clínica (L01, L03, L04, L05) e usuários vinculados à clínica (L13, L14, L16);
- isolamento no banco que não dependa só do código lembrar de filtrar (L10, L11, L12);
- identidade, textos e regras comerciais da clínica fora do código (L24–L27, L30);
- produto separado do site, com domínio, política de privacidade e termos próprios (L27, L31, L32);
- envios automáticos desenhados por clínica (L33, L34);
- base operacional: ambientes separados, migrações controladas, testes da parte crítica, backup,
  logs sem dados pessoais e monitoramento mínimo (L36–L38, L41, L43–L45, L48);
- decisões de escopo: mais de uma agenda por clínica (L02), nicho pediátrico (L07) e o modelo de
  templates na Meta (L21).

**O que pode ficar para a 2ª clínica (P2):** número e webhook por clínica funcionando de verdade
(L18, L19, com a estrutura já pronta em P1), Tech Provider/BSP (L20, mas **começar o processo
já**, porque depende da Meta), onboarding sem cópia (L47), fuso e feriados por clínica (L29),
tipos de atendimento configuráveis (L06).

**Itens que também valem para o piloto atual** (para avaliar lá, sem refatoração): backup (L41),
recuperação de senha (L16), "sem perfil = secretária" (L14), dados pessoais nos logs (L43),
cabeçalhos de segurança e `robots.txt` (L44), monitor externo (L45), exclusão a pedido do titular
(L42) e locais só por SQL (L30). **O mais urgente para o piloto é o backup (L41).**

**Decisões que a etapa 3 precisa tomar primeiro**, porque mudam todo o resto:

1. Como isolar os dados por clínica (no banco, no código ou nos dois).
2. Se a 1ª versão já terá mais de uma agenda (profissional) por clínica.
3. Modelo de WhatsApp: um número por clínica via Tech Provider/BSP, e templates por clínica ou
   genéricos.
4. Escopo do nicho inicial (pediatria) e o quanto das regras vira configuração.
5. Evoluir este código no lugar ou reorganizá-lo em outra estrutura, considerando L12 e L38.
