-- Base de Conhecimento: o link do portal só com o pedido (cliente, 13/nov/2026; caso "Quanto tá a consulta", que abriu
-- o Agendar). O reconhecimento passou a exigir o pedido dito nas entradas que abrem um link (match.ts, palavras
-- inteiras): o Agendar com "marcar"/"agendar" (e "marque", "agende"…); remarcar, cancelar e confirmar com a palavra
-- deles; Minhas consultas com "minha consulta", "meu agendamento", "meu horário"…
-- Aqui, a base acompanha:
--   1. saem as palavras-chave e as frases de exemplo dessas entradas que não são pedido ("consulta", "vaga",
--      "quando", "mudar", "não vou poder ir"…): sem o pedido, nunca valeriam;
--   2. entram as formas do pedido ("marque", "agende", "desmarque"…) e frases de pedido no lugar das que saíram
--      ("marcar para amanhã");
--   3. o valor (V1) passa a entender "quanto tá a consulta" (a frase inteira: "quanto tá demorando" não é preço).
-- "Retorno" (T1) e "exame" (X1) ficam como palavra-chave: dizem o tipo, e o pedido é exigido à parte.
-- Vale para o bot depois de o Suporte publicar a base (antes de publicar o código, para o preço não cair no
-- "não entendi").
update public.kb_entries e
   set keywords = array(
         select k from unnest(e.keywords) with ordinality as x (k, n) where lower(k) <> all (r.remove) order by n
       )
  from (values
    ('M1', array['consulta', 'vaga', 'vagas', 'horário livre']),
    ('CF2', array['marcada', 'marcado', 'que dia', 'que horas', 'quando']),
    ('R1', array['mudar', 'trocar', 'adiar', 'outro dia', 'outro horário']),
    ('K1', array['desistir', 'não vou']),
    ('CF1', array['comparecer'])
  ) as r (code, remove)
 where e.code = r.code
   and e.keywords && r.remove;

update public.kb_entries e
   set keywords = e.keywords || array(
         select k from unnest(r.add) with ordinality as x (k, n) where k <> all (e.keywords) order by n
       )
  from (values
    ('M1', array['marque', 'agende', 'marco', 'agendo']),
    ('R1', array['reagendar', 'remarque']),
    ('K1', array['desmarque', 'cancele']),
    ('CF2', array['meu horário', 'meu retorno']),
    ('V1', array['quanto tá a consulta', 'quanto está a consulta', 'quanto tá o exame', 'quanto está o exame', 'quanto sai a consulta', 'quanto sai o exame'])
  ) as r (code, add)
 where e.code = r.code
   and not (e.keywords @> r.add);

delete from public.kb_synonyms s
 using public.kb_entries e, (values
    ('M1', 'primeira consulta'), ('M1', 'qual o próximo horário'), ('M1', 'quero uma consulta'), ('M1', 'tem horário'),
    ('M1', 'tem horário amanhã'), ('M1', 'tem horário na sexta'), ('M1', 'tem vaga'),
    ('T1', 'consulta de revisão'), ('T1', 'levar o exame para o médico ver'),
    ('X1', 'fazer um exame'), ('X1', 'tem horário para exame'),
    ('CF2', 'esqueci o horário'), ('CF2', 'tenho consulta marcada'),
    ('R1', 'adiar a consulta'), ('R1', 'mudar a data'), ('R1', 'mudar o dia'), ('R1', 'não vou poder ir'),
    ('R1', 'não vou poder ir nesse horário, quero outro'), ('R1', 'passar para outro dia'), ('R1', 'trocar o horário'),
    ('K1', 'desistir da consulta'), ('K1', 'não vou mais'), ('K1', 'não vou poder ir'),
    ('CF1', 'vou comparecer')
  ) as r (code, text)
 where s.entry_id = e.id
   and e.code = r.code
   and lower(s.text) = lower(r.text);

insert into public.kb_synonyms (entry_id, text)
select e.id, s.text
from (values
  ('M1', 'marcar para amanhã'), ('M1', 'marque uma consulta'), ('M1', 'agendar para amanhã'), ('M1', 'quero marcar a primeira consulta'),
  ('X1', 'quero marcar um exame'),
  ('R1', 'remarcar para outro dia'), ('R1', 'quero remarcar o horário'),
  ('K1', 'quero desmarcar a consulta'),
  ('CF2', 'que dia é meu horário'), ('CF2', 'quando é meu retorno'),
  ('V1', 'quanto tá a consulta'), ('V1', 'quanto sai a consulta')
) as s (code, text)
join public.kb_entries e on e.code = s.code
on conflict (entry_id, lower(text)) do nothing;
