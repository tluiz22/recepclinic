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
