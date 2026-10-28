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
> - **Fim da sessão de 27/out. Retomar daqui:** o cliente vai **revisar o plano** antes de aprovar (escolheu
>   "Quero revisar o documento antes"). Na próxima sessão: receber os ajustes ou o "aprovado"; só então a etapa
>   **A1** (começa mostrando o SQL da migração do item `relationship` da matriz, para aprovação). **Nada é
>   implementado antes.** Linha de base dos testes: 691 de unidade e 636 de banco passando (local, 27/out).

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
