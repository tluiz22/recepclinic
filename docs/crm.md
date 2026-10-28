# CRM (etapa paralela)

> **Estado atual (retomar daqui), 27/out/2026**
>
> - Branch `CRM` criada a partir da `main` em 27/out (commit `eca4b79`).
> - **CRM.0 (diagnóstico do que já existe), pedido em 27/out:** só investigação e documentação, sem código, banco
>   ou migração. Relatório em [`analises/diagnostico-crm-atual.md`](analises/diagnostico-crm-atual.md).
> - **CRM.1 (auditoria e plano da Central de Relacionamento), pedido em 27/out:** decisões do cliente (área
>   "Relacionamento"; Resumo do Dia continua; escopo inicial = listas existentes, histórico, resultado do contato,
>   anotações gerais e registros de interação; acesso da Recepção sem abrir as Métricas). Plano em
>   [`analises/plano-evolucao-relacionamento.md`](analises/plano-evolucao-relacionamento.md), com as etapas A1–C3 e as
>   dúvidas Q1–Q9. Linha de base: 691 testes de unidade e 636 de banco passando (local, 27/out).
> - **Q1–Q9 respondidas pelo cliente em 27/out** (todas na opção recomendada; registradas na seção 11 do plano).
> - **Revisão do plano pedida pelo cliente (27/out):** direção geral aprovada; 5 ajustes feitos só no documento
>   (seção 13 do plano): segurança do histórico (rota e componente **não bastam**; etapa nova **B0** protege o texto
>   das mensagens no banco, em dois passos), "Marcou" × envio do link, Observações do paciente (perfis, gatilho do
>   "atualizado em/por" e proteção), critérios de teste de desempenho e consistência e a regra da produção.
>   Novas dúvidas **Q10 a Q13** e os riscos ainda abertos (R1 a R9) na seção 13.6.
> - **Documento revisado aprovado pelo cliente em 27/out; Q10 a Q13 respondidas** (todas na opção recomendada,
>   seção 11 do plano): 7ª opção "Enviou o link / vai marcar" e "Marcou" só com atendimento conferido; Lembretes saem
>   pelas ações e por "Não quer" e "Número errado"; Observações como hoje, com "Atualizado em … por …"; o CRM vai ao
>   **staging só pela `main`**, com o OK do cliente (validação de cada etapa no local antes).
> - **A1 implementada e testada no local em 27/out** (sem staging, Q13): migração
>   `20261028120000_relacionamento_matriz.sql` (item `relationship`, área própria, nenhuma clínica recebe; aplicada só
>   no banco local), área `relationship` (Administrador e Recepção, com o item), menu "Relacionamento" com o total
>   (Aguardando remarcação + Lembretes; a Lista de espera não soma), tela `/admin/relacionamento` com as abas
>   Aguardando remarcação, Lembretes (só não entregue e sem resposta dos atendimentos por vir, Q4) e Lista de espera.
>   Detalhes na seção 14 do [plano](analises/plano-evolucao-relacionamento.md). Testes: 703 de unidade e 642 de banco
>   passando; navegador local por papel (Recepção, Recepção restrita, Administrador, Profissional) e no celular.
> - **Defeito anterior achado na A1:** o aviso de uma ação (ex.: "Fora da lista…") aparecia de novo na tela seguinte
>   em toda clínica com o bot, por causa do contador do Atendimento no menu (F8.5a, já na produção). Corrigido na
>   `CRM` (o menu lê o aviso antes das esperas). **Decisão do cliente (27/out): vai à `main` só junto com o CRM.**
> - **A1 validada pelo cliente em 27/out** (inclusive as 3 escolhas: total do menu, aba de abertura e reenvio na Agenda).
> - **A2 implementada e testada no local em 27/out:** abas Atendimento (resumo, sem o texto das mensagens), Retomar
>   contato (14 dias, uma linha por número e fluxo), Retorno (a Oportunidade agora, com "Marcar retorno"), Faltosos e
>   Contatos para revisar (com "Revisado"); as das Métricas sem exigir os itens delas. Nomes lidos por uma função
>   compartilhada com as Métricas (`src/lib/data/people.ts`). **Total do menu (cliente, 27/out):** Aguardando
>   remarcação + Lembretes + Retomar contato + Retorno + Contatos para revisar (fora: Faltosos, Atendimento e Lista de
>   espera). Testes: 714 de unidade e 644 de banco passando. Detalhes na seção 15 do
>   [plano](analises/plano-evolucao-relacionamento.md).
> - **A2 validada pelo cliente em 27/out.**
> - **A3 (27/out):** regressão e validação por papel no local (seção 16 do
>   [plano](analises/plano-evolucao-relacionamento.md)). **Com o OK do cliente, o CRM (A1 e A2) entrou na `main` e foi
>   ao staging em 27/out:** `CRM` → `main` por avanço direto; migração `20261028120000` simulada, aplicada e conferida
>   no banco do staging (item criado, nenhuma clínica com ele); push da `main` (commit `d94bc4e`), conferido em `teste.recepclinic.com.br` (a produção, `app.`, segue sem a tela). Junto foi a
>   correção do aviso que reaparecia. **Produção: nada.**
> - **Relacionamento (A1 e A2) validado pelo cliente no staging em 27/out.** Produção: nada (só com autorização
>   explícita, pelo fluxo de `docs/producao.md`).
> - **Fim da sessão de 27/out. Retomar daqui (próxima sessão):** **etapa B**, na branch `CRM` (`git switch CRM`; hoje
>   `main` e `CRM` estão iguais). Começa pela **B0** (seção 13.1 do plano): mostrar ao cliente o SQL do **passo 1**
>   (funções `attention_last_messages` e `contact_message_history`, com a conferência do papel) e a troca do código do
>   Atendimento e de Configurações › WhatsApp para usá-las; o **passo 2** (tirar `body` e `retry_payload` da leitura
>   direta) só depois do passo 1 publicado no mesmo ambiente. Nada é aplicado antes da aprovação do SQL. Linha de base
>   dos testes: 714 de unidade e 644 de banco (local, 27/out).
> - **B0 revista em 28/out (cliente):** depois do passo 1 aprovado e feito no local, o cliente decidiu que as
>   conversas ficam no app do WhatsApp (D12): o sistema **não guarda** o texto das mensagens recebidas nem das
>   respostas da recepção (o já guardado é apagado); o texto do que o sistema envia fica, sem leitura pelo login
>   (só o Suporte); **B1 e B2 saem do plano** (Q14–Q16). Passo 1 desfeito no local e substituído por duas migrações
>   aprovadas (`20261028140000_mensagens_suporte.sql` e `20261028150000_mensagens_sem_texto.sql`), aplicadas **só no
>   local**. Testes: 714 de unidade e 649 de banco. Detalhes na seção 17 do
>   [plano](analises/plano-evolucao-relacionamento.md). **Validada pelo cliente no local em 28/out; na `main` e no
>   staging em 28/out** (migração 1 → push da `main` → migração 2; conferido no banco do staging: texto das recebidas
>   e das respostas apagado, `body` e `retry_payload` fechados ao login). **Produção: nada.**
> - **Retomar daqui:** o cliente valida a B0 no staging (Atendimento e notificação sem a frase; Configurações ›
>   WhatsApp do Suporte); depois, a **etapa C** começa pela C1 (SQL de `contact_interactions` para aprovação).
> - **B0 validada pelo cliente no staging em 28/out.** C1 aprovada e C2 feita só no local, e **desfeita no mesmo dia
>   a pedido do cliente (Q18)**: o "Registrar contato" não atende; a necessidade real é, na ficha do paciente,
>   **anotações, lembretes e documentos** (foto ou PDF de carteirinha, identidade, pedidos de exame ou médicos) para a
>   secretária encaminhar ao plano. Etapa nova planejada com o cliente em 28/out (Q19 a Q24, seção 19 do
>   [plano](analises/plano-evolucao-relacionamento.md)). **P1 Documentos implementada em 28/out, só no local**
>   (migração `20261029120000_documentos_do_paciente.sql`; 717 de unidade e 657 de banco). Validada no local
>   (com os ajustes: botões, aba "Documentos" na ficha, download sem a barra) e **publicada no staging em 28/out**
>   (`5061feb`); Documentos para todas as clínicas (Q25). **Produção: nada.** **Retomar daqui:** validação do cliente
>   no staging (anexar confere a CSP) e a P2 Anotações.

