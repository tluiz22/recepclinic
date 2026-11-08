# Especificação das telas: portal do paciente e recepção

> **Etapa 1 (planejamento), 08/nov/2026.** Especificação funcional para a Etapa 2 (design). **Não é o design visual**:
> nada de cores, tipografia ou layout definitivo. Regras em [`proposta-recepcao-digital-integrada.md`](proposta-recepcao-digital-integrada.md)
> (seções citadas como "P§n"); decisões abertas RD1 a RD14 (P§17).

## 0. Princípios comuns

**Usabilidade (obrigatórios):** facilidade acima de sofisticação; uma pergunta por tela no portal; textos curtos em
linguagem de paciente ("médico", "horário", "convênio"); passo pulado quando só há uma opção; o que foi escolhido
sempre visível (resumo no topo ou barra fixa); "Voltar" leva à tela anterior com as escolhas preservadas; nenhum dado
digitado se perde após erro; "Falar com a recepção" presente em todas as telas do portal.

**Acessibilidade (WCAG 2.2 AA como meta):** área de toque ≥ 48 × 48 px; texto base ≥ 18 px no portal (16 px no
painel); contraste ≥ 4,5:1; nada dependente só de cor (selos com texto); foco visível e ordem lógica de teclado;
rótulos reais nos campos (não só placeholder); erros anunciados (`aria-live`) e ligados ao campo; teclado numérico
para telefone e código (`inputmode="numeric"`, `autocomplete="tel"` e `one-time-code`); datas por extenso ("terça,
12 de novembro"); funciona com zoom de 200% sem rolagem horizontal; sem tempo limite oculto (o contador da reserva é
visível e anunciado no último minuto).

**Responsivo:** portal desenhado primeiro para 360–390 px; em 1280 px, coluna central com o resumo ao lado (como o
link de hoje, R11). Painel: 1280 px primeiro, com versão de celular para Conversas, Início e Agenda (um profissional
por vez). Conferir sempre em 390 px e 1280 px.

**Estados padrão de toda tela:** carregando (esqueleto, sem tela branca; > 3 s mostra "Ainda carregando…"); vazio
(explica e oferece um caminho); erro de rede ("Não conseguimos carregar. [Tentar de novo] [Falar com a recepção]");
clínica suspensa ("Agendamento indisponível no momento", sem falar de cobrança, como hoje).

**Componentes base (a desenhar na Etapa 2):** Cabeçalho da clínica (logo, nome); Indicador de etapas ("Passo 3 de 6",
com os passos pulados descontados); Cartão de opção (grande, tocável inteiro); Cartão de profissional; Selo de
modalidade; Faixa de dias (existe: `PatientDayStrip`); Grade de horários por turno (existe: `PatientSlots`); Campo de
telefone; Campo de código (6 dígitos); Resumo do agendamento; Barra fixa inferior (escolha + botão principal); Aviso
(info, atenção, erro; existe: `LinkNotice`); Botão "Falar com a recepção"; Contador de reserva.

---

## 1. Portal do paciente

Fluxo e navegação:

```
P1 Início ─▶ P2 Especialidade ─▶ P3 Médicos ─▶ P5 Particular/convênio (com os dados do médico)
                 (pulada se 1)      (pulada se 1)   (pulada se 1)
   ─▶ P6 Dias e horários ─▶ P7 Telefone (+ código) ─▶ P8 Quem será atendido ─▶ P9 Revisão ─▶ P10 Confirmado
                              (pulada com link do bot)        (+ P8b Cadastro novo)
P11 Falar com a recepção: de qualquer tela.   P12 Minhas consultas (remarcar/cancelar).   P13 Link inválido.
```

### P1. Início do portal da clínica

- **Objetivo:** apresentar a clínica e levar ao agendamento em um toque.
- **Usuário:** paciente ou responsável (qualquer familiaridade com tecnologia).
- **Entrada:** `agendar.recepclinic.com.br/{apelido}` (RD1) ou `/s/{token}` (com token, abre direto em P2/P3/P4
  conforme o escopo).
- **Exibe:** logo e nome da clínica; frase curta ("Agende sua consulta em poucos passos"); endereço(s) com "Ver no
  mapa"; horário da recepção; especialidades em destaque (até 6) ou o nome do profissional (clínica de um só).
- **Ações:** **Agendar consulta** (principal) → P2; **Minhas consultas** → P12; **Falar com a recepção** → P11;
  **Médicos, convênios e valores** → lista de P3 em modo consulta.
