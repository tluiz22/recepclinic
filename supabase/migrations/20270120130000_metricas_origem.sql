-- F6, parte 1: de onde vêm as marcações (Métricas › Desempenho).
-- Três origens: recepção (painel), WhatsApp (bot, ou link do bot no portal) e link do portal (da clínica ou do
-- profissional). Do link do portal guarda também onde o link estava (`portal_place`: Instagram, site…).
-- Mesmo recorte de `metrics_activity`: marcadas no período (pela data da marcação), sem importadas, com as
-- canceladas depois (continuam contando como marcadas).
create or replace function public.metrics_origin(
  p_clinic_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_agenda_ids uuid[],
  p_service_ids uuid[] default null,
  p_location_ids uuid[] default null
) returns table (
  origin text,
  entry text,
  place text,
  total bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when a.booking_channel = 'admin' then 'reception'
           -- Portal sem entrada gravada (a marca é um UPDATE à parte): fica em "link do portal", sem inflar o WhatsApp.
           when a.booking_channel = 'portal' and a.portal_entry is distinct from 'whatsapp' then 'portal_link'
           else 'whatsapp'
         end as origin,
         case when a.booking_channel = 'portal' and a.portal_entry in ('clinic_link', 'professional_link') then a.portal_entry end as entry,
         case when a.booking_channel = 'portal' and a.portal_entry in ('clinic_link', 'professional_link') then a.portal_place end as place,
         count(*) as total
    from public.appointments a
   where a.clinic_id = p_clinic_id
     and a.created_at >= p_start and a.created_at < p_end
     and a.agenda_import_id is null
     and a.agenda_id = any ((select app.metrics_agendas(p_clinic_id, p_agenda_ids))::uuid[])
     and (p_service_ids is null or a.service_id = any (p_service_ids))
     and (p_location_ids is null or a.location_id = any (p_location_ids))
   group by 1, 2, 3
$$;

revoke execute on function public.metrics_origin(uuid, timestamptz, timestamptz, uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.metrics_origin(uuid, timestamptz, timestamptz, uuid[], uuid[], uuid[]) to authenticated;
