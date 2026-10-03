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
  ("criança/responsável" × "paciente/contato") e as regras de idade padrão. A idade limite continua
  ajustável.
- **Identidade**: nome da clínica, profissionais (nome, especialidade, registro profissional),
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
