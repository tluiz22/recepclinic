# Especificação das telas: portal do paciente e recepção

> **Etapa 1 (planejamento), 08/nov/2026; painel revisto com as decisões da Etapa 2 (rodada 3, 08/nov).**
> Especificação funcional para a Etapa 2 (design). **Não é o design visual**:
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
- **Exibe:** "Para quem é a consulta?"; pacientes do contato (nome completo, RD12 revista em 08/nov; antes: primeiro nome + inicial); "(você)" quando
  `is_contact_self`); **Outra pessoa** → P8b; se não há cadastro, vai direto a P8b; contador da reserva visível.
- **Erros:** idade fora do limite do médico → "A Dra. X atende até {n} anos. [Escolher outro médico]"; carteirinha
  exigida e ausente → campo da carteirinha nesta tela.
- **Aceite:** cenários 2, 3 e 17.

### P8b. Cadastro novo

- **Exibe:** "A consulta é para: ( ) Mim ( ) Outra pessoa (filho, dependente)"; para mim: nome completo, data de
  nascimento; para outra pessoa: seu nome (se o contato é novo), nome completo e nascimento do paciente.
- **Validação:** nome com nome e sobrenome; data real (dia válido para o mês), não futura, ano com 4 números, até 110
  anos; abaixo dos campos, a data por extenso com a idade ("14 de março de 2019, 7 anos"). Duplicado (cliente, 08/nov):
  nome parecido com um paciente do mesmo telefone **e** mesma data → "Já existe um cadastro neste número: João Souza
  Lima, nascido em 14/03/2019. É ele?"; nome parecido com data diferente → mostra as duas datas, "Sim, é ele (manter
  14/03/2019)" / "É ele, mas a data certa é 14/03/2018" (aviso: corrigir com a recepção no dia da consulta; o
  portal não altera o cadastro) / "Não, é outra pessoa"; com "Sim", vale a data cadastrada e a recepção vê o selo "Data informada
  diferente no portal" (R4). A P9 repete a data com a idade.
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

- **Exibe:** "Este link não vale mais" (vencido) / "Este link já foi usado" (sem nenhum dado da consulta, cliente 08/nov;
  leva a Minhas consultas, que pede o telefone) / "Link não encontrado"; [Agendar pelo portal] (P1); [Pedir novo link no WhatsApp].
- **Aceite:** cenário 16; status HTTP 404/410 sem revelar se o telefone existe.

### PP. Link do profissional (cliente, 08/nov)

- **Endereço:** `agendar.recepclinic.com.br/{apelido-da-clínica}/{apelido-do-profissional}`; apelido do profissional
  automático pelo nome do cadastro, fixo (repetido na clínica ganha `-2`).
- **Uso:** Instagram, site ou mensagem de WhatsApp do profissional; é entrada direta (P7 com celular e código).
- **Início do profissional:** foto (ou iniciais), nome, registro, especialidades, próximo horário, [Agendar consulta
  com {nome}], [Minhas consultas], valores e convênios, local com "Ver no mapa", orientações.
- **Jornada:** início → P5 → P6 → P7 → P8/P8b → P9 → P10; "Passo n de 4" (3 com um só atendimento); sem "Trocar
  médico" e **sem mostrar outros médicos da clínica**; sem horário: só "Falar com a recepção".
- **Clínica de um só profissional (como o piloto):** o endereço da clínica abre direto no início do profissional.
- **Onde pegar o link (cliente, 08/nov):** atalho no Meu dia para o WhatsApp; links marcados por lugar (Instagram,
  site, Google) e QR no Meu perfil do profissional (R7).

---

## 2. Painel da recepção

> **Revisto pelo cliente na Etapa 2 (rodada 3, 08/nov/2026)**, tela por tela; desenho aprovado no canvas
> (P§18). **Vários números de WhatsApp ficam fora desta entrega** (pendentes, P§10): a clínica segue com um número só,
> como hoje; não há selo do número, filtro Número nem tela de números.

Organização: **Meu dia** (início), **Conversas**, **Agenda** (em colunas), **Pacientes** (como hoje), **Métricas**
(aba nova Portal e origens em Desempenho), **Configurações › Portal** (Administrador) e **Meu perfil** do profissional.

### R1. Conversas

- **Usuário:** Recepção e Administrador veem **todas as conversas** (RD14 revista); Profissional como hoje.
- **Conversa sem profissional (cliente, 08/nov):** a conversa **não é ligada a profissional**; o único vínculo é **com
  quem está** (o responsável). Não há "profissional em foco", filtro Profissional/Especialidade nem "Direcionar a outro
  profissional".
- **Layout:** três áreas em 1280 px (lista · conversa · painel do paciente; existe na Central); no celular, telas
  separadas com "Voltar".
