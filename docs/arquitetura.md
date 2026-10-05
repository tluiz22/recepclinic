# Arquitetura alvo

> Etapa 3 do RecepClinic. Decisões tomadas com o cliente, uma de cada vez, a partir dos
> [limites](limites.md). Cada decisão registra o que foi escolhido, por quê, o que foi descartado e
> quais limites resolve. O **como fazer** (ordem, migrações, etapas) fica para o plano de evolução
> (etapa 4).

## D1 — Isolamento dos dados por clínica (03/out/2026)

**Decisão: um banco compartilhado, com a clínica em cada linha e RLS por clínica.**

- Toda tabela de dados da clínica ganha `clinic_id`. Restrições únicas e travas passam a valer
  **por clínica**: telefone do responsável, estado da conversa, sobreposição de horários,
  configurações.
- O RLS deixa de ser "está logado" e passa a ser **"é membro desta clínica"**. O usuário fica
  ligado a uma ou mais clínicas.
- **Bot, agendador e páginas públicas também rodam sob RLS**, com uma credencial limitada à
  clínica daquela requisição, em vez da service role que ignora tudo.
- A **service role** fica restrita a rotinas administrativas da plataforma (ex.: criar uma clínica).
- O isolamento tem duas camadas: o código filtra e o banco barra. Um filtro esquecido não vira
  vazamento.

**Por quê:** é o modelo de uma plataforma para várias clínicas (uma conta e uma migração para
todas) e protege contra o maior risco da evolução: 309 consultas espalhadas e nenhum teste
(L12, L38).

**Descartado:**
- Um banco por clínica: isolamento físico, mas custo e migrações multiplicados a cada clínica (na
  prática, a "cópia por clínica").
- Clínica só no código: um filtro esquecido viraria vazamento.

**Resolve:** L01, L03, L04, L05 (configuração por clínica), L10, L11, L13; reduz o risco de L12.

## D2 — Agendas por clínica (03/out/2026)

**Decisão: a agenda entra no modelo agora e o uso de várias agendas é ligado aos poucos.**

- Cada clínica tem uma ou mais **agendas**: um profissional ou um recurso (ex.: "Exames", quando a
  secretária faz o exame sem a médica).
- Atendimentos e bloqueios pertencem a uma agenda. A **trava de horários e o cálculo de horários
  livres valem por agenda**, não mais pela clínica inteira. Disponibilidade também é por agenda.
- **1ª versão**: o tipo de atendimento ou o exame define a agenda. O bot **não pergunta "com
  quem"**, e telas e resumos seguem como hoje, só respeitando as agendas. A clínica com uma só
  agenda não percebe diferença.
- Escolher o profissional no bot e filtrar telas e métricas por profissional fica para quando uma
  clínica precisar. Nesse momento, não haverá migração de dados.
- **Resumo do dia (revisto pelo cliente, 05/out/2026):** além dos contatos do resumo, que
  continuam recebendo a clínica inteira separada em consultas e exames (com o nome da agenda em
  cada item quando a lista tem mais de uma agenda), **cada profissional pode receber o resumo só
  dos próprios atendimentos**, no telefone do cadastro do profissional, se marcar a opção
  "Recebe o resumo do dia". O do profissional segue os mesmos dois envios (véspera às 18h e no
  dia 1h antes do início), com o início contado **pela agenda dele**, e também separado em
  consultas e exames. Faz parte do item "Envio do resumo do dia" da matriz (D11).

**Por quê:** mudar o modelo depois, com dados reais, custa caro. O piloto já tem o caso dos exames
feitos pela secretária, que hoje bloqueiam a agenda da médica sem necessidade. A escolha de
profissional no bot e nas telas não foi validada por nenhuma clínica ainda (regra de não
generalizar).

**Descartado:**
- Várias agendas completas já: esforço alto em quase todas as telas e no bot, sem demanda
  validada.
- Uma agenda por clínica: barato agora, mas exigiria migrar dados para atender clínicas com mais de
  um profissional.

**Resolve:** L02; prepara o terreno para L06 (tipos de atendimento ligados a agendas).

**Revisão de 04/out/2026 (cliente, requisitos de várias agendas):**

