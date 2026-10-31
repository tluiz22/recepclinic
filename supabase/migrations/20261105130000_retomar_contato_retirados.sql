-- Retomar contato: "Retirar da lista" (cliente, 31/out/2026). A equipe tira da
-- lista quem começou pelo WhatsApp e não concluiu (às vezes só queria tirar uma
-- dúvida). Vale para as tentativas até aquele momento: uma tentativa nova,
-- depois de retirada, traz a pessoa de volta. Some do Relacionamento e da aba
-- Retomar contato das Métricas.
--
-- Uma linha por número e fluxo (o rótulo do fluxo, como a lista agrupa);
-- retirar de novo atualiza a hora. A equipe toda lê (as Métricas também
-- filtram); Administrador e Recepção retiram; Suporte com auditoria.
--
-- Reversão: drop table public.recall_dismissals; drop function app.recall_dismissal_rules().

create table public.recall_dismissals (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  phone text not null check (char_length(phone) between 8 and 20),
  flow_label text not null check (char_length(flow_label) between 1 and 80),
  dismissed_at timestamptz not null default now(),
  dismissed_by uuid default auth.uid(),
  primary key (clinic_id, phone, flow_label)
);

-- Hora e autor sempre de quem grava.
create function app.recall_dismissal_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.dismissed_at := now();
  new.dismissed_by := auth.uid();
  return new;
end
$$;

create trigger recall_dismissals_rules
  before insert or update on public.recall_dismissals
  for each row execute function app.recall_dismissal_rules();

alter table public.recall_dismissals enable row level security;

create policy recall_dismissals_select on public.recall_dismissals
  for select to authenticated using (app.is_clinic_member(clinic_id));
create policy recall_dismissals_insert on public.recall_dismissals
  for insert to authenticated
  with check (app.has_clinic_role(clinic_id, array['admin', 'reception']::public.clinic_role[]));
create policy recall_dismissals_update on public.recall_dismissals
  for update to authenticated
  using (app.has_clinic_role(clinic_id, array['admin', 'reception']::public.clinic_role[]))
  with check (app.has_clinic_role(clinic_id, array['admin', 'reception']::public.clinic_role[]));

revoke all on public.recall_dismissals from anon;
revoke delete, truncate on public.recall_dismissals from authenticated;

create trigger recall_dismissals_audit_platform_staff
  after insert or update on public.recall_dismissals
  for each row execute function app.audit_platform_staff_write();
