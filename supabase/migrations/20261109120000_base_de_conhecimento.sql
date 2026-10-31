-- BC 3.1 — Base de Conhecimento Global do bot (cliente, 31/out/2026;
-- docs/base-de-conhecimento.md).
--
-- Base única, mantida pelo Suporte RecepClinic e compartilhada por todas as
-- clínicas. Não guarda dado de clínica: cada entrada diz como reconhecer a
-- pergunta e de quais fontes (lista fechada, no código) sai a resposta.
--   1. conteúdo em edição (categorias, entradas, sinônimos, dicionário de
--      especialidades, termos do filtro clínico): só o Suporte lê e grava;
--   2. histórico de alterações (kb_revisions), por gatilho;
--   3. publicação: "Publicar" grava uma fotografia das entradas ativas
--      (kb_publications); o bot só lê a última publicação, nunca o rascunho;
--   4. perguntas não reconhecidas (decisão 4): só o texto, a clínica e a data,
--      sem telefone; apagadas depois de 90 dias;
--   5. item da matriz "Perguntas frequentes no bot" (decisão 5);
--   6. catálogo inicial aprovado (docs/base-de-conhecimento-catalogo.md), todo
--      como rascunho e sem publicação: o bot não responde nada até o Suporte
--      ativar e publicar.

create type public.kb_status as enum ('draft', 'approved', 'active', 'inactive');
create type public.kb_answer_type as enum ('template', 'source', 'flow', 'fixed', 'reception');

-- ---------------------------------------------------------------------------
-- Conteúdo em edição
-- ---------------------------------------------------------------------------
create table public.kb_categories (
  key text primary key check (key ~ '^[a-z_]+$'),
  label text not null check (length(trim(label)) > 0),
  sort_order integer not null unique
);

create table public.kb_entries (
  id uuid primary key default gen_random_uuid(),
  -- Código do catálogo (F1, S2, CF1…).
  code text not null unique check (code ~ '^[A-Z]{1,2}[0-9]{1,2}$'),
  category_key text not null references public.kb_categories (key),
  question text not null check (length(trim(question)) > 0),
  -- Pelo menos uma precisa estar na mensagem.
  keywords text[] not null default '{}',
  -- Para o Suporte: como responder e quando encaminhar. Nunca vai ao paciente.
  guidance text not null default '',
  answer_type public.kb_answer_type not null,
  -- Texto com {variáveis} (modelo), texto fixo, ou a pergunta da recepção.
  template text,
  -- Fontes da clínica (lista do código: src/lib/knowledge.ts; um teste confere).
  sources text[] not null default '{}',
  flow text,
  -- A entrada só vale com um termo da clínica na mensagem (nome de serviço,
  -- de profissional, especialidade do dicionário).
  required_term text,
  -- Depois da resposta, "Você quer falar com a recepção?" (com a recepção no app).
  offers_reception boolean not null default false,
  status public.kb_status not null default 'draft',
  version integer not null default 1,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((answer_type in ('template', 'fixed', 'reception')) = (template is not null and length(trim(template)) > 0)),
  check ((answer_type = 'flow') = (flow is not null)),
  check (answer_type <> 'source' or cardinality(sources) > 0),
  check (sources <@ array[
    'clinic', 'reception_hours', 'holiday_today', 'addresses', 'website', 'services', 'professionals',
    'council_registration', 'prices', 'payment', 'insurance', 'return_visit', 'preparation', 'home_visit',
    'age_profile', 'reminder'
  ]),
  check (flow in ('book_consultation', 'book_exam', 'book_return', 'reschedule', 'cancel', 'confirm', 'my_appointments')),
  check (required_term in ('service', 'professional', 'specialty'))
);

create index kb_entries_category_idx on public.kb_entries (category_key);

create table public.kb_synonyms (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.kb_entries (id) on delete cascade,
  text text not null check (length(trim(text)) > 0 and length(text) <= 200),
  created_at timestamptz not null default now()
);

create unique index kb_synonyms_entry_text_idx on public.kb_synonyms (entry_id, lower(text));