- Uma clínica pode ter **vários profissionais, cada um com a sua agenda**, e várias pessoas na
  recepção.
- Um **serviço pode estar em várias agendas** (dois médicos fazem "Consulta"). Substitui o "o tipo
  de atendimento define a agenda" da 1ª versão.
- **Bot:** com mais de um profissional para o serviço, pergunta **"com quem?"** e oferece também
  **"primeiro horário disponível"**. Retorno e sessões de série ficam com o **mesmo profissional**
  do atendimento de origem. Com um profissional só, não pergunta nada.
- **Painel:** a recepção **escolhe a agenda (profissional) para exibir**. Sai do "fica para quando
  uma clínica precisar"; entra na F4.
- **Lista de espera:** a vaga que abre numa agenda é oferecida **só a quem espera na mesma agenda,
  para o mesmo serviço** (o paciente antecipa sem trocar de profissional). Descartado: oferecer a
  quem espera o serviço com outro profissional; deixar o paciente escolher ao entrar na fila.

## D3 — WhatsApp por clínica (03/out/2026)

### D3a — Conexão com o número da clínica

**Decisão: o RecepClinic será Tech Provider da Meta, com um BSP como reserva.**

- Cada clínica conecta o **próprio número** pelo **Embedded Signup**, com **coexistência**: a
  secretária continua usando o app do WhatsApp Business no mesmo número.
- O RecepClinic tem o **próprio app na Meta** e segue chamando a **Cloud API direto**, como hoje.
  Token, número (`phone_number_id`), conta (WABA) e segredos passam a ser **guardados por clínica**,
  não em variáveis de ambiente.
- O **webhook identifica a clínica** pelo `metadata.phone_number_id` de cada evento e processa tudo
  sob as permissões daquela clínica (D1).
- A **camada de WhatsApp fica isolada** (envio, recebimento, templates) para poder trocar por um
  BSP sem mexer no resto, se a verificação da Meta travar.
- **Começar o processo da Meta já** (verificação da empresa, app, análise). Depende de CNPJ e de
  um site com política de privacidade (L32). Requisitos e prazos devem ser conferidos nas páginas
  atuais da Meta antes de começar.

**Por quê:** o código já fala direto com a Cloud API, não há custo por número além da Meta e não
há um terceiro no caminho dos dados de saúde.

**Descartado:** BSP desde o início (custo por número ou por mensagem e mais um intermediário; fica
como alternativa).

### D3b — Templates

**Decisão: templates padrão do RecepClinic, criados pela API na conta de cada clínica.**

- **Um só texto para todas as clínicas.** O que muda entra como variável: clínica, profissional,
  tipo de atendimento, local, data.
- Ao conectar o número, o RecepClinic **cria e envia os templates para aprovação** na conta da
  clínica, sem trabalho manual.
- **Nome e idioma de cada template guardados por clínica** (não em variável de ambiente). Isso
  permite, no futuro, um texto próprio para uma clínica sem mudar código.
- **Informações próprias da clínica saem dos templates** (forma de pagamento, convênio, assinatura
  com registro profissional). Elas vão para mensagens de texto do bot, configuráveis por clínica.
- As chaves de "layout novo/antigo" do piloto (`…_NEW_LAYOUT`, `…_REMINDER_SHORT`) não passam
  para o RecepClinic: ele já começa com uma versão só de cada template.

**Por quê:** onboarding sem espera nem redação por clínica, e manutenção de uma versão só.

**Descartado:** texto livre por clínica (12 textos para escrever e aprovar a cada clínica e uma
versão por clínica para manter).

**Resolve:** L18, L19, L20 (encaminha), L21, L22, L25 (parte das mensagens).

## D4 — Nicho e configuração por clínica (03/out/2026)

### D4a — Escopo do nicho

**Decisão: genérico desde a 1ª versão.** A pediatria (o piloto, e pediatras e alergistas como
nicho comercial inicial) é um caso de uso entre outros, não uma premissa do modelo.

- **Modelo**: "contato" (quem conversa no WhatsApp) → pacientes. O paciente **pode ser o próprio
  contato** em qualquer atendimento. Um contato pode cuidar de vários pacientes (pais, cuidadores,
  convênios com muitas crianças).
