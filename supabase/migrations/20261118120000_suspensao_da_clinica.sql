-- F12.3 — Faturamento do SaaS: suspensão manual da clínica por motivos.
--
-- Plano em docs/planejamento-faturamento-saas.md (decisões 11.1, 11.3, 11.4,
-- 11.12, itens 20 e 23 da seção 11; cliente, 28/out, 30/out e 02/nov/2026):
--   1. a clínica fica suspensa enquanto houver algum motivo ativo
--      (clinic_suspensions); clinics.status = 'suspended' é a consequência e o
--      sinal para o resto do sistema; ao suspender, a situação anterior
--      (ativa ou em implantação) fica guardada e volta quando o último motivo
--      é liberado;
--   2. motivos: inadimplência (non_payment), administrativo e fim do contrato.
--      Inadimplência só a partir da F12.4 (cliente, 02/nov/2026): o banco
--      conferirá a cobrança vencida há 15 dias ou mais; até lá, é recusada.
--      Só o pagamento libera a inadimplência (F12.6);
--   3. só o Suporte suspende e libera, sempre com texto; a trilha fica em
--      billing_audit_log (o texto do Suporte vai em "after", que a clínica não
--      vê na tela; a clínica lê só os motivos, por clinic_suspension_reasons);
--   4. número sem o app WhatsApp Business (sem coexistência): na suspensão
--      ninguém recebe as mensagens dos pacientes; suspender exige uma
--      confirmação a mais (item 23);
--   5. a situação "suspensa" só entra e sai por estas funções (trava no
--      gatilho da situação); o bloqueio fica no código nesta fase (painel,
--      páginas públicas, bot e envios); o banco recusa as gravações na F12.3b.

alter table public.clinics add column status_before_suspension public.clinic_status;

create table public.clinic_suspensions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  reason text not null check (reason in ('non_payment', 'administrative', 'contract_ended')),
  note text not null check (length(note) between 3 and 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  -- Nulo com released_at preenchido = liberado pelo sistema (pagamento, F12.6).
  released_by uuid references auth.users (id) on delete set null,
  release_note text check (release_note is null or length(release_note) <= 1000),
  check (released_at is not null or (released_by is null and release_note is null))
);

create unique index clinic_suspensions_one_active on public.clinic_suspensions (clinic_id, reason) where released_at is null;
create index clinic_suspensions_clinic_idx on public.clinic_suspensions (clinic_id, created_at desc);

alter table public.billing_audit_log drop constraint billing_audit_log_action_check;
alter table public.billing_audit_log add constraint billing_audit_log_action_check check (action in (
  'account_created', 'account_updated', 'contacts_updated', 'whatsapp_opt_in', 'whatsapp_opt_out',
  'contract_draft_saved', 'contract_draft_discarded', 'contract_activated', 'contract_ended',
  'contract_accepted', 'contract_notice_sent', 'contract_notice_failed',
  'clinic_suspended', 'suspension_released'
));