-- Dicionário de especialidades (decisão 11): nome canônico → como o paciente fala.
create table public.kb_specialties (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  terms text[] not null default '{}',
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create unique index kb_specialties_name_idx on public.kb_specialties (lower(name));

-- Filtro clínico (decisão 9): termos que levam ao aviso; "exception" não aciona.
create table public.kb_clinical_terms (
  id uuid primary key default gen_random_uuid(),
  term_group text not null check (term_group in ('symptom', 'medicine', 'result', 'exception')),
  term text not null check (length(trim(term)) > 0),
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create unique index kb_clinical_terms_term_idx on public.kb_clinical_terms (lower(term));

create trigger kb_entries_set_updated_at
  before update on public.kb_entries
  for each row execute function app.set_updated_at();

create trigger kb_specialties_set_updated_at
  before update on public.kb_specialties
  for each row execute function app.set_updated_at();

create trigger kb_clinical_terms_set_updated_at
  before update on public.kb_clinical_terms
  for each row execute function app.set_updated_at();

-- Versão e autor da entrada a cada alteração.
create function app.kb_entry_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
  end if;
  return new;
end
$$;

create trigger kb_entries_stamp
  before insert or update on public.kb_entries
  for each row execute function app.kb_entry_stamp();

-- ---------------------------------------------------------------------------
-- Histórico de alterações
-- ---------------------------------------------------------------------------
create table public.kb_revisions (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid,
  table_name text not null,
  record_id uuid not null,
  -- Entrada a que a linha pertence (sinônimos: a entrada deles).
  entry_id uuid,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  old_row jsonb,
  new_row jsonb
);

create index kb_revisions_entry_idx on public.kb_revisions (entry_id, occurred_at desc);
create index kb_revisions_occurred_idx on public.kb_revisions (occurred_at desc);

create function app.kb_record_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.kb_revisions (actor_user_id, table_name, record_id, entry_id, operation, old_row, new_row)
  values (
    (select auth.uid()),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    case tg_table_name
      when 'kb_entries' then (v_row ->> 'id')::uuid
      when 'kb_synonyms' then (v_row ->> 'entry_id')::uuid
    end,
    tg_op,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return null;
end
$$;

create trigger kb_entries_revision after insert or update or delete on public.kb_entries
  for each row execute function app.kb_record_revision();
create trigger kb_synonyms_revision after insert or update or delete on public.kb_synonyms
  for each row execute function app.kb_record_revision();
create trigger kb_specialties_revision after insert or update or delete on public.kb_specialties
  for each row execute function app.kb_record_revision();
create trigger kb_clinical_terms_revision after insert or update or delete on public.kb_clinical_terms
  for each row execute function app.kb_record_revision();

-- ---------------------------------------------------------------------------
-- Publicação
-- ---------------------------------------------------------------------------
create table public.kb_publications (
  version integer primary key check (version > 0),
  published_at timestamptz not null default now(),
  published_by uuid references auth.users (id) on delete set null,
  -- Fotografia: entradas ativas (com sinônimos), especialidades e termos ativos.
  content jsonb not null
);

create function public.publish_knowledge_base()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
begin
  if not (app.is_platform_staff() or (select auth.role()) = 'service_role') then
    raise exception 'Só o Suporte RecepClinic publica a base de conhecimento.' using errcode = '42501';
  end if;
  lock table public.kb_publications in exclusive mode;
  select coalesce(max(version), 0) + 1 into v_version from public.kb_publications;
  insert into public.kb_publications (version, published_by, content)
  values (
    v_version,
    (select auth.uid()),
    jsonb_build_object(
      'entries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', e.code,
          'category', e.category_key,
          'question', e.question,
          'keywords', to_jsonb(e.keywords),
          'answerType', e.answer_type,
          'template', e.template,
          'sources', to_jsonb(e.sources),
          'flow', e.flow,
          'requiredTerm', e.required_term,
          'offersReception', e.offers_reception,
          'synonyms', coalesce((select jsonb_agg(s.text order by s.text) from public.kb_synonyms s where s.entry_id = e.id), '[]'::jsonb)
        ) order by e.code)
        from public.kb_entries e
        where e.status = 'active'
      ), '[]'::jsonb),
      'specialties', coalesce((
        select jsonb_agg(jsonb_build_object('name', s.name, 'terms', to_jsonb(s.terms)) order by s.name)
        from public.kb_specialties s
        where s.is_active
      ), '[]'::jsonb),
      'clinicalTerms', coalesce((
        select jsonb_agg(jsonb_build_object('group', t.term_group, 'term', t.term) order by t.term_group, t.term)
        from public.kb_clinical_terms t
        where t.is_active
      ), '[]'::jsonb)
    )
  );
  return v_version;