- **Regras de idade** (idade limite, restrições de retorno ou de quem pode marcar por si)
  configuráveis por clínica. Numa clínica de adultos ficam desligadas.
- **Vocabulário configurável por clínica** nos textos do bot, nas páginas públicas e no painel
  (ex.: "criança" × "paciente", "responsável" × "contato"). Como configurar está na D4b.

**Por quê:** decisão do cliente. O produto não deve depender de um nicho e precisa servir clínicas
de adultos sem mudar o modelo depois.

**Implicação registrada:** é a escolha de maior esforço. Os textos do bot (`messages.ts`, 946
linhas), as notificações, as páginas públicas e as telas passam por revisão de vocabulário. Para não
cair em "dezenas de configurações" (regra 4 do README), a forma de configurar deve ser enxuta
(D4b).

**Descartado:** pediatria com modelo aberto a adulto, mas vocabulário pediátrico; e só pediatria.

**Resolve:** L07; parte de L24.

### D4b — Como cada clínica é configurada

**Decisão: perfil pronto + poucos campos.**

- **Perfil da clínica**: *Pediátrica*, *Adultos* ou *Mista*. Define o vocabulário dos textos
  ("criança/responsável" × "paciente/contato"; a *Mista* usa **"paciente/responsável"**, decisão do
  cliente em 05/out/2026) e as regras de idade padrão. A idade limite continua ajustável.
- **Identidade**: nome da clínica, profissionais (nome, profissão e especialidade, registro no
  conselho de classe: conselho, número e UF, ex.: CRM, CRO, CRP, CREFITO, CRN; revisão de 04/out; e o
  RQE, opcional, um ou mais números, cliente em 05/out),
  endereços dos locais, logo e cor. Tudo por tela, incluindo criar, editar e desativar locais.
- **Informações do bot**: textos curtos editáveis (formas de pagamento, convênios, observações).
- **Fuso por clínica** e **feriados**: nacionais calculados + lista de datas extras da clínica
  (feriado municipal, Carnaval etc.).
- **Prazos do produto** (pausa de 24h da secretária, inatividade de 15 min, oferta de 60 min,
  antecedência de 2h, busca de 60 dias, resumo 1h antes, lembrete das 7h às 20h) ficam como
  **padrões do produto, sem tela**. Viram configuração só quando uma clínica pedir.
- Continuam configuráveis como hoje: disponibilidade, durações, valores, exames, contatos do
  resumo do dia, hora do lembrete.

**Por quê:** cobre o genérico (D4a) com três perfis bem testados em vez de combinações livres
impossíveis de testar, e segue a regra de não criar dezenas de configurações.

**Descartado:** tudo campo a campo (tela grande e combinações demais para testar).

**Resolve:** L24, L25, L26, L29, L30; L28 fica como padrão do produto.

### D4c — Tipos de atendimento

**Decisão: catálogo de serviços por clínica, com categorias de comportamento fixas.**

- Cada clínica cadastra seus **serviços**: nome, duração, preço, agenda em que ocupa horário (D2)
  e categoria.
- **Três categorias**, com comportamento no código e testado:
  - **Consulta**: atendimento comum.
  - **Retorno**: ligado a uma consulta de origem, com prazo e preço próprios (hoje: grátis, 30 dias,
    domiciliar sem retorno — vira regra do serviço).
  - **Exame/procedimento**: preparo, turma com vagas opcional, disponibilidade própria.
- Os exames do piloto viram serviços da categoria Exame. "Consulta" e "Retorno" viram serviços
  cadastrados, não mais valores fixos do banco.
- Os **menus do bot** são montados a partir do catálogo da clínica, agrupados por categoria.
- Local de atendimento (consultório, domiciliar) continua separado do serviço. O local fictício
  "Exames" deixa de existir (L08), porque a agenda do serviço resolve isso.

**Por quê:** é o que o genérico (D4a) exige, mantendo poucos comportamentos para testar.

**Descartado:** três tipos fixos para todas (não atende clínicas com outros serviços).

**Resolve:** L06, L08.

## D5 — Forma de evolução do código (03/out/2026)

**Decisão: evoluir no lugar, com base nova e rede de segurança.**

