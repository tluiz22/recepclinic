-- Fase 16 · etapa 1: modelo de dados para o endereço do atendimento
-- domiciliar (o local "Atendimento domiciliar" em clinic_locations nunca
-- teve endereço fixo — cada família informa o seu).

-- Endereço usado NAQUELA consulta específica — só preenchido quando o
-- local é domiciliar. Fica no histórico do agendamento mesmo que o
-- "endereço padrão" do responsável mude depois.
alter table appointments
  add column home_visit_address text;

-- Cache de conveniência: o endereço mais recente informado pelo
-- responsável, só para pré-preencher a pergunta/campo da próxima vez —
-- nunca usado direto sem confirmar de novo com o responsável (ver Fase 16
-- no plano). Ainda não é lido/gravado nesta etapa (entra na etapa 2, bot
-- de WhatsApp).
alter table guardians
  add column default_home_address text;