end
$$;

revoke execute on function public.publish_knowledge_base() from public, anon, clinic_service;
grant execute on function public.publish_knowledge_base() to authenticated;

-- ---------------------------------------------------------------------------
-- Perguntas não reconhecidas (decisão 4)
-- ---------------------------------------------------------------------------
create table public.kb_unmatched (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  text text not null check (length(trim(text)) > 0 and length(text) <= 500),
  -- Passo da conversa em que chegou (MENU, BOOKING_…); sem telefone nem paciente.
  conversation_state text,
  occurred_at timestamptz not null default now()
);

create index kb_unmatched_occurred_idx on public.kb_unmatched (occurred_at desc);
create index kb_unmatched_clinic_idx on public.kb_unmatched (clinic_id, occurred_at desc);

select cron.schedule('limpar-perguntas-nao-reconhecidas', '25 3 * * *', $$ delete from public.kb_unmatched where occurred_at < now() - interval '90 days' $$);

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
alter table public.kb_categories enable row level security;
alter table public.kb_entries enable row level security;
alter table public.kb_synonyms enable row level security;
alter table public.kb_specialties enable row level security;
alter table public.kb_clinical_terms enable row level security;
alter table public.kb_revisions enable row level security;
alter table public.kb_publications enable row level security;
alter table public.kb_unmatched enable row level security;

-- Conteúdo em edição: só o Suporte (clínica e bot não veem rascunho).
create policy kb_categories_staff on public.kb_categories for all to authenticated
  using (app.is_platform_staff()) with check (app.is_platform_staff());
create policy kb_entries_staff on public.kb_entries for all to authenticated
  using (app.is_platform_staff()) with check (app.is_platform_staff());
create policy kb_synonyms_staff on public.kb_synonyms for all to authenticated
  using (app.is_platform_staff()) with check (app.is_platform_staff());
create policy kb_specialties_staff on public.kb_specialties for all to authenticated
  using (app.is_platform_staff()) with check (app.is_platform_staff());
create policy kb_clinical_terms_staff on public.kb_clinical_terms for all to authenticated
  using (app.is_platform_staff()) with check (app.is_platform_staff());

-- Histórico: o Suporte lê; só o gatilho grava.
create policy kb_revisions_staff on public.kb_revisions for select to authenticated using (app.is_platform_staff());
revoke insert, update, delete on public.kb_revisions from anon, authenticated, clinic_service;

-- Publicação: o bot (credencial da clínica) e o Suporte leem; só a função grava.
create policy kb_publications_service on public.kb_publications for select to clinic_service using (true);
create policy kb_publications_staff on public.kb_publications for select to authenticated using (app.is_platform_staff());
revoke insert, update, delete on public.kb_publications from anon, authenticated, clinic_service;

-- Não reconhecidas: o bot grava só na própria clínica e não lê; o Suporte lê.
create policy kb_unmatched_service on public.kb_unmatched for insert to clinic_service
  with check (clinic_id = app.service_clinic_id());
create policy kb_unmatched_staff on public.kb_unmatched for select to authenticated using (app.is_platform_staff());
revoke update, delete on public.kb_unmatched from anon, authenticated, clinic_service;
revoke select on public.kb_unmatched from clinic_service;

revoke all on public.kb_categories, public.kb_entries, public.kb_synonyms, public.kb_specialties,
  public.kb_clinical_terms, public.kb_revisions, public.kb_publications, public.kb_unmatched from anon;
revoke all on public.kb_categories, public.kb_entries, public.kb_synonyms, public.kb_specialties,
  public.kb_clinical_terms, public.kb_revisions from clinic_service;
revoke truncate on public.kb_categories, public.kb_entries, public.kb_synonyms, public.kb_specialties,
  public.kb_clinical_terms, public.kb_revisions, public.kb_publications, public.kb_unmatched from authenticated;

revoke execute on function app.kb_entry_stamp() from public, anon, authenticated, clinic_service;
revoke execute on function app.kb_record_revision() from public, anon, authenticated, clinic_service;

