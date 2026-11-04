-- Base de Conhecimento: dias da semana (homologação no staging, cliente, 04/nov/2026). "Atende na sexta?" ia para o
-- "não entendi": a F1 não tinha os dias úteis como palavra-chave, e os sinônimos da C28 só valiam para o dia escrito
-- neles. O reconhecimento agora trata os dias da semana como uma palavra só (normalize.ts), e os dias úteis entram
-- como palavra-chave da F1. Para "tem horário na sexta?" e "quero marcar para quarta" seguirem na marcação (M1, decisão
-- do cliente) e "a doutora atende na quarta?" no profissional (P2), frases com o dia nessas entradas.
-- Vale para o bot depois de o Suporte publicar a base.
update public.kb_entries
   set keywords = keywords || array(select k from unnest(array['segunda', 'terça', 'quarta', 'quinta', 'sexta']) k where k <> all (keywords))
 where code = 'F1';

insert into public.kb_synonyms (entry_id, text)
select e.id, s.text
from (values
  ('F1', 'atende na sexta'),
  ('M1', 'tem horário na sexta'), ('M1', 'quero agendar para quarta'), ('M1', 'marcar para segunda'),
  ('P2', 'a doutora atende na quarta')
) as s (code, text)
join public.kb_entries e on e.code = s.code
on conflict (entry_id, lower(text)) do nothing;
