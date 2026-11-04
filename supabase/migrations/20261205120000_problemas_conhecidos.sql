-- IS5 Problemas conhecidos (cliente, 03/nov/2026; docs/implantacao-segura.md):
-- registro do Suporte com o que já aconteceu e como resolver (sintoma, causa,
-- solução e links), em Sistema › Problemas conhecidos. Da plataforma (sem
-- clinic_id): só o Suporte lê e grava. Os primeiros registros são os casos de
-- 03/nov/2026 na clínica piloto.
--
-- Reversão: drop table public.known_issues.

create table public.known_issues (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 3 and 200),
  symptom text not null check (char_length(trim(symptom)) > 0),
  cause text not null default '',
  solution text not null check (char_length(trim(solution)) > 0),
  -- Um link por linha: "Rótulo | https://…" ou só o endereço.
  links text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

comment on table public.known_issues is 'IS5: problemas conhecidos (sintoma, causa, solução e links), só do Suporte.';

alter table public.known_issues enable row level security;

create policy known_issues_staff on public.known_issues
  for all to authenticated using (app.is_platform_staff()) with check (app.is_platform_staff());

revoke all on public.known_issues from anon;
revoke truncate on public.known_issues from authenticated;

insert into public.known_issues (title, symptom, cause, solution, links) values
(
  'Implantação: o que a clínica prepara antes de conectar o WhatsApp',
  'Clínica nova vai conectar o WhatsApp ao RecepClinic.',
  'Sem os pré-requisitos (login do Facebook, WhatsApp Business, mensagens automáticas desligadas, cartão na Meta), a conexão para no meio ou os envios falham depois.',
  'Enviar ao Administrador o guia "Antes de conectar" (Sistema › Clínicas › clínica › Guia para o Administrador) e seguir a checklist de implantação na Situação da clínica antes de ativar.',
  'Guia antes de conectar | /guia/antes-de-conectar'
),
(
  'Lembretes e avisos não chegam: erro 131042 (pagamento na Meta)',
  'O paciente não recebe lembrete, confirmação ou aviso de remarcação; nos envios, "Não entregue" com o código 131042 ("Business eligibility payment issue"). O bot responde normalmente quem escreve.',
  'A conta do WhatsApp da clínica na Meta está sem forma de pagamento padrão, ou o cartão foi recusado. A Meta cobra da clínica cada mensagem que ela inicia. Caso da clínica piloto em 03/11/2026: o cartão só passou a valer depois de cadastrado de novo pelo Administrador.',
  'O Administrador da clínica cadastra o cartão de crédito (habilitado para compras internacionais) no Gerenciador do WhatsApp e o define como principal. Se não conseguir definir como padrão: linha de crédito de fornecedor antigo, saldo em aberto ou chamado no Suporte ao negócio da Meta (a Meta não atende por e-mail). Conferir com a Mensagem de teste em Configurações › WhatsApp.',
  'Guia do pagamento na Meta (com a mensagem para o suporte da Meta) | /guia/pagamento-meta'
),
(
  'O bot para depois do menu e a conversa fica "Aguardando a clínica"',
  'O paciente escolhe uma opção (ex.: Consultas) e o bot não responde; em Atendimento humano, a conversa aparece com o motivo "A clínica respondeu pelo app", mas ninguém respondeu.',
  'Mensagem automática do app WhatsApp Business (saudação ou ausência) saiu segundos depois do "oi". Toda mensagem pelo app pausava o bot. A ausência costuma disparar só no horário comercial, então pode não aparecer em teste à noite (clínica piloto, 03/11/2026). Desde a IS4, a mensagem automática não pausa mais o bot e gera um aviso.',
  'No celular da clínica: WhatsApp Business › Ferramentas comerciais › desligar Mensagem de saudação e Mensagem de ausência; no Meta Business Suite, desligar as automações. As conversas que ficaram presas voltam com "#bot" pelo app ou "Devolver ao bot".',
  'Guia: desligar as mensagens automáticas | /guia/antes-de-conectar#mensagens-automaticas'
),
(
  'O bot não responde no teste',
  'Alguém da equipe ou do Suporte manda "oi" para o número da clínica e o bot não responde; a mensagem aparece no histórico.',
  'O número usado no teste é o WhatsApp do Suporte do RecepClinic (Sistema › Suporte), que de propósito não fala com o bot nem entra em Atendimento.',
  'Testar de outro celular, que não seja o número do Suporte.',
  ''
),
(
  'Conversa em "Aguardando a clínica" sem o botão "Devolver ao bot"',
  'Na tela Atendimento humano, a conversa está em "Aguardando a clínica" e não tem o botão "Devolver ao bot" (ele só aparece em "Em atendimento pela clínica").',
  'O paciente escreveu de novo depois da última resposta da recepção, então a conversa voltou para "Aguardando". O botão de devolver só existe na seção "Em atendimento" (mudança ainda não decidida).',
  'Responder o paciente pelo app (a conversa vai para "Em atendimento", com o botão) ou mandar "#bot" pelo app na conversa.',
  ''
);