-- ---------------------------------------------------------------------------
-- Item da matriz (decisão 5)
-- ---------------------------------------------------------------------------
insert into public.features (key, area, label, depends_on, sort_order) values
  ('knowledge_base', 'whatsapp', 'Perguntas frequentes no bot', '{whatsapp_bot}', 75);

-- ---------------------------------------------------------------------------
-- Catálogo inicial (aprovado pelo cliente em 31/out/2026), todo em rascunho
-- ---------------------------------------------------------------------------
insert into public.kb_categories (key, label, sort_order) values
  ('hours',        'Funcionamento e horários',      10),
  ('location',     'Endereço e localização',        20),
  ('services',     'Serviços e especialidades',     30),
  ('professionals','Profissionais',                 40),
  ('prices',       'Valores e formas de pagamento', 50),
  ('insurance',    'Convênios',                     60),
  ('booking',      'Marcação de consultas',         70),
  ('exams',        'Marcação de exames',            80),
  ('reschedule',   'Remarcação',                    90),
  ('cancel',       'Cancelamento',                  100),
  ('return_visit', 'Consulta de retorno',           110),
  ('preparation',  'Preparação para exames',        120),
  ('home_visit',   'Atendimento domiciliar',        130),
  ('children',     'Crianças e adolescentes',       140),
  ('confirmation', 'Confirmação de consultas',      160),
  ('reminders',    'Lembretes',                     170),
  ('reception',    'Atendimento humano',            180),
  ('general',      'Dúvidas gerais',                190);