- **Regras:** item Portal desligado ou clínica suspensa → página "Agendamento indisponível" com o WhatsApp da clínica.
- **Aceite:** em 390 px, "Agendar consulta" visível sem rolar; sem login; sem cookie de rastreamento.

### P2. Escolha da especialidade

- **Objetivo:** filtrar médicos por área.
- **Exibe:** pergunta "Qual especialidade você procura?"; cartões com nome e "n médicos"; busca a partir de 8
  especialidades (com sinônimos: "coração" → Cardiologia); atalho "Já sei o nome do médico" (busca por nome).
- **Ações:** tocar no cartão → P3 (ou P4 se só um médico); busca filtra ao digitar (sem acento, sem maiúsculas).
- **Vazio da busca:** "Não encontramos '{termo}'. Veja todas as especialidades ou fale com a recepção."
- **Regras:** só especialidades com profissional ativo e com horário no prazo; "Exames" não aparece no MVP (RD5).
- **Aceite:** clínica com uma especialidade pula a tela; a escolha fica no endereço (Voltar do navegador funciona).

### P3. Seleção do médico

- **Objetivo:** escolher o profissional entendendo as diferenças.
- **Exibe:** "Médicos de {especialidade}", em **ordem alfabética** (RD7); cartão por profissional: foto (sempre que
  houver no cadastro, RD13) ou iniciais, nome, registro (CRM
  12345/RN), especialidades (principal em destaque), selos de modalidade ("Particular R$ 350", "Unimed", "+2"),
  próximo horário livre ("Amanhã, 14:00" / "Sem horário nos próximos 60 dias").
- **Filtros:** "Atende meu convênio" (lista dos convênios da clínica).
- **Ações:** tocar no cartão → P5 (ou P6 se uma modalidade só); profissional sem horário: cartão visível com "Sem horário
  nos próximos 60 dias", sem toque e sem botão (cliente, 08/nov). Até 5 médicos: cartão completo; 6 ou mais: lista
  compacta (cliente, 08/nov).
- **Vazio do filtro:** "Nenhum médico de {especialidade} atende {convênio}. [Ver todos] [Falar com a recepção]."
- **Regras:** só ativos com serviço Consulta ativo; convênio do filtro usa a associação positiva (MC).
- **Aceite:** 18 profissionais rolam bem no celular (cartões de altura fixa, imagens leves); filtro mantido ao voltar.

### P4. Médico e modalidades

> **Retirada da jornada (cliente, 08/nov, Etapa 2):** P3 vai direto à P5; o conteúdo abaixo (foto, nome, registro,
> especialidades, local, orientações; valores e convênios) aparece no topo da P5 e da P6. Mantido como referência.

- **Objetivo:** mostrar como o médico atende antes de qualquer horário.
- **Exibe:** foto, nome, registro, especialidades; **Particular: R$ X** (ou "Não atende particular"); **Convênios
  aceitos**: lista completa; observações por convênio (autorização, encaminhamento, carteirinha); local(is) de
  atendimento; orientações gerais curtas.
- **Ações:** **Continuar** → P5 (ou P6 se uma modalidade só); "Escolher outro médico" → P3.
- **Regras:** dados sempre do servidor; observação de convênio é texto da clínica (sem preço por convênio, D10).
- **Aceite:** cenários 4, 5 e 6 (P§15) mostram exatamente o que o médico aceita.

### P5. Particular ou convênio

- **Objetivo:** escolher a modalidade **depois** do médico.
- **Exibe:** "Como será o atendimento?"; opção **Particular — R$ X**; uma opção por convênio aceito; observação do
  convênio abaixo da opção; se a clínica exige carteirinha, aviso "Vamos pedir o número da carteirinha".
- **Ações:** escolher → P6. Trocar depois (pelo resumo) → volta aqui e refaz P6.
- **Erro:** convênio que deixou de ser aceito entre as telas → "A Dra. X não atende mais {plano}. Escolha outra opção."
- **Aceite:** nunca lista convênio fora da associação; nunca é a primeira pergunta do fluxo.

### P6. Dias e horários

- **Objetivo:** escolher data e hora entre os horários realmente livres.
- **Exibe:** resumo no topo (médico · modalidade · [Trocar]); faixa de dias com setas (só dias com horário; existe);
  horários do dia por turno (Manhã, Tarde, Noite); local quando houver mais de um; tipo de consulta se houver mais de um
  (RD5) (antes da faixa de dias, porque a duração muda os horários).
