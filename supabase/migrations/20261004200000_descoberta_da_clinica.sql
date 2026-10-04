-- F3.3 — Descoberta da clínica nas portas públicas (D1).
--
-- Mesmo desenho do webhook (resolve_whatsapp_clinic, F2.6): a plataforma
-- (service role) só descobre de qual clínica é a requisição, com uma função
-- que devolve o id e nada mais; todo o resto segue com a credencial limitada
-- àquela clínica (clinic_service).

-- Link de agendamento enviado pelo bot (/agendar/[token]; o token é o id).
-- Link vencido ou usado também resolve: a página precisa dizer "expirado".
create function public.resolve_booking_link_clinic(p_link_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select clinic_id from public.booking_links where id = p_link_id
$$;

-- Página pública de preparo de um exame (/preparo/[id]; o id é o do serviço).
create function public.resolve_service_clinic(p_service_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select clinic_id from public.services where id = p_service_id
$$;

revoke execute on function public.resolve_booking_link_clinic(uuid) from public, anon, authenticated, clinic_service;
revoke execute on function public.resolve_service_clinic(uuid) from public, anon, authenticated, clinic_service;
grant execute on function public.resolve_booking_link_clinic(uuid) to service_role;
grant execute on function public.resolve_service_clinic(uuid) to service_role;
