-- MI (cliente, 07/nov/2026, M5; docs/planejamento-multiprofissional.md, seção 4):
-- as "Informações que o bot responde" passam a ser só por profissional.
--
--   1. professional_bot_info: formas de pagamento, texto de convênios e
--      observações de cada profissional (vazio = o bot não responde aquilo);
--   2. o texto de hoje da clínica é copiado para cada profissional ativo (a
--      clínica de um profissional, como a piloto, não muda para o paciente);
--   3. as colunas da clínica (clinic_settings.bot_payment_info,
--      bot_insurance_info, bot_notes) ficam só para voltar atrás: o app não lê
--      nem grava mais; saem depois da validação do cliente.

create table public.professional_bot_info (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  professional_id uuid primary key,
  payment_info text check (payment_info is null or length(payment_info) <= 1000),
  insurance_info text check (insurance_info is null or length(insurance_info) <= 1000),
  notes text check (notes is null or length(notes) <= 1000),
  updated_at timestamptz not null default now(),
  foreign key (clinic_id, professional_id) references public.professionals (clinic_id, id) on delete cascade
);

create index professional_bot_info_clinic_idx on public.professional_bot_info (clinic_id);

create trigger professional_bot_info_set_updated_at
  before update on public.professional_bot_info
  for each row execute function app.set_updated_at();

select app.enable_clinic_config_rls('public.professional_bot_info');
revoke all on public.professional_bot_info from anon;
revoke insert, update, delete, truncate on public.professional_bot_info from clinic_service;

create trigger professional_bot_info_guard_suspended
  before insert or update or delete on public.professional_bot_info
  for each row execute function app.guard_suspended_clinic_write();

insert into public.professional_bot_info (clinic_id, professional_id, payment_info, insurance_info, notes)
select p.clinic_id, p.id, nullif(trim(s.bot_payment_info), ''), nullif(trim(s.bot_insurance_info), ''), nullif(trim(s.bot_notes), '')
  from public.professionals p
  join public.clinic_settings s on s.clinic_id = p.clinic_id
 where p.is_active
   and coalesce(trim(s.bot_payment_info), '') || coalesce(trim(s.bot_insurance_info), '') || coalesce(trim(s.bot_notes), '') <> '';

comment on column public.clinic_settings.bot_payment_info is 'Fora de uso desde a MI (07/nov/2026): professional_bot_info. Sai depois da validação.';
comment on column public.clinic_settings.bot_insurance_info is 'Fora de uso desde a MI (07/nov/2026): professional_bot_info. Sai depois da validação.';
comment on column public.clinic_settings.bot_notes is 'Fora de uso desde a MI (07/nov/2026): professional_bot_info. Sai depois da validação.';