- **Abas de hoje:** Abertas, Finalizadas, Pessoal e admin.
- **Filtros:** Responsável (Minhas, Sem responsável, Todas), Situação e o **botão "Aguardando" com contador**
  (combinável com os outros); filtros no endereço (voltar mantém); "Limpar filtros".
- **Lista:** **aguardando primeiro, pela espera** ("há 12 min"), depois pela última mensagem; cada linha: nome do
  contato (e paciente, se diferente), última mensagem e hora, situação (aguardando · sem responsável, "Com Carla"…),
  não lidas, selo "Veio do portal".
- **Conversa:** mensagens (existe); aviso "Veio do portal: parou no passo {passo}" quando for o caso; ações Assumir,
  Transferir (para pessoa) e Finalizar; janela de 24 h visível.
- **Painel do paciente:** dados, próxima consulta e, **sempre**: paciente cadastrado → "Com quem ele já consulta"
  (cada profissional com a última consulta, os primeiros horários livres e "Outro horário") e "Agendar com outro
  profissional"; o horário abre a Marcar preenchida (com o convênio dele). Número sem cadastro → "Marcar consulta".
- **Aceite:** cenários 13 e 14; filtro "Aguardando" em 1 toque; ordem por espera.

### R2. Atendimento aberto na Agenda

- **Como abre:** clicar num atendimento da grade abre uma **coluna à direita, como hoje**, com "Fechar"; a agenda do
  atendimento passa para a **primeira coluna** (destacada) e as outras que couberem continuam visíveis; "Fechar"
  devolve o espaço.
- **Exibe:** paciente (idade, convênio, responsável com WhatsApp), data, hora, profissional, serviço e situação;
  **origem só aqui** (não na grade): "Portal · {lugar}, marcada pelo paciente em {data} às {hora}", "WhatsApp · bot" ou
  "Recepção · {nome}"; aviso "Data de nascimento a conferir" quando houver (R4).
- **Ações:** as de hoje (Confirmar presença, Remarcar, Cancelar), cada uma com confirmação.
- **Sem "completar cadastro":** o portal pega os mesmos dados do WhatsApp (nome, data de nascimento, telefone e
  responsável quando precisa); **não guarda endereço**.

### R3. Agenda em colunas

- **Sempre todas as agendas a que a pessoa tem acesso** (sem "só quem atende hoje" e sem lembrar filtro).
- **Até 7 agendas** (cabem sem rolagem): colunas na largura toda, só o filtro "Agenda", como hoje (desenho da clínica
  pequena, 2 profissionais e Exames, aprovado).
- **A partir de 8:** filtros **Especialidade** e **Profissional**, **um de cada vez** (ou todos), com busca; colunas
  agrupadas por especialidade; **barra de rolagem em destaque** no topo da grade (setas, trilho largo, "Profissionais 1
  a 7 de 18") e botão "Mais {n}" na borda direita; nomes e horários fixos.
- **Filtros:** Situação; **sem filtro Origem**.
- **Na grade:** atendimentos com paciente e serviço (situação pela cor, com legenda); reserva do portal tracejada "Em
  reserva até 10:42"; bloqueio hachurado; **sem selo de origem**.
- **Próximos horários livres:** filtros Especialidade, Atendimento (presencial/online) e "A partir de" (**sem
  convênio**; cada profissional mostra os convênios que atende); os **2 primeiros dias com vaga** de cada um, com "Ver
  mais dias"; horário em reserva **aparece apagado**, sem marcar; tocar no horário abre a Marcar preenchida.
- **Celular:** uma agenda por vez (setas, deslizar ou lista com busca); "Próximos horários livres" em destaque.
- **Conflitos:** a Marcar recusa horário ocupado ou em reserva (a trava é do banco).
- **Aceite:** 18 colunas legíveis em 1280 px (rolagem só dentro da grade); carregamento < 2 s no staging.

### R4. Pacientes

- **Como hoje** (sem aba nova). Na ficha: selo "Cadastrado pelo portal" e o quadro **"Data de nascimento a conferir"**
  (data do cadastro e a informada no portal, com "Corrigir para {data}" e "Manter {data}", com confirmação); resolvido,
  some do Meu dia e da ficha. CPF não aparece aqui (financeiro).

### R5. Meu dia e Métricas

- **Meu dia da recepção:**
  - **Atalho do link para o WhatsApp** no topo: link da clínica (todos os profissionais), "Copiar link" e "Abrir o
    WhatsApp" (celular: "Enviar no WhatsApp" e "Copiar").
  - **Precisa de você:** só o que precisa da recepção: conversas aguardando (sem nome de profissional), **consultas do
    portal para conferir** (só data de nascimento diferente, com "Conferir data"; some quando resolvida; **sem
    "Revisado"**), cancelamentos de hoje, confirmações de amanhã, falhas de envio.
  - **Tabela "Por profissional"** (mantida): conferir, cancelamentos, a confirmar e atendimentos de hoje; quem tem
    pendência primeiro.
- **Meu dia do profissional:** atalho com **o próprio link** e a agenda de hoje.
- **Métricas:** as 5 abas de hoje continuam (remarcação e cancelamento seguem no WhatsApp e no Agendamento digital).
  - **Aba nova "Portal":** visitas, consultas marcadas, % que virou consulta, tentativas bloqueadas; "Onde as pessoas
    param" (passos do portal com a perda; "Ver em tabela"); filtro **Entrada** (link do WhatsApp, link da clínica, link
    de profissional).
  - **Desempenho › "De onde vêm as marcações":** Recepção (painel), WhatsApp (o bot marcou), WhatsApp (link do portal
    na conversa), Link da clínica e Links dos profissionais, com % e o detalhe por lugar (Instagram, site, Google,
    cartaz, origem não informada); tabela "Pelos links dos profissionais".
