# Roteiro da apresentação: clínica com 18 profissionais

> **Etapa 1 (planejamento), 08/nov/2026.** Roteiro comercial. As telas da demonstração saem da Etapa 2 (design), depois
> da aprovação. Base: [`proposta-recepcao-digital-integrada.md`](proposta-recepcao-digital-integrada.md).

**Mensagem central:** "O RecepClinic está evoluindo de uma solução de recepção automatizada pelo WhatsApp para uma
plataforma integrada de recepção digital: o paciente resolve pelo WhatsApp ou faz o próprio agendamento num portal,
e a equipe da clínica acompanha toda a operação num único ambiente."

Tom: operação do dia a dia, não tecnologia. **Não falar em inteligência artificial** (a proposta não usa).

## 1. Problemas que a proposta resolve (abrir perguntando, não afirmando)

- Três secretárias, 18 médicos: o paciente espera resposta enquanto elas atendem telefone, balcão e WhatsApp.
- Cada médico com um número, ou todos num número só: conversas espalhadas em vários celulares.
- "Qual médico atende Unimed?", "quanto custa a consulta?": as mesmas perguntas o dia inteiro.
- Agendamento só no horário da recepção; à noite e no fim de semana o paciente desiste ou procura outra clínica.
- Marcação errada: médico que não atende o convênio, horário em conflito, duas pessoas no mesmo horário.
- A gestão não sabe quantos pedidos chegam, quantos viram consulta e onde o paciente desiste.

## 2. Visão: recepção digital integrada

Três peças, um sistema: **WhatsApp** (porta de entrada e relacionamento), **Portal da clínica** (o paciente escolhe
médico, convênio e horário sozinho), **Painel da recepção** (conversas, agendas e pacientes dos 18 médicos numa tela).
Um motor de regras único garante que WhatsApp, portal e secretária vejam os mesmos horários e as mesmas regras.

## 3. Jornada do paciente (história para contar)

"Dona Maria quer marcar o pediatra do neto às 22h." Ela manda "oi" no WhatsApp → toca em **Agendar consulta** → abre
o portal com a marca da clínica → escolhe Pediatria → vê os 4 pediatras com foto, CRM e convênios → escolhe a Dra.
Ana → vê "Particular R$ 350 · Unimed · Amil" → escolhe Unimed → vê só os horários livres → escolhe terça às 14h →
o portal já reconhece o número dela → escolhe "João S." (o neto, já cadastrado) → confere e confirma → recebe a
confirmação no WhatsApp. **Sem CPF, sem senha, sem esperar a recepção abrir.**

## 4. Jornada da secretária

"Às 8h, a Carla abre o RecepClinic": vê no Início 3 conversas aguardando e 5 consultas marcadas pelo portal durante a
noite → abre Conversas, filtra "Aguardando" → responde a paciente do Dr. Paulo **pelo número do Dr. Paulo**, sem trocar
de celular → a paciente quer cardiologista com Amil: "Próximos horários livres" mostra os primeiros horários de todos
os cardiologistas que atendem Amil → marca em dois toques → a Agenda em grade mostra os 18 médicos do dia, com o selo
de quem marcou (Portal, WhatsApp ou Recepção).

## 5. Benefícios para clínica com vários profissionais

- Menos tarefas repetitivas: informações e marcações simples saem sozinhas.
- Mais autonomia para o paciente e agendamento 24 horas.
- Conversas de todos os números num lugar, com filtro por médico e especialidade.
- Gestão centralizada dos 18 médicos, sem 18 agendas abertas.
- Menos erros: o sistema só oferece o que o médico atende e trava horário duplicado.
- Visibilidade: quantos pedidos, de onde vêm, quantos viram consulta.
- Crescer sem aumentar a equipe na mesma proporção.

## 6. O que já existe × o que está sendo proposto (obrigatório deixar claro)

| Já em uso (produção) | Pronto, em validação (staging) | Proposto (a desenvolver) |
|---|---|---|
| Bot no WhatsApp: marcar, remarcar, cancelar, informações, falar com a recepção | Especialidades por médico; bot pergunta especialidade → médico | Portal da clínica com a jornada completa |
| Link de agendar com horários reais | Convênios por médico; serviços e valores por médico | Entrada pelo site/Instagram/Google com código no WhatsApp |
| Lembrete com Confirmar/Remarcar/Cancelar; confirmação automática | Informações do bot por médico; perfil e idade por médico; fotos no cadastro | Vários números de WhatsApp na mesma clínica |
| Central de Atendimento: conversas no painel, assumir, transferir | | Caixa unificada com filtro por médico, especialidade e número |
| Agenda Dia/Semana/Mês com escolha de agendas; trava de horário duplicado | | Agenda em grade e "Próximos horários livres" |
| Pacientes com responsável e dependentes; sem CPF no agendamento | | Reserva do horário por 5 min, proteções contra agendamento falso |
| Métricas e funil do bot; limites contra abuso | | Métricas do portal e recuperação de agendamento abandonado |

Frase para a reunião: "O que está na primeira coluna a clínica usa amanhã. A segunda está pronta e em validação. A
terceira é a evolução que estamos planejando com vocês, em fases."

## 7. Evolução prevista (sem prazos fechados)

F0 publicar o multiprofissional → F1 base técnica → **F2 portal com segurança** → F3 WhatsApp levando ao portal →
F4 vários números e caixa unificada → F5 agenda da clínica grande → F6 métricas e recuperação. A clínica pode ajudar a
definir a ordem de F4 e F5 conforme a dor maior.

## 8. Sequência recomendada da demonstração (30–40 min)

1. (5 min) Perguntas de abertura (seção 9, primeiras 4) — ouvir a operação.
2. (5 min) O que já existe: WhatsApp de testes ao vivo (bot com especialidade → médico, no staging).
3. (10 min) Jornada do paciente no celular (protótipo da Etapa 2), contando a história da seção 3.
4. (10 min) Jornada da secretária no computador (protótipo): Início → Conversas filtradas → Próximos horários livres → Agenda em grade.
5. (5 min) Segurança e privacidade em linguagem simples: sem CPF, código no WhatsApp, horário reservado, ninguém marca
   em dobro, dados de crianças protegidos.
6. (5 min) Tabela da seção 6 e as fases; próximos passos.

Material: celular com o WhatsApp de testes, notebook com o painel, protótipos da Etapa 2, página de apresentação.

## 9. Perguntas para validar as necessidades da clínica

1. Hoje cada médico tem um número de WhatsApp, ou um número para todos? Quem atende cada um?
2. Quantas mensagens e marcações por dia? Em que horário o volume aperta?
3. As 3 secretárias atendem todos os médicos ou cada uma tem os seus?
4. Quais convênios? Há médico que só atende convênio? Há regra de horário por convênio (ex.: Unimed só à tarde)? (RD6)
5. Convênio exige autorização ou encaminhamento antes da consulta? Para quais?
6. A consulta de retorno é marcada pela recepção ou o paciente pode marcar? Há exames/procedimentos para o portal? (RD5)
7. Qual antecedência mínima para cancelar ou remarcar? (RD10)
8. O paciente marca para filhos/pais com frequência?
9. Os médicos querem foto no portal? (RD13)
10. Onde o portal seria divulgado (site, Instagram, Google)? Têm site próprio?
11. O que mais gera erro de marcação hoje?
12. Quem decide e quem usa no dia a dia (gestor, secretárias, médicos)?