- **Mantém a stack**: Astro + Supabase + Vercel. O problema não é a tecnologia, é o modelo de
  uma clínica só.
- **Schema novo consolidado**: como o RecepClinic não tem dados reais (os dados da Dra. ficam no
  banco do piloto), o banco recomeça com uma **migração-base** já no modelo alvo (clínica, agendas,
  serviços, contato → paciente, RLS por clínica). Não se empilha a 39ª migração sobre o modelo
  atual. As 38 migrações do piloto ficam no histórico do git como referência.
- **Migrações versionadas pela CLI do Supabase**, aplicadas igual em todos os ambientes (fim do SQL
  Editor à mão).
- **Rede de segurança antes de adaptar o código**: testes automatizados das regras críticas
  (horários livres, retorno, idade, lista de espera, lembretes) e **testes de isolamento** (usuário,
  bot e agendador da clínica A não leem nem escrevem dados da clínica B). Testes rodam no CI.
- **Acesso ao banco concentrado por domínio** (agenda, pacientes, mensagens…) em vez de consultas
  espalhadas por páginas e rotas.
- **Código adaptado módulo por módulo** (agenda, bot, envios, painel, páginas públicas),
  reaproveitando telas, fluxos e regras validados no piloto.
- **Cenário B** (a Dra. passar para o RecepClinic): script de importação do banco do piloto para o
  modelo novo, feito só quando for o caso.

**Por quê:** as regras validadas em uso real são o maior valor do código. Sem dados para migrar, o
schema pode recomeçar limpo. Os testes e a concentração do acesso ao banco atacam os dois maiores
riscos (L12, L38).

**Descartado:**
- Reescrever noutra stack: perde o que foi validado e demora mais.
- Evoluir direto: refatoração grande sem testes.

**Resolve:** L09, L12, L37, L38; encaminha L36 (ambientes) e L40 (datas, junto do fuso por clínica).

## D6 — Papéis no painel (03/out/2026)

**Decisão: três papéis por clínica e o suporte da plataforma.**

- **Papéis por clínica** (uma pessoa pode ter papel em várias clínicas):
  - **Administrador**: tudo, incluindo equipe (convidar, remover, trocar papel), configurações e a
    conexão do WhatsApp.
  - **Profissional**: agenda, pacientes, métricas e financeiro (no piloto, a "médica").
  - **Recepção**: agenda, pacientes, envios e lista de espera (no piloto, a "secretária").
- **Suporte RecepClinic**: papel da plataforma, que entra numa clínica para dar suporte, com cada
  acesso registrado na trilha de auditoria.
- **Sem papel = sem acesso** (fim do "sem perfil = secretária").
- Os papéis valem **no banco (RLS) e na aplicação**, não só no middleware.
- No piloto, se migrar (cenário B): Dra. = Administradora + Profissional; secretária = Recepção.

**Descartado:** manter secretária/médica (sem quem gerencie a equipe nem suporte da plataforma).

**Resolve:** L13, L14, L15.

**Revisão de 04/out/2026 (cliente): acesso por agenda.**

- Além do papel, cada membro tem um **acesso às agendas**: **todas por padrão** para Administrador e
  Recepção, com a opção de o Administrador **restringir a pessoa a agendas selecionadas**.
- O **Profissional vê só a própria agenda** (e os atendimentos dela), salvo se liberado para outras.
- Vale **no banco (RLS)** e na aplicação, como os papéis.
- **Pacientes** (cadastro, contato, convênio, observações): **toda a equipe da clínica vê todos**,
  como no piloto (cliente, 04/out). O acesso por agenda vale para agendas e atendimentos.
  Descartado: restringir o cadastro pelo acesso às agendas.

**Revisão de 05/out/2026 (cliente): matriz de acesso (D11).** O que cada clínica pode usar (telas,
abas e funções) é liberado pelo Administrador do sistema (o Suporte RecepClinic). Métricas e
relatórios: o Profissional só os vê com o item "Métricas pessoais do profissional" liberado, e só
da própria agenda (antes, via a clínica toda).

**Revisão de 04/out/2026 (cliente): acesso do Suporte RecepClinic.**