- **Aceite:** nenhum dado pessoal nos gráficos; números batem com a Agenda no período.

### R6. Números de WhatsApp — fora desta entrega

Pendente para planejamento e implementação depois desta entrega ou quando o cliente decidir (P§10, F4, RD11).

### R7. Links, QR e Configurações › Portal

- **Link marcado por lugar:** "Copiar link para…" pergunta onde vai usar (Instagram, Site, Google, Mensagem, Outro
  lugar) e copia o link com a marca (`?de=instagram`), com o aviso "Link para o Instagram copiado"; no celular,
  escolhe o lugar e "Compartilhar". Link sem marca conta como "origem não informada".
- **QR code só pelo botão:** janela com o QR, Baixar imagem, Imprimir cartaz (A4, "Aponte a câmera para agendar") e
  Copiar link do cartaz; sai marcado como "cartaz". Sem QR fixo nas telas.
- **Meu perfil do profissional** (menu do profissional: Meu dia, Agenda, Pacientes, Meu perfil, Central de Ajuda):
  bloco **"Link de agendamento"** no topo (link, Copiar link para…, QR code, Ver como o paciente vê, Mostrar no
  portal) e as seções de hoje; **o profissional altera tudo o que é dele** (o Administrador também).
- **Configurações › Portal** (Administrador; item em Atendimento, depois de Convênios): endereço da clínica com
  "Copiar link para…", QR code e "Abrir o portal" (mudar o endereço: Suporte); lista do link de cada profissional (busca,
  especialidade, "Copiar para…", QR, "Fora do portal"/"Mostrar no portal"); antecedência para cancelar/remarcar (RD10,
  padrão 24 h); quem aparece (vem do cadastro: "Mostrar no portal", foto pública, observações de convênio); texto do
  início (frase e horário da recepção).

### R8. Celular

- **Barra embaixo** com Meu dia, Conversas, Agenda e Pacientes (com as pendências); o resto no menu (☰). Capturas da
  ajuda do celular a refazer na implementação, com autorização do cliente.

---

## 3. Fluxos completos de uso (para o design)

1. **Paciente pelo WhatsApp (clínica de 18):** "Oi" → boas-vindas → Agendar consulta → link → P2 Pediatria → P3 (4
   médicos) → P4 Dra. Ana → P5 Unimed → P6 terça 14:00 → P7 "·· 4321, continuar" → P8 "João S." → P9 → P10 →
   confirmação no WhatsApp pelo mesmo número.
2. **Paciente pelo Instagram:** link da bio → P1 → … → P7 celular + código → P8b "Outra pessoa" (filho) → P9 → P10.
3. **Secretária, manhã:** Meu dia (3 aguardando, 1 do portal para conferir) → Conversas "Aguardando" → abre a do
   Roberto → painel "Com quem ele já consulta" → horário do Dr. Paulo → Marcar → volta à caixa.
5. **Profissional divulga o link:** Meu dia → "Copiar link" (WhatsApp); Meu perfil → "Copiar link para… Instagram" →
   cola na bio; QR code → Imprimir cartaz.
4. **Secretária, imprevisto:** médico falta → Agenda grade filtrada nele → Avisar/Remarcar em massa (existe) → caixa
   mostra as respostas.

## 4. Critérios de aceite gerais

- Ordem do portal respeitada (modalidade sempre depois do médico); nenhuma tela pede CPF; telefone comprovado antes de
  mostrar cadastros; horários sempre do servidor; um atendimento por horário mesmo com concorrência; confirmação nunca
  desfaz a marcação; Voltar preserva escolhas; 390 px e 1280 px sem rolagem
  horizontal da página; foco e leitores de tela conferidos com Playwright.