insert into public.kb_entries (code, category_key, question, keywords, guidance, answer_type, template, sources, flow, required_term, offers_reception) values
  ('F1', 'hours', 'Qual o horário de funcionamento?',
    '{horário,hora,horas,abre,abrem,fecha,fecham,funciona,funcionamento,aberto,sábado,domingo,feriado}',
    'Horário da recepção (decisão 7); sem horário salvo, o sugerido pelas agendas. Se hoje é feriado da clínica, avisa. Sem horário: não responde.',
    'template', E'Nosso horário de atendimento:\n{horario_semana}{aviso_feriado}', '{reception_hours,holiday_today}', null, null, false),
  ('E1', 'location', 'Qual o endereço da clínica?',
    '{endereço,onde,localização,local,chego,chegar,rua,bairro,fica}',
    'Locais do tipo clínica, ativos, com endereço; link do mapa gerado do endereço. Vários locais: um bloco por local. Sem endereço: não responde.',
    'source', null, '{addresses}', null, null, false),
  ('E2', 'location', 'Vocês têm site?',
    '{site,página,internet}',
    'Site cadastrado na marca da clínica. Sem site: não responde.',
    'template', 'Nosso site: {site}', '{website}', null, null, false),
  ('S1', 'services', 'Quais serviços vocês oferecem?',
    '{serviços,consultas,exames,procedimentos,tratamentos,atendimentos,fazem,oferecem}',
    'Só serviços com agenda e horário (catálogo do bot); consultas e exames separados.',
    'source', null, '{services}', null, null, false),
  ('S2', 'services', 'Vocês fazem {serviço}?',
    '{fazem,tem,atendem,realizam}',
    'Vale só com o nome de um serviço da clínica na mensagem. Achou: sim + Marcar. Não achou: como S1 (nunca "não fazemos").',
    'source', null, '{services}', null, 'service', false),
  ('S3', 'services', 'Quais especialidades vocês têm?',
    '{especialidade,especialidades,especialista,especialistas}',
    'Especialidade de cada profissional com agenda (sem especialidade: a profissão).',
    'source', null, '{professionals}', null, null, false),
  ('S4', 'services', 'Vocês têm {especialidade}?',
    '{tem,atende,atendem}',
    'Vale só com um termo do dicionário de especialidades. Achou: profissional + Marcar consulta. Não achou: as especialidades da clínica (nunca "não temos", decisão 11).',
    'source', null, '{professionals}', null, 'specialty', false),
  ('P1', 'professionals', 'Quais profissionais atendem?',
    '{profissionais,profissional,médico,médicos,médica,médicas,dentista,dentistas,doutor,doutora,dr,dra,quem atende}',
    'Mesma lista de S3, por profissional.',
    'source', null, '{professionals}', null, null, false),
  ('P2', 'professionals', 'O(a) {profissional} atende aí?',
    '{atende,atendem,especialidade}',
    'Vale só com o nome de um profissional da clínica. Profissão e especialidade, sem o registro no conselho (Q2). Dia e horário: pelo link de marcar.',
    'source', null, '{professionals}', null, 'professional', false),
  ('P3', 'professionals', 'Qual o CRM do(a) {profissional}?',
    '{crm,cro,crp,crefito,crn,rqe,registro,conselho}',
    'Conselho, número, UF e RQE. Sem profissional citado: o único da clínica ou um por linha. Sem registro: não responde.',
    'source', null, '{council_registration}', null, null, false),
  ('V1', 'prices', 'Quanto custa a consulta?',
    '{valor,valores,preço,preços,custa,custo,quanto é,quanto fica,cobra,cobram,particular}',
    'Decisão 10: genérica = lista de Informações › Valores; serviço ou profissional citado = só aquele serviço; na marcação com serviço escolhido = o valor dele. Preço zero: "Sem custo". Valor pelo convênio: não responde.',
    'source', null, '{prices,payment}', null, null, false),
  ('V2', 'prices', 'Quais as formas de pagamento?',
    '{pagamento,pagar,cartão,crédito,débito,pix,dinheiro,parcela,parcelar,parcelado,à vista}',
    'Texto da clínica; não responde sim/não a "aceita pix?". Sem texto: não responde.',
    'template', 'Formas de pagamento: {pagamento}', '{payment}', null, null, false),
  ('C1', 'insurance', 'Quais convênios vocês aceitam?',
    '{convênio,convênios,plano,planos,plano de saúde}',
    'Decisão 6 e Q3: cadastro de convênios (nomes alternativos, só ativos, exceções por profissional); sem cadastro, o texto das Informações. Plano não encontrado: "Não encontrei … entre os convênios que atendemos: …". Também casa com o nome de um plano da clínica.',
    'source', null, '{insurance}', null, null, false),
  ('M1', 'booking', 'Quero marcar uma consulta',
    '{marcar,agendar,agendamento,consulta,vaga,vagas,horário livre,encaixar}',
    'Abre Marcar consulta (com serviço citado, já escolhido). Já marcando: repete o passo. Sintoma junto: abre a marcação sem orientar (Q1).',
    'flow', null, '{}', 'book_consultation', null, false),
  ('X1', 'exams', 'Quero marcar um exame',
    '{exame,exames,procedimento,procedimentos}',
    'Abre Marcar exame. Item Exames desligado ou sem exame: não responde.',
    'flow', null, '{}', 'book_exam', null, false),
  ('X2', 'exams', 'O resultado do meu exame já saiu?',
    '{resultado,resultados,laudo,pronto,pronta,entrega}',
    'Administrativo, sem dado no sistema (Q5): oferece a recepção, sem o aviso de saúde. Interpretação de resultado vai para o filtro clínico.',
    'reception', 'Sobre resultados de exames, a recepção pode te ajudar. Você quer falar com a recepção?', '{}', null, null, false),
  ('R1', 'reschedule', 'Quero remarcar',
    '{remarcar,remarcação,mudar,trocar,adiar,outro dia,outro horário}',
    'Abre Remarcar (data de nascimento → atendimento → link). Nunca pede a data digitada.',
    'flow', null, '{}', 'reschedule', null, false),
  ('K1', 'cancel', 'Quero cancelar',
    '{cancelar,cancelamento,desmarcar,desistir,não vou}',
    'Abre Cancelar. "Não vou poder ir" sozinho é ambíguo com R1: "Você quis dizer…?".',
    'flow', null, '{}', 'cancel', null, false),
  ('T1', 'return_visit', 'Quero marcar retorno',
    '{retorno,revisão,volta}',
    'Abre Marcar retorno. Sem serviço de retorno: não responde.',
    'flow', null, '{}', 'book_return', null, false),
  ('T2', 'return_visit', 'Qual o prazo do retorno? O retorno é pago?',
    '{prazo,dias,até quando,pago,paga,custo,grátis,gratuito,valor}',
    'Prazo do retorno e valor do serviço de retorno (cada parte só se cadastrada). Sem os dois: não responde.',
    'source', null, '{return_visit}', null, null, false),
  ('PR1', 'preparation', 'Qual o preparo do exame?',
    '{preparo,preparação,jejum,preparar,antes do exame}',
    'Exame citado: o preparo dele (arquivo ou texto). Sem exame citado: a lista de exames com preparo. "Jejum" não aciona o filtro clínico.',
    'source', null, '{preparation}', null, null, false),
  ('D1', 'home_visit', 'Vocês atendem em casa?',
    '{domiciliar,domicílio,em casa,minha casa,visita}',
    'Com domiciliar: serviços, valores e Marcar. Sem domiciliar: "No momento não fazemos atendimento domiciliar." (Q4).',
    'source', null, '{home_visit}', null, null, false),
  ('I1', 'children', 'Vocês atendem crianças?',
    '{criança,crianças,bebê,bebês,recém-nascido,adolescente,adolescentes,idade,adulto,adultos,infantil}',
    'Perfil da clínica e idade limite. Clínica de adultos e pergunta sobre criança: não responde (não há idade mínima).',
    'source', null, '{age_profile}', null, null, false),
  ('CF1', 'confirmation', 'Quero confirmar minha consulta',
    '{confirmar,confirmo,confirmação,comparecer}',
    'Abre Confirmar (o da entrada: data de nascimento → atendimento). "Sim" ou "vou" sozinhos nunca vêm para cá.',
    'flow', null, '{}', 'confirm', null, false),
  ('CF2', 'confirmation', 'Minha consulta está marcada? Para quando é?',
    '{minha consulta,meu exame,meu agendamento,marcada,marcado,que dia,que horas,quando}',
    'Abre os atendimentos do contato (data de nascimento antes de qualquer detalhe). A base não lê agendamentos.',
    'flow', null, '{}', 'my_appointments', null, false),
  ('L1', 'reminders', 'Vou receber lembrete?',
    '{lembrete,lembretes,lembrar,avisam,aviso}',
    'Com o item Lembrete automático e o lembrete ligado: véspera ou no dia, e a hora. Desligado: não responde.',
    'template', 'Sim! Enviamos um lembrete por aqui {quando_lembrete}, com os botões para confirmar, remarcar ou cancelar.', '{reminder}', null, null, false),
  ('H1', 'reception', 'Quero falar com o médico',
    '{médico,médica,doutor,doutora,dentista,profissional}',
    'Quem responde é a recepção: pergunta Sim/Não. Sem recepção no app: "{designação} responderá sua mensagem em breve." e o menu.',
    'reception', 'Quem responde por aqui é a recepção. Você quer falar com a recepção?', '{}', null, null, false),
  ('H2', 'reception', 'Qual o telefone da clínica?',
    '{telefone,ligar,ligação,número,fixo}',
    'Não há telefone no cadastro: o WhatsApp é o canal. Com recepção no app, oferece a recepção.',
    'template', 'Este WhatsApp é o canal de atendimento {da_clinica}. Pode falar por aqui mesmo.', '{clinic}', null, null, true),
  ('G1', 'general', 'Obrigado',
    '{obrigado,obrigada,obg,valeu,brigado,brigada,tchau,até logo}',
    'Não repete o menu nem conta como "não entendi". Num passo que espera resposta, repete o passo.',
    'fixed', 'Por nada! Se precisar, é só mandar mensagem por aqui.', '{}', null, null, false),
  ('G2', 'general', 'Oi',
    '{oi,olá,ola,bom dia,boa tarde,boa noite}',
    'Repete o passo. Na 1ª mensagem, as boas-vindas de hoje (a base não entra).',
    'fixed', 'Olá!', '{}', null, null, false),
  ('G3', 'general', 'É um robô?',
    '{robô,robo,automático,automatico,alguém aí,pessoa}',
    'Sem recepção no app: sem a dica de escrever "atendente".',
    'template', 'Sou o atendimento automático {da_clinica}.{dica_recepcao}', '{clinic}', null, null, false);