- **Ações:** tocar no horário → seleciona (barra fixa: "Ter, 12/11 às 14:00 · [Continuar]"); Continuar → P7 (sempre
  passa por P7 e P8, mesmo com o link do bot).
- **Vazio:** "Sem horários nos próximos {n} dias. [Ver outro médico da especialidade] [Falar com a recepção]."
- **Regras:** consulta no servidor a cada troca de dia/modalidade; prazo e antecedência da agenda; horário em reserva
  de outro não aparece.
- **Aceite:** horário que some entre a escolha e o Continuar dá a mensagem do cenário 8 sem perder o dia escolhido.

### P7. Identificação pelo telefone

- **Objetivo:** comprovar o telefone sem CPF.
- **Com link do bot:** **sem tela (cliente, 08/nov)**: P6 vai direto à P8, que mostra "Confirmação no WhatsApp
  final 4321" e "Usar outro número" no topo. Desenho anterior: tela curta "Agendando pelo WhatsApp ·· 4321" + [Continuar] + "Não sou eu / usar outro número"
  (vai para a forma direta, com o código no número novo e a saída "Continuar com o final 4321"; cliente, 08/nov).
- **Entrada direta:** campo "Seu celular com WhatsApp" (DDD + número, máscara); CAPTCHA adaptativo quando exigido
  (RD9); [Receber código no WhatsApp] → campo do código (6 dígitos, colar funciona), "Reenviar em 0:59", "Trocar número".
- **Mensagens:** código errado "Código incorreto. Restam {n} tentativas."; vencido "O código venceu. [Enviar outro]";
  limite "Muitas tentativas. Tente de novo em 15 minutos ou fale com a recepção."; número inválido "Confira o DDD e o
  número."
- **Regras:** P§5.1 e P§7.2; o servidor cria a **reserva temporária** ao concluir esta tela (P§7.3) e só então mostra
  cadastros. Aviso de privacidade curto com link.
- **Aceite:** nenhum cadastro aparece antes do telefone comprovado; o campo de CPF não existe.

### P8. Quem será atendido

- **Objetivo:** escolher o paciente sem presumir o titular.
- **Exibe:** "Para quem é a consulta?"; pacientes do contato (primeiro nome + inicial, (RD12); "(você)" quando
  `is_contact_self`); **Outra pessoa** → P8b; se não há cadastro, vai direto a P8b; contador da reserva visível.
- **Erros:** idade fora do limite do médico → "A Dra. X atende até {n} anos. [Escolher outro médico]"; carteirinha
  exigida e ausente → campo da carteirinha nesta tela.
- **Aceite:** cenários 2, 3 e 17.

### P8b. Cadastro novo

- **Exibe:** "A consulta é para: ( ) Mim ( ) Outra pessoa (filho, dependente)"; para mim: nome completo, data de
  nascimento; para outra pessoa: seu nome (se o contato é novo), nome completo e nascimento do paciente.
- **Validação:** nome com nome e sobrenome; data real, não futura, ≥ 1900; nome parecido com um já cadastrado no mesmo
  telefone → "Você quis dizer João S.? [Sim, é ele] [Não, é outra pessoa]".
- **Regras:** só o indispensável (P§5.3); limite de pacientes novos por telefone; sem CPF, e-mail ou endereço.
- **Aceite:** dados preservados após erro; teclado de data adequado no celular.

### P9. Revisão