- O Suporte tem **acesso permanente a todas as clínicas**, sem sessão nem autorização da clínica.
- **Tudo fica registrado:** alterações pelo próprio banco (gatilhos, desde a F2.1); leituras pela
  aplicação, a cada tela ou consulta aberta pelo Suporte (F3/F4).
- **LGPD:** o acesso do Suporte precisa constar no termo de tratamento de dados e no contrato com
  as clínicas (pendência do cliente, com revisão de advogado).
- **Descartado:** sessão com motivo e prazo; autorização prévia da clínica a cada acesso.

## D7 — Endereço do produto (03/out/2026)

**Decisão: um domínio único do RecepClinic.**

- O mesmo domínio serve o **painel**, os **links públicos** enviados por WhatsApp (agendar, preparo,
  lista de espera), a **política de privacidade** e os **termos de uso** do produto.
- A clínica é identificada pelo **token do link** ou pelo **login**, não pelo endereço.
- As páginas públicas mostram a **marca da clínica** (nome, logo, cor, profissionais; D4b), não a
  do RecepClinic em primeiro plano.
- **O site da Dra. sai do produto** e fica no repositório do piloto, como cliente externo. Ele
  pode ter um botão "Agendar pelo WhatsApp" apontando para o número da clínica.
- Domínio próprio da clínica fica para quando alguma pedir.
- Domínio registrado pelo cliente: `recepclinic.com.br`.

**Ajuste (03/out/2026): site do produto em projeto separado.** O cliente registrou
`recepclinic.com.br`. O domínio continua único, mas com **um subdomínio por função**, não por
clínica:

| Endereço | O que serve | Projeto |
|---|---|---|
| `www.recepclinic.com.br` | apresentação do produto, contato, **política de privacidade** e **termos de uso** | site estático, repositório separado |
| `app.recepclinic.com.br` | painel e links públicos enviados por WhatsApp | este repositório |

O site precisa estar no ar **antes** do produto, porque a verificação da empresa e o app de Tech
Provider na Meta pedem um site no domínio da empresa e a URL da política de privacidade. Por isso
ele não pode depender do ritmo do produto. O aplicativo aponta para as páginas legais do site. O
site fica numa hospedagem estática gratuita que permita uso comercial (a Vercel Hobby não permite).

**Descartado:** subdomínio por clínica (trabalho de DNS e certificado sem ganho de segurança, já que
o token identifica a clínica); domínio da clínica (trabalho por clínica).

**Resolve:** L27, L31, L32 (as páginas entram no plano).

## D8 — Ambientes e planos (03/out/2026)

**Decisão: local + staging gratuito + produção paga só a partir do 1º piloto.**

| Ambiente | Para quê | Onde | Custo |
|---|---|---|---|
| Local | desenvolver e rodar os testes | Supabase na máquina (CLI + Docker) | US$ 0 |
| Staging | testar com WhatsApp de verdade, **só com números de teste** | projeto Supabase separado + preview da Vercel | US$ 0 |
| Produção | 1º piloto do RecepClinic em diante | **Supabase Pro** (backup diário) + **Vercel Pro** (uso comercial) | ~US$ 45/mês |

- **Nenhum ambiente do RecepClinic usa o banco, o número ou os segredos do piloto.**
- O Free do Supabase permite 2 projetos ativos por organização (o piloto usa um); se faltar vaga,
  o staging vai para uma organização separada. O Docker é pré-requisito do ambiente local.
- O piloto atual não muda: segue a decisão já tomada de ir para produção no gratuito.

**Por quê:** até o 1º piloto não há dados reais nem uso comercial; os planos pagos entram quando
passam a ser necessários (backup, termos da Vercel).

**Descartado:** sem ambiente local (testes e desenvolvimento num banco compartilhado); produção no
gratuito (sem backup e fora dos termos comerciais da Vercel).

**Resolve:** L36, L41, L48.

---

## D9 — Atendimentos recorrentes (04/out/2026)

**Decisão: séries de atendimentos criadas no painel.** Necessidade de psicólogos, fisioterapeutas,
nutricionistas e outros profissionais com sessões que se repetem.

- **Quem cria:** a recepção ou o profissional, **no painel**. Frequência semanal, quinzenal ou a
  cada N semanas, com dia e horário fixos e o mesmo profissional, serviço e local.