## Como trabalhar nesta etapa

- Todo o código e a documentação do CRM ficam na branch **`CRM`**. A `main` segue com as etapas do piloto (B e C) e
  publica no staging a cada push; a `producao` publica na produção.
- **Parar o CRM e voltar ao piloto:** commit e push do que estiver em andamento na `CRM`, atualizar o bloco
  "Estado atual" deste arquivo e `git switch main`.
- **Voltar ao CRM:** `git switch CRM`, trazer o que mudou na `main` (`git merge main`) e retomar pelo bloco acima.
- Um push na `CRM` pode gerar só uma *preview* na Vercel; não muda o staging nem a produção.
- O CRM entra na `main` só com a aprovação do cliente, e as decisões de arquitetura novas vão para
  [`arquitetura.md`](arquitetura.md), como as D1–D11.

## Descrição do cliente

**CRM.0, diagnóstico (27/out).** Antes de propor qualquer evolução de **CRM de relacionamento com pacientes**, o
cliente quer uma auditoria funcional e técnica do que já existe, para não propor o que o sistema já faz. Pedidos:

1. Inventário do que já funciona como CRM, mesmo sem esse nome: cadastro e identificação do paciente, histórico de
   consultas e exames, histórico e conversas do WhatsApp (em andamento, pendentes, paradas), pedidos de agendamento
   não concluídos, confirmações, cancelamentos e remarcações, lembretes e envios automáticos, pendências da recepção,
   passagem do bot para uma pessoa, registro do que a equipe fez, retorno a agendar, indicadores, filtros, status,
   responsáveis e observações.
2. Análise da tela **"Resumo do dia"**: finalidade, dados, ações, limitações, se o nome ainda serve e três caminhos
   (manter e criar "Relacionamento" à parte; evoluir o Resumo para central de relacionamento; Resumo como visão
   gerencial e "Relacionamento" como área operacional), com prós, contras, reaproveitamento e impacto.
3. Classificação de cada funcionalidade: implementada e funcional; parcial; interface sem fluxo completo comprovado;
   infraestrutura sem funcionalidade de usuário; não encontrada; não foi possível verificar.
4. Mapa de dados e arquitetura (entidades, tabelas, serviços, RLS, o que é persistido, risco de duplicação, visão
   unificada do paciente, origem, motivo de desistência, responsável, prazo e próxima ação).
5. Comparação com a visão de CRM em três grupos: **A** operacional (prioridade), **B** continuidade do relacionamento,
   **C** comercial e inteligência (campanhas só com base legal, consentimento, saída e regras de frequência).
6. Recomendações e roteiro em etapas, sem complexidade desnecessária, respeitando a LGPD e o isolamento entre clínicas.

Sem segredos, valores de variáveis de ambiente ou dados reais de pacientes no relatório. **Não implementar nada**:
aguardar a revisão do cliente.

## Planejamento

(a preencher depois da descrição)
