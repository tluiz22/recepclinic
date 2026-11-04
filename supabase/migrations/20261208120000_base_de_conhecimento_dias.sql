-- Base de Conhecimento: dias de atendimento (C28, cliente, 04/nov/2026). "Vocês atendem na segunda?", "atende
-- terça?", "que dias tem atendimento" iam para Não reconhecidas; agora respondem com o horário da semana (F1).
-- Só frases: os nomes dos dias como palavra-chave tiravam perguntas de marcação ("quero agendar para quarta") e de
-- profissional ("a Dra. Ana atende na quarta?"). Vale para o bot depois de o Suporte publicar a base.
insert into public.kb_synonyms (entry_id, text)
select e.id, s.text
from public.kb_entries e
cross join lateral unnest(array[
  'vocês atendem na segunda', 'atende na terça', 'atendem na quarta-feira', 'abre na quinta', 'tem atendimento na sexta',
  'quais dias vocês atendem', 'que dias tem atendimento', 'dias de atendimento', 'atende todos os dias',
  'atende de segunda a sexta', 'funciona durante a semana', 'abre no fim de semana', 'qual dia vocês atendem',
  'segunda vocês atendem', 'atendem segunda', 'vocês funcionam na terça'
]) as s (text)
where e.code = 'F1'
on conflict (entry_id, lower(text)) do nothing;
