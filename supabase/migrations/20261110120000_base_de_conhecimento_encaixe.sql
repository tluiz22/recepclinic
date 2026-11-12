-- Base de Conhecimento: encaixe pela base (ajustes da homologação, cliente, 31/out/2026;
-- docs/arquivo/modulos/base-de-conhecimento.md). "Encaixe", "preciso de um encaixe", "consigo um encaixe" iam para Não
-- reconhecidas. Fluxo novo `waitlist` (o "Encaixe ou antecipar" do bot) e a entrada EN1, em rascunho como o
-- catálogo inicial: o Suporte ativa e publica. "encaixar" sai das palavras-chave de M1 (marcar consulta).

alter table public.kb_entries drop constraint kb_entries_flow_check;
alter table public.kb_entries add constraint kb_entries_flow_check
  check (flow in ('book_consultation', 'book_exam', 'book_return', 'reschedule', 'cancel', 'confirm', 'my_appointments', 'waitlist'));

insert into public.kb_categories (key, label, sort_order) values
  ('waitlist', 'Encaixe e lista de espera', 85);

insert into public.kb_entries (code, category_key, question, keywords, guidance, answer_type, template, sources, flow, required_term, offers_reception) values
  ('EN1', 'waitlist', 'Preciso de um encaixe',
    '{encaixe,encaixar,encaixa,adiantar,antecipar,antecipação,mais cedo,lista de espera,fila de espera,desistência}',
    'Abre o "Encaixe ou antecipar" (Consultas ou Exames, pela mensagem). Clínica sem o item Lista de espera: explica que o encaixe é com a recepção e pergunta se quer falar com ela.',
    'flow', null, '{}', 'waitlist', null, false);

insert into public.kb_synonyms (entry_id, text)
select e.id, s.text
from public.kb_entries e
cross join lateral unnest(array[
  'consigo um encaixe', 'tem encaixe', 'tem como encaixar', 'quero adiantar minha consulta', 'antecipar a consulta',
  'antecipar o exame', 'tem horário mais cedo', 'quero entrar na lista de espera', 'entrar na fila de espera',
  'se alguém desistir me avisa', 'tem desistência'
]) as s (text)
where e.code = 'EN1';

update public.kb_entries set keywords = array_remove(keywords, 'encaixar') where code = 'M1' and 'encaixar' = any (keywords);