-- Sinônimos (as perguntas parecidas que o paciente escreve).
insert into public.kb_synonyms (entry_id, text)
select e.id, s.text
from public.kb_entries e
join (values
  ('F1', array['que horas vocês abrem', 'que horas fecha', 'até que horas funciona', 'qual o horário de atendimento', 'vocês abrem sábado', 'atendem aos sábados', 'atende domingo', 'funciona hoje', 'está aberto agora', 'abre feriado', 'horário da clínica', 'que horas começa o atendimento']),
  ('E1', array['onde fica', 'onde vocês ficam', 'qual a localização', 'manda a localização', 'como chego aí', 'fica em qual bairro', 'endereço do consultório', 'qual a rua', 'ponto de referência']),
  ('E2', array['qual o site', 'tem página na internet', 'endereço do site']),
  ('S1', array['o que vocês fazem', 'quais consultas vocês têm', 'quais exames vocês fazem', 'quais procedimentos', 'que tipo de atendimento tem', 'quais tratamentos']),
  ('S2', array['vocês fazem', 'tem consulta de', 'vocês atendem', 'fazem exame de', 'realizam']),
  ('S3', array['quais especialidades', 'quais especialistas', 'que tipo de médico tem', 'que tipo de dentista tem']),
  ('S4', array['tem pediatra', 'tem médico de pulmão', 'tem dentista de criança', 'atende a especialidade', 'tem algum especialista']),
  ('P1', array['quem atende', 'quais médicos', 'quais dentistas', 'qual o nome do médico', 'quem são os profissionais', 'quem é a doutora']),
  ('P2', array['a doutora atende', 'o doutor ainda atende', 'qual a especialidade do doutor', 'atende em qual dia']),
  ('P3', array['qual o registro do doutor', 'crm da doutora', 'cro do dentista', 'o médico tem rqe', 'número do conselho']),
  ('V1', array['qual o valor', 'quanto é', 'qual o preço', 'valor da consulta', 'quanto custa o exame', 'quanto fica', 'valor particular', 'preço do atendimento', 'quanto custa com o doutor']),
  ('V2', array['aceita cartão', 'aceita pix', 'pode parcelar', 'aceita débito', 'aceita dinheiro', 'como posso pagar', 'paga na hora', 'tem desconto à vista']),
  ('C1', array['atendem unimed', 'aceitam plano de saúde', 'trabalham com convênio', 'meu plano é aceito', 'atende pelo plano', 'aceita hapvida', 'atende particular e convênio', 'o doutor atende meu plano']),
  ('M1', array['agendar consulta', 'marcar horário', 'quero uma consulta', 'tem vaga', 'tem horário', 'tem horário amanhã', 'qual o próximo horário', 'primeira consulta', 'marcar para meu filho', 'marcar para outra pessoa', 'como faço para marcar', 'como funciona o agendamento']),
  ('X1', array['agendar exame', 'fazer um exame', 'marcar procedimento', 'tem horário para exame']),
  ('X2', array['meu exame ficou pronto', 'quando sai o resultado', 'como pego o resultado', 'buscar resultado', 'entrega do exame', 'laudo pronto']),
  ('R1', array['mudar a data', 'trocar o horário', 'adiar a consulta', 'mudar o dia', 'passar para outro dia', 'como faço para remarcar', 'não vou poder ir nesse horário, quero outro']),
  ('K1', array['desmarcar', 'cancelar consulta', 'cancelar exame', 'não vou mais', 'não vou poder ir', 'desistir da consulta']),
  ('T1', array['agendar retorno', 'marcar a volta', 'levar o exame para o médico ver', 'consulta de revisão']),
  ('T2', array['até quando posso voltar', 'quantos dias tenho para o retorno', 'retorno tem custo', 'retorno é gratuito', 'preciso pagar o retorno']),
  ('PR1', array['precisa de jejum', 'como me preparar para o exame', 'o que fazer antes do exame', 'tem preparo', 'quantas horas de jejum', 'posso comer antes do exame']),
  ('D1', array['atendimento domiciliar', 'visita em casa', 'vem até minha casa', 'atende a domicílio', 'consulta em casa']),
  ('I1', array['atende bebê', 'atende recém-nascido', 'atende adolescente', 'qual a idade que vocês atendem', 'até que idade', 'atende adulto']),
  ('CF1', array['confirmar presença', 'confirmo a consulta', 'vou comparecer', 'quero confirmar o horário']),
  ('CF2', array['que dia é minha consulta', 'que horas é minha consulta', 'tenho consulta marcada', 'quero ver meu agendamento', 'esqueci o horário']),
  ('L1', array['quando chega o lembrete', 'vocês avisam antes', 'mandam mensagem antes da consulta', 'como recebo o lembrete']),
  ('H1', array['falar com a doutora', 'falar com o dentista', 'mandar mensagem para o médico', 'o médico pode me responder']),
  ('H2', array['posso ligar', 'tem outro número', 'qual o número para ligar', 'tem telefone fixo']),
  ('G1', array['obrigada', 'obg', 'valeu', 'brigado', 'ok obrigado', 'tchau', 'até logo', 'só isso']),
  ('G2', array['olá', 'bom dia', 'boa tarde', 'boa noite', 'oi tudo bem']),
  ('G3', array['estou falando com robô', 'é automático', 'tem alguém aí', 'é uma pessoa'])
) as v (code, texts) on v.code = e.code
cross join lateral unnest(v.texts) as s (text);