- **Fim:** por data, por número de sessões ou **sem fim**. Sem fim, o sistema mantém as próximas
  sessões criadas num **horizonte móvel** (padrão do produto, ex.: 3 meses à frente).
- **Cada sessão é um atendimento comum**, ligado à série: lembrete, confirmação, presença, preço,
  trilha e lista de espera funcionam como em qualquer atendimento.
- **Conflitos** (feriado, bloqueio, horário ocupado): a sessão **é pulada** e a tela **lista as
  datas puladas e o motivo** para a recepção remarcar à mão, se quiser.
- **Alterar ou cancelar no painel:** **"só esta sessão"** ou **"esta e as próximas"** (encerra a
  série ou muda dia/horário dali em diante). Sessões passadas nunca mudam.
- **WhatsApp:** o bot **não cria séries**. O paciente cancela ou remarca **só a sessão** do lembrete,
  e a série continua.
- **Lista de espera** (padrão assumido): sessão de série cancelada abre vaga normalmente; a sessão
  de série **não entra na fila** para antecipar (horário fixo combinado).

**Por quê:** decisão do cliente; o produto é genérico (D4a) e esses profissionais trabalham em
sessões contínuas.

**Descartado:** séries sempre com fim (exigiria renovar terapias sem prazo); criação de série pelo
bot (sem demanda validada); "cancelar todas as próximas" pelo WhatsApp (o paciente encerraria o
tratamento sem a clínica perceber); bloquear a série inteira por um conflito.

## D10 — Convênios e planos de saúde (04/out/2026)

**Decisão: o banco já nasce preparado para convênios; telas e bot entram depois do 1º piloto.**

- **Planos atendidos:** cada clínica cadastra os planos que atende (nome, nomes alternativos para a
  busca e, opcional, registro ANS). Por padrão **todo profissional atende todos os planos da
  clínica**, com a opção de marcar exceções (ex.: Dr. João aceita Unimed, Dra. Ana não). O bot só
  oferece profissional que atende o plano do paciente.
- **Paciente:** plano (ou particular), número da carteirinha e validade, opcionais. Guardado no
  cadastro para não perguntar de novo.
- **Atendimento:** guarda se foi particular ou por qual plano, **copiado do paciente na marcação**
  e editável; trocar de plano depois não altera o histórico.
- **No WhatsApp** (clínica que atende convênio): ao pedir o nome do paciente, o bot pede também o
  convênio. O nome digitado é **buscado por semelhança** entre os planos da clínica e o bot pede
  **uma confirmação única** de nome, idade e convênio. Convênio não atendido ou não encontrado: o
  bot avisa, mostra os planos atendidos (se forem poucos) e oferece **seguir como particular,
  tentar outro nome ou falar com a recepção**. "Particular" segue direto.
- **Na página de escolha de data e horário:** a clínica escolhe se **exige os dados do convênio**
  (carteirinha, validade) na marcação.
- **Fora por enquanto:** preço por plano, guias, autorizações e faturamento de convênio. Cada
  atendimento continua com o preço do serviço.

**Por quê:** decisão do cliente. Boa parte das clínicas atende convênio; mudar o modelo depois,
com dados reais, custaria caro.

**Descartado:** lista só por clínica (não cobre credenciamentos diferentes por profissional); planos
por profissional e serviço (combinações demais sem demanda); plano só no paciente (histórico errado
quando ele troca de plano); encaminhar todo plano não atendido para a recepção; marcar com "plano a
confirmar" (marcaria quem a clínica não atende).

## D11 — Matriz de acesso por clínica (05/out/2026)

**Decisão: o Administrador do sistema libera, clínica a clínica, as telas, abas e funções que cada
uma pode usar; o básico do consultório vem sempre ligado.**

- **Quem configura:** o **Administrador do sistema**, dono do RecepClinic (na D6, o papel da
  plataforma, "Suporte RecepClinic"). Ele **escolhe a clínica e marca o que ela pode acessar**. A
  clínica, inclusive o Administrador dela, não muda o que tem liberado.
