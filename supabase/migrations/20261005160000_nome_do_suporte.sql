-- F4.2 — Nome de cada pessoa do Suporte, para a tela da matriz de acesso
-- mostrar quem liberou cada item e quem fez cada mudança (D11). O Suporte vê
-- a lista (política platform_staff_select); quem grava é a plataforma.
alter table public.platform_staff
  add column display_name text not null default 'Suporte RecepClinic' check (length(trim(display_name)) > 0);