insert into public.kb_specialties (name, terms) values
  ('Pediatria', '{pediatra,médico de criança,médico infantil}'),
  ('Clínica médica', '{clínico geral,médico geral,clínico}'),
  ('Cardiologia', '{cardiologista,cardio,médico do coração}'),
  ('Pneumologia', '{pneumologista,pneumo,médico do pulmão,respiração}'),
  ('Pneumologia pediátrica', '{pneumopediatra,pneumo infantil,médico do pulmão de criança}'),
  ('Dermatologia', '{dermatologista,dermato,médico de pele}'),
  ('Ginecologia e obstetrícia', '{ginecologista,gineco,GO,obstetra,pré-natal}'),
  ('Ortopedia', '{ortopedista,médico de osso,coluna,joelho}'),
  ('Otorrinolaringologia', '{otorrino,médico de ouvido,nariz e garganta}'),
  ('Oftalmologia', '{oftalmologista,oftalmo,oculista,médico de olho,vista}'),
  ('Neurologia', '{neurologista,neuro}'),
  ('Neuropediatria', '{neuropediatra,neuro infantil}'),
  ('Psiquiatria', '{psiquiatra}'),
  ('Endocrinologia', '{endocrinologista,endócrino,endocrino,tireoide}'),
  ('Gastroenterologia', '{gastroenterologista,gastro,médico do estômago}'),
  ('Urologia', '{urologista,uro}'),
  ('Nefrologia', '{nefrologista,médico do rim}'),
  ('Alergia e imunologia', '{alergista,imunologista}'),
  ('Reumatologia', '{reumatologista,reumato}'),
  ('Geriatria', '{geriatra,médico de idoso}'),
  ('Hebiatria', '{hebiatra,médico de adolescente}'),
  ('Odontologia (clínica geral)', '{dentista,clínico geral dentista}'),
  ('Odontopediatria', '{odontopediatra,dentista de criança,dentista infantil}'),
  ('Ortodontia', '{ortodontista,aparelho,aparelho nos dentes}'),
  ('Endodontia', '{endodontista,canal,tratamento de canal}'),
  ('Periodontia', '{periodontista,gengiva}'),
  ('Implantodontia', '{implante,implante dentário}'),
  ('Prótese dentária', '{prótese,dentadura}'),
  ('Cirurgia bucomaxilofacial', '{bucomaxilo,siso,tirar o siso}'),
  ('Psicologia', '{psicólogo,psicóloga,terapia,terapeuta}'),
  ('Fisioterapia', '{fisioterapeuta,fisio}'),
  ('Fonoaudiologia', '{fonoaudiólogo,fonoaudióloga,fono}'),
  ('Nutrição', '{nutricionista,nutri,dieta}'),
  ('Terapia ocupacional', '{terapeuta ocupacional,TO}');

insert into public.kb_clinical_terms (term_group, term)
select g, unnest(terms)
from (values
  ('symptom', array['dor', 'febre', 'tosse', 'sangramento', 'sangrando', 'vômito', 'diarreia', 'falta de ar', 'cansaço', 'alergia', 'coceira', 'mancha', 'inchaço', 'inchado', 'convulsão', 'desmaio', 'machucou', 'caiu', 'bateu a cabeça']),
  ('medicine', array['remédio', 'medicamento', 'dose', 'dosagem', 'posso tomar', 'posso dar', 'antibiótico', 'gotas', 'mg', 'xarope', 'pomada', 'reação da vacina']),
  ('result', array['meu exame deu', 'o resultado deu', 'está normal', 'é normal', 'é grave', 'o que pode ser', 'o que eu tenho', 'interpretar', 'valor de referência']),
  ('exception', array['jejum', 'preparo', 'consulta de alergia', 'resultado saiu', 'ficou pronto'])
) as v (g, terms);