- **Exibe:** P§6 (médico, especialidade, modalidade e valor ou convênio, data por extenso e hora, local com "Ver no
  mapa", paciente, orientações e preparo, "Confirmação no WhatsApp ·· 4321"); contador "Reservamos este horário por 4:32".
- **Ações:** **Confirmar agendamento** (uma vez só; desabilita e mostra "Confirmando…"); "Alterar" em cada linha
  (volta à tela daquele item, preservando o resto).
- **Erros:** reserva vencida → "O tempo para confirmar acabou. [Ver horários de novo]" (volta a P6 no mesmo dia);
  horário tomado → cenário 8; limite de atendimentos futuros → "Este número já tem {n} consultas marcadas. Fale com a
  recepção."
- **Aceite:** duplo toque não cria dois; cenário 9.

### P10. Confirmação final

- **Exibe:** "Consulta marcada!" + resumo; "Enviamos a confirmação no WhatsApp"; [Adicionar à agenda do celular]
  (.ics); [Ver no mapa]; "Precisa remarcar? Use o WhatsApp ou Minhas consultas".
- **Regras:** a tela não depende do envio da mensagem (cenário 15); recarregar a página mostra a mesma confirmação, não
  marca de novo.
- **Aceite:** o .ics não tem dado de saúde além de "Consulta — {Clínica}" [a confirmar se inclui o médico].

### P11. Falar com a recepção

- **Objetivo:** pedir ajuda sem perder o contexto.
- **Formato:** botão fixo em todas as telas → folha com "Abrir conversa no WhatsApp" (link `wa.me` do número do médico
  escolhido ou da clínica, com texto pronto "Olá! Estou no portal e preciso de ajuda para agendar." + código curto da
  sessão, sem dado de saúde) e o telefone da recepção em texto (sem ligação, com botão do WhatsApp).
- **Regras:** a sessão fica ligada à conversa quando o paciente manda a mensagem (código); a Central mostra "Veio do
  portal: parou em {etapa}".
- **Aceite:** cenário 10.

### P12. Minhas consultas

- **Exibe:** telefone comprovado (P7) → próximas consultas do contato (paciente parcial, médico, data); cada uma com
  [Remarcar] (P6 com o mesmo médico e modalidade) e [Cancelar] ("Tem certeza? A vaga será liberada.").
- **Regras:** antecedência (RD10); dentro dela, só "Falar com a recepção"; sessão de série remarca/cancela só a sessão (D9).
- **Vazio:** "Nenhuma consulta marcada neste número. [Agendar consulta]".

### P13. Link inválido, vencido ou usado

- **Exibe:** "Este link não vale mais" (vencido) / "Este link já foi usado" (com o resumo do que foi marcado, sem dado
  além do primeiro nome) / "Link não encontrado"; [Agendar pelo portal] (P1); [Pedir novo link no WhatsApp].
- **Aceite:** cenário 16; status HTTP 404/410 sem revelar se o telefone existe.

---

## 2. Painel da recepção

Organização proposta (não 10 páginas soltas): **Início**, **Conversas** (caixa unificada com filtros e painel do
paciente), **Agenda** (grade de profissionais, com filtro do portal), **Pacientes** (contatos e dependentes),
**Métricas** (aba Portal) e, em Configurações, **Números de WhatsApp** e **Portal**.

### R1. Caixa de entrada unificada (Conversas) — reúne itens 1 a 6 do pedido

- **Objetivo:** atender todas as conversas autorizadas num lugar só.
- **Usuário:** Recepção, Administrador; Profissional só as dele.
- **Layout funcional:** três áreas em 1280 px (lista · conversa · painel do paciente; existe na Central); no celular,
  telas separadas com "Voltar".
- **Lista (item 2):** cada linha: nome do contato (e paciente, se diferente), **selo do número** ("Dr. Fulano" /
  "Recepção geral") (item 5), profissional em foco com a especialidade, última mensagem e hora, situação (com o bot,
  aguardando, em atendimento por {pessoa}, finalizada), não lidas, selo "Veio do portal".
- **Filtros (item 4):** barra fixa: Profissional (busca com grupos por especialidade, `OwnerPicker`), Especialidade,
  Número, Situação, Responsável (Minhas, Sem responsável, Todas), "Aguardando atendimento" (item 6, com contador).
  Filtros no endereço (voltar mantém); chip "Limpar filtros".
- **Conversa (item 3):** mensagens (existe); cabeçalho com o número de origem fixo ("Respondendo pelo número do Dr.
  Fulano ·· 1234", sem opção de trocar); ações Assumir, Transferir (para pessoa), **Direcionar a outro profissional**
  (muda o foco), Finalizar; janela de 24 h por número visível.
- **Pendências (item 6):** aba/filtro "Aguardando" ordenada por espera, com o tempo ("há 12 min"); push como hoje.
- **Estados:** vazio por filtro ("Nenhuma conversa aguardando para os filtros escolhidos."); sem permissão a um
  profissional: as conversas dele não aparecem e o filtro não lista o nome.
- **Aceite:** cenários 13 e 14; 3 secretárias com 18 profissionais filtram em ≤ 2 toques; resposta sai do número da
  conversa (teste com dois números de testes).

### R2. Agendamentos do portal (item 7)

- **Onde:** filtro "Origem: Portal" na Agenda e card no Início "Marcados pelo portal hoje (n)".
- **Exibe:** atendimento com selo **Portal** (e origem do acesso: WhatsApp, site, Instagram…), quando foi marcado,
  paciente novo ou não ("Cadastro novo: completar dados?").
- **Ações:** abrir o atendimento (ações de sempre); "Revisado" para tirar da lista do Início.
- **Aceite:** diferencia Portal × WhatsApp (bot) × Recepção (nome de quem marcou) em toda lista de atendimentos.

### R3. Agenda com vários profissionais (item 8)

- **Objetivo:** ver e operar 18 agendas sem abrir uma a uma.
- **Visões:** **Dia em grade** (colunas = profissionais filtrados, linhas = horários; atendimentos, livres, bloqueios e
  reservas do portal "Em reserva até 10:42"); Semana e Mês como hoje, filtráveis.
- **Filtros:** especialidade, profissional (busca), "só com atendimento hoje", origem, situação; "Meus profissionais"
  (os liberados à pessoa). Lembrar a última escolha na sessão.
- **"Próximos horários livres":** especialidade (+ convênio, + modalidade) → os primeiros horários de cada profissional,
  com "Marcar" direto (abre a Marcar preenchida).
- **Celular:** um profissional por vez, com troca por deslizar ou lista; "Próximos horários livres" em destaque.
- **Conflitos:** a Marcar recusa horário ocupado ou em reserva (mensagem clara) — a trava é do banco.
- **Aceite:** 18 colunas legíveis em 1280 px (rolagem horizontal só dentro da grade, cabeçalho fixo); carregamento
  < 2 s no staging com dados de teste.

### R4. Pacientes e dependentes (item 9)

- **Exibe:** contato (telefone, nome) e os pacientes ligados ("Você" / dependentes) com idade, convênio, próximas
  consultas; selo "Cadastrado pelo portal" e "Dados a completar".
- **Ações:** editar, ligar paciente a outro contato (troca de responsável), completar dados; CPF **não** aparece aqui
  (fica no financeiro, na saída do atendimento).
- **Aceite:** existe hoje (contato → pacientes); evoluir só os selos e o filtro "cadastrados pelo portal".

### R5. Acompanhamento e indicadores (item 10)

- **Início:** pendências de agora por profissional (conversas aguardando, portal novo, cancelamentos, confirmações de
  amanhã, falhas de envio).
- **Métricas › Portal:** funil por etapa, conversão, origem, abandono por etapa, marcações pelo paciente × recepção,
  por profissional e especialidade, tentativas bloqueadas. Período e filtro por profissional.
- **Aceite:** nenhum dado pessoal nos gráficos; números batem com a Agenda no período.

### R6. Configurações › Números de WhatsApp (Administrador)

- **Exibe:** lista de conexões: rótulo, número, situação, destino (clínica toda / profissionais), padrão, limites e
  qualidade da Meta [Pendência]; [Conectar outro número] (Embedded Signup); templates por número.
- **Regras:** só o Administrador; desconectar pede confirmação e mostra o impacto (conversas e lembretes daquele
  número); um número padrão obrigatório.

### R7. Configurações › Portal (Administrador)

- **Exibe:** apelido e endereço do portal (RD1) com "Copiar" e QR code; o que aparece (especialidades); antecedência
  de cancelamento (RD10, padrão 24 h); a foto do médico vem do cadastro, que avisa que ela é pública (RD13); textos do início; observações por convênio (no cadastro do
  profissional, seção Convênios).

## 3. Fluxos completos de uso (para o design)

1. **Paciente pelo WhatsApp (clínica de 18):** "Oi" → boas-vindas → Agendar consulta → link → P2 Pediatria → P3 (4
   médicos) → P4 Dra. Ana → P5 Unimed → P6 terça 14:00 → P7 "·· 4321, continuar" → P8 "João S." → P9 → P10 →
   confirmação no WhatsApp pelo mesmo número.
2. **Paciente pelo Instagram:** link da bio → P1 → … → P7 celular + código → P8b "Outra pessoa" (filho) → P9 → P10.
3. **Secretária, manhã:** Início (3 aguardando, 5 do portal) → Conversas filtro "Aguardando" → abre a do Dr. Fulano →
   responde pelo número dele → "Próximos horários livres" de Cardiologia + Amil → Marcar → volta à caixa.
4. **Secretária, imprevisto:** médico falta → Agenda grade filtrada nele → Avisar/Remarcar em massa (existe) → caixa
   mostra as respostas.

## 4. Critérios de aceite gerais

- Ordem do portal respeitada (modalidade sempre depois do médico); nenhuma tela pede CPF; telefone comprovado antes de
  mostrar cadastros; horários sempre do servidor; um atendimento por horário mesmo com concorrência; confirmação nunca
  desfaz a marcação; resposta sempre pelo número da conversa; Voltar preserva escolhas; 390 px e 1280 px sem rolagem
  horizontal da página; foco e leitores de tela conferidos com Playwright.