-- ---------------------------------------------------------------------------
-- Regra 5: a situação "suspensa" só pelas funções abaixo.
-- ---------------------------------------------------------------------------
create or replace function app.guard_clinic_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sem usuário (service role, migrações): livre.
  if new.status is distinct from old.status and (select auth.uid()) is not null then
    if not app.is_platform_staff() then
      raise exception 'Só o Suporte do RecepClinic muda a situação da clínica.' using errcode = '42501';
    end if;
    if (old.status = 'suspended' or new.status = 'suspended')
       and coalesce(current_setting('app.clinic_suspension', true), '') <> 'on' then
      raise exception 'A suspensão entra e sai pelos motivos, na aba Faturamento da clínica.'
        using errcode = 'P0001', hint = 'clinic_suspension_by_reason';
    end if;
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Suspender (regras 1 a 4)
-- ---------------------------------------------------------------------------
create function public.suspend_clinic(p_clinic_id uuid, p_reason text, p_note text, p_no_app_confirmed boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic public.clinics%rowtype;
  v_note text := trim(coalesce(p_note, ''));
  v_id uuid;
begin
  if not app.is_platform_staff() then
    raise exception 'Só o Suporte suspende a clínica.' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('non_payment', 'administrative', 'contract_ended') then
    raise exception 'Escolha o motivo da suspensão.' using errcode = 'P0001', hint = 'suspension_reason';
  end if;
  if p_reason = 'non_payment' then
    raise exception 'A suspensão por inadimplência entra com as cobranças.' using errcode = 'P0001', hint = 'suspension_non_payment_unavailable';
  end if;
  if length(v_note) < 3 or length(v_note) > 1000 then
    raise exception 'Escreva o motivo (de 3 a 1.000 caracteres).' using errcode = 'P0001', hint = 'suspension_note';
  end if;

  -- A mesma trava da conta de cobrança (seção 7 do plano), depois a da clínica.
  perform 1 from public.billing_accounts where clinic_id = p_clinic_id for update;
  select * into v_clinic from public.clinics where id = p_clinic_id for update;
  if v_clinic.id is null then
    raise exception 'Clínica não encontrada.' using errcode = 'P0001', hint = 'clinic_missing';
  end if;
  if exists (select 1 from public.clinic_suspensions where clinic_id = p_clinic_id and reason = p_reason and released_at is null) then
    raise exception 'A clínica já está suspensa por este motivo.' using errcode = 'P0001', hint = 'suspension_reason_active';
  end if;
  -- Regra 4: sem o app, ninguém recebe as mensagens dos pacientes.
  if exists (select 1 from public.whatsapp_connections where clinic_id = p_clinic_id and status = 'connected' and not coexistence)
     and not coalesce(p_no_app_confirmed, false) then
    raise exception 'A clínica não usa o app WhatsApp Business: confirme que, suspensa, ninguém vai receber as mensagens dos pacientes.'
      using errcode = 'P0001', hint = 'suspension_no_app_confirm';
  end if;

  insert into public.clinic_suspensions (clinic_id, reason, note, created_by)
  values (p_clinic_id, p_reason, v_note, (select auth.uid()))
  returning id into v_id;

  if v_clinic.status <> 'suspended' then
    perform set_config('app.clinic_suspension', 'on', true);
    update public.clinics set status_before_suspension = v_clinic.status, status = 'suspended' where id = p_clinic_id;
    perform set_config('app.clinic_suspension', '', true);
  end if;

  perform app.log_billing(p_clinic_id, 'clinic_suspended',
    jsonb_build_object('status', v_clinic.status),
    jsonb_build_object('status', 'suspended', 'suspension_id', v_id, 'reason', p_reason, 'note', v_note));
  return v_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Liberar um motivo (o Suporte; a inadimplência só pelo pagamento, F12.6)
-- ---------------------------------------------------------------------------
create function public.release_clinic_suspension(p_suspension_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.clinic_suspensions%rowtype;
  v_clinic public.clinics%rowtype;
  v_note text := trim(coalesce(p_note, ''));
  v_restored public.clinic_status;
begin
  if not app.is_platform_staff() then
    raise exception 'Só o Suporte libera a suspensão.' using errcode = '42501';
  end if;
  if length(v_note) < 3 or length(v_note) > 1000 then
    raise exception 'Escreva o motivo da liberação (de 3 a 1.000 caracteres).' using errcode = 'P0001', hint = 'suspension_note';
  end if;
  select * into v_row from public.clinic_suspensions where id = p_suspension_id;
  if v_row.id is null then
    raise exception 'Suspensão não encontrada.' using errcode = 'P0001', hint = 'suspension_missing';
  end if;
  perform 1 from public.billing_accounts where clinic_id = v_row.clinic_id for update;
  select * into v_clinic from public.clinics where id = v_row.clinic_id for update;
  select * into v_row from public.clinic_suspensions where id = p_suspension_id for update;
  if v_row.released_at is not null then
    raise exception 'Este motivo já foi liberado.' using errcode = 'P0001', hint = 'suspension_released';
  end if;
  if v_row.reason = 'non_payment' then
    raise exception 'A inadimplência é liberada pelo pagamento.' using errcode = 'P0001', hint = 'suspension_non_payment_auto';
  end if;

  update public.clinic_suspensions
     set released_at = now(), released_by = (select auth.uid()), release_note = v_note
   where id = v_row.id;

  if not exists (select 1 from public.clinic_suspensions where clinic_id = v_row.clinic_id and released_at is null) then
    v_restored := coalesce(v_clinic.status_before_suspension, 'active');
    perform set_config('app.clinic_suspension', 'on', true);
    update public.clinics set status = v_restored, status_before_suspension = null where id = v_row.clinic_id;
    perform set_config('app.clinic_suspension', '', true);
  end if;

  perform app.log_billing(v_row.clinic_id, 'suspension_released',
    jsonb_build_object('status', v_clinic.status, 'suspension_id', v_row.id, 'reason', v_row.reason),
    jsonb_build_object('status', coalesce(v_restored, v_clinic.status), 'suspension_id', v_row.id, 'reason', v_row.reason, 'note', v_note));
end
$$;

-- Motivos ativos, para quem é da clínica (sem o texto do Suporte).
create function public.clinic_suspension_reasons(p_clinic_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select reason from public.clinic_suspensions
   where clinic_id = p_clinic_id and released_at is null
     and (app.is_platform_staff() or app.is_clinic_member(p_clinic_id))
   order by created_at
$$;

create trigger clinic_suspensions_audit_platform_staff
  after insert or update or delete on public.clinic_suspensions
  for each row execute function app.audit_platform_staff_write();

alter table public.clinic_suspensions enable row level security;
create policy clinic_suspensions_select on public.clinic_suspensions
  for select to authenticated using (app.is_platform_staff());
revoke insert, update, delete, truncate on public.clinic_suspensions from authenticated;
revoke all on public.clinic_suspensions from anon, clinic_service;
-- Bot e páginas públicas (credencial da clínica) leem só a situação, em clinics.

revoke execute on function public.suspend_clinic(uuid, text, text, boolean) from public, anon, clinic_service;
revoke execute on function public.release_clinic_suspension(uuid, text) from public, anon, clinic_service;
revoke execute on function public.clinic_suspension_reasons(uuid) from public, anon, clinic_service;
grant execute on function public.suspend_clinic(uuid, text, text, boolean) to authenticated;
grant execute on function public.release_clinic_suspension(uuid, text) to authenticated;
grant execute on function public.clinic_suspension_reasons(uuid) to authenticated;