- **Itens da matriz:** cada item é uma **tela ou aba** (ex.: aba Financeiro das Métricas) ou uma
  **função sem tela** (ex.: bot, lembrete automático, atendimento domiciliar). Item desligado some
  da clínica: menu, rota, bot, páginas públicas e envios automáticos.
- **Sempre ligado (padrão de toda clínica, fora da matriz):** agenda (dia, semana, mês), bloqueios
  e trilha; marcar, remarcar e cancelar consulta e retorno; pacientes e contatos (cadastro, edição,
  histórico); a tela do Resumo do dia e o registro de comparecimento ("Aguardando remarcação", "A
  registrar", "Registradas"); configurações básicas (perfil, identidade, profissionais, locais de
  consultório, agendas, disponibilidade, feriados, serviços de consulta e retorno, equipe e
  acessos).
- **Liberados pelo Administrador do sistema** (clínica nova começa com todos desligados):
  - **Agenda:** exames/procedimentos (serviços de exame, turmas, preparo); atendimento domiciliar
    (locais domiciliares e a opção no painel e no bot); séries recorrentes (D9); convênios (D10).
  - **WhatsApp:** bot (atendimento automático, links de agendamento, avisos de confirmação,
    remarcação e cancelamento, informações do bot); lembrete automático (lembrete da véspera, aba
    Lembretes, botões de envio e reenvio, reenvio automático, hora do lembrete); lista de espera
    (aba e ofertas; **depende do bot**); envio do resumo do dia (e os contatos do resumo).
  - **Métricas, uma aba por item:** Visão geral, Atendimentos, Faltosos, Retomar contato, Funil do
    bot (**depende do bot**), Financeiro, Envios; **Relatórios**.
  - **Métricas pessoais do profissional:** o Profissional vê as métricas e os relatórios liberados
    **só da própria agenda**.
- **Dependências:** item que depende de outro só é ligado com ele; desligar o bot desliga a lista
  de espera e o Funil. Bot, lembrete, lista de espera e resumo do dia só enviam com o WhatsApp da
  clínica conectado (situação da conexão, não item da matriz).
- **Limite de profissionais (cliente, 05/out/2026):** o Administrador do sistema define, na mesma
  tela, quantos profissionais **ativos** cada clínica pode ter (desativar libera a vaga). Clínica nova
  começa com **1**; as que já existiam ficaram com o que tinham. No limite, a clínica não cadastra
  nem reativa profissional ("fale com o suporte"), e o banco também barra. Baixar o limite abaixo
  dos ativos não desativa ninguém: só impede novos até ficar abaixo. A mudança fica no histórico.
- **Papéis continuam fixos (D6):** a matriz diz o que a clínica tem; o papel diz quem, dentro dela,
  vê. Configurações continuam só do Administrador da clínica (inclusive os itens de configuração
  liberados).
- **Métricas e relatórios (muda a D6):** com o item liberado, o **Administrador da clínica** vê a
  clínica toda. O **Profissional só vê métricas e relatórios se as "Métricas pessoais do
  profissional" estiverem liberadas**, e aí só os da própria agenda. Sem esse item, não vê nenhum.
- **Registro:** cada mudança na matriz guarda quem mudou e quando.
- **Sem cobrança:** a matriz não cobra nem limita uso (L49 continua). Pacotes com nome, quando
  forem definidos, viram combinações prontas de itens.

**Por quê:** decisão do cliente. Permite vender pacotes diferentes sem código novo por clínica e
liberar funções aos poucos.

**Descartado:** liberar por função inteira (pouco controle sobre abas de valor comercial, como
Financeiro); pacotes fixos no código (ainda não definidos); papéis configuráveis por clínica
(combinações demais para testar; a D6 continua).

## Padrões assumidos (revisáveis)

Pontos dos limites com caminho óbvio, que não precisaram de decisão. Qualquer um pode ser revisto.

