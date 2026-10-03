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