| Limite | Padrão |
|---|---|
| L16 Gestão de usuários | Convite por e-mail feito pelo Administrador da clínica, recuperação e troca de senha pelo próprio Supabase Auth. Fim dos logins criados à mão. |
| L17 2FA / tentativas | Fica para P2. No P1, só o limite de tentativas do Supabase Auth. |
| L23 Webhook | Responde 200 logo depois de validar e registrar o evento; o processamento continua em seguida, sem segurar a resposta. Eventos repetidos da Meta são ignorados pelo id da mensagem. |
| L33 Envios automáticos | Cada execução percorre as clínicas ativas, cada uma com seu horário, fuso e contatos; a falha de uma não para as outras e fica registrada com a clínica. |
| L34 Agendador | Configuração do `pg_cron` e dos segredos feita por migração e script, igual em todos os ambientes. |
| L35 Gatilho da lista de espera | Mantido como está; revisto só se atrapalhar os testes. |
| L39 Variáveis de ambiente | Validadas na subida da aplicação; só as da plataforma (as da clínica ficam no banco, D3). |
| L40 Datas e fuso | Biblioteca de datas com suporte a fuso, usada em todo o código, junto do fuso por clínica (D4b). |
| L42 LGPD | No P1: exclusão (anonimização) de paciente e contato a pedido, política de retenção escrita, termo de tratamento de dados e política de privacidade do produto (D7). Contrato com as clínicas: fora do código, pendente do cliente. |
| L43 Logs | Sem telefone, nome ou texto de mensagem nos logs; só ids e a clínica. |
| L44 Segurança das páginas | Cabeçalhos de segurança e `robots.txt` bloqueando painel e links públicos. |
| L45 Observabilidade | Ferramenta de erros com a clínica em cada erro e monitor externo do painel e do webhook. Escolha da ferramenta no plano (etapa 4). |
| L46 Formulários | Proteção de origem do Astro ligada explicitamente na configuração. |
| L47 Onboarding | No P1, a clínica é criada pelo Suporte RecepClinic pela tela "Nova clínica" (F4.4a), que **sempre convida o primeiro Administrador na criação**. A configuração é feita pelo Administrador da clínica ou, **se ele preferir, pelo Suporte** (que já abre qualquer clínica, D6): nesse caso, o Suporte envia por e-mail um **pedido de informações com um formulário por link** (8 seções: clínica, locais, profissionais, serviços, dias e horários, feriados, equipe, WhatsApp e avisos; campos para o simples e texto livre com exemplo para o que é tabela; só o que estiver liberado na matriz); as respostas ficam na tela do Suporte, que revisa e cadastra (nada entra sozinho). Cliente, 05/out/2026. Autocadastro fica para depois. |
| L49 Cobrança | Sem billing. Só contadores de uso por clínica (mensagens enviadas, atendimentos) para não fechar a porta. O que cada clínica pode usar é liberado pela matriz de acesso (D11). |
| L50 Custo da Meta | Levantar a tabela atual de preços por mensagem antes de definir o preço do produto (tarefa do cliente, fora do código). |

## Cobertura dos limites

Todos os 50 limites têm destino:

| Destino | Limites |
|---|---|
| D1 Isolamento | L01, L03, L04, L05, L10, L11, L13 |
| D2 Agendas | L02 |
| D3 WhatsApp | L18, L19, L20, L21, L22 |
| D4 Nicho e configuração | L06, L07, L08, L24, L25, L26, L28, L29, L30 |
| D5 Evolução do código | L09, L12, L37, L38 |
| D6 Papéis | L13, L14, L15 |
| D7 Domínio | L27, L31, L32 |
| D8 Ambientes | L36, L41, L48 |
| Padrões assumidos | L16, L17, L23, L33, L34, L35, L39, L40, L42, L43, L44, L45, L46, L47, L49, L50 |

## Pendências do cliente (fora do código)

- **Meta**: iniciar a verificação da empresa e o cadastro como Tech Provider (D3a). Depende de CNPJ e
  de um site com política de privacidade.
- **CNPJ, contrato com as clínicas e termo de tratamento de dados** (LGPD), incluindo o acesso
  permanente do Suporte RecepClinic aos dados das clínicas (D6, revisão de 04/out).
- **Custo da Meta por mensagem** (L50).
- **Provedor de e-mail** (ex.: Resend) com o domínio `recepclinic.com.br`: necessário para o pedido
  de informações (F4.4a) e, na nuvem, para os convites e a recuperação de senha (o envio padrão do
  Supabase tem limite muito baixo). Antes do 1º piloto; localmente os e-mails ficam no Mailpit.
