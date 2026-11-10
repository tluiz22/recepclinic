# Implementação: recepção digital integrada (Etapa 3)

> **Estado atual (retomar daqui), 08/nov/2026.** Plano aprovado (decisões I1 a I11, seção 6; regra da Matriz, bot e
> portal, seção 1.1). **F1 feita, no staging e validada pelo cliente (08/nov)** (`aba61a8`, migração `20270102120000`;
> roteiro 7.1 sem ajustes). Produção: não. **D4 feita e aprovada tela por tela (08/nov, seção 8)**, rodada 4 no canvas.
> Endereços do portal (`agendar-teste`, `agendar`) e chaves do Turnstile: feitos (cliente, 08/nov, 4.1). **F2a, F2b,
> F2c e F2d (retorno e exames) feitas** (seções 9 a 13; migrações `20270103120000` a `20270106120000`), juntadas na
> `main` em 09/nov e levadas ao staging; o cliente valida tudo junto pelos roteiros 9.1 a 13.1. Produção: não.
> Próximo: F3 (bot com jornada única e links).

Marcas: **[Código]** conferido no repositório; **[Cliente]** decisão do cliente; **[Pendência]** depende de terceiro
(Meta, Cloudflare, advogado, DNS); **[Hipótese]** a conferir no início da etapa.

## 1. Escopo

Entra: F1 (fundação), F2 (portal + segurança, em três etapas), F3 (bot e links → portal), F5 (painel da recepção,
em duas etapas) e F6 (métricas e recuperação). **Fora:** F4, vários números de WhatsApp (cliente, 08/nov: pendente).

### 1.1 Matriz, bot e portal (cliente, 08/nov) [Cliente]

Muda a regra da proposta ("com os itens desligados, a clínica não vê diferença", seção 1):

- **Item "Portal de agendamento"** na Matriz: decide **só** se a clínica tem os links que levam ao portal (link da
  clínica, links dos profissionais, "Copiar link para…", QR).
- **Bot com uma jornada só:** marcar pelo WhatsApp sempre leva ao portal. Acaba a marcação dentro do chat; não há
  duas jornadas de agendamento no bot.
- **Bot depende do portal:** sem o item Portal ligado, a clínica não pode ligar o bot.
- **Clínica sem bot:** recebe só os lembretes; a clínica marca os atendimentos no painel.
- **Telas da recepção (R1 a R8) para todas as clínicas:** implementadas sem depender do item Portal (o que só existe
  com o portal, como o atalho do link no Meu dia, aparece só com ele).
- Consequências a decidir com o cliente: seção 6 (I6 em diante).

## 2. Como cada etapa é feita (cliente, 08/nov)

- **Telas:** skill `frontend-design` antes de implementar ou alterar cada tela, seguindo o canvas aprovado
  (https://claude.ai/artifact/Npzjm2Vixb3UnEuUWfiAmb) e a especificação.
- **Testes de cada etapa:** testes de unidade (`npm test`) e de banco (`npm run test:db`) para regras e funções; skill
  `playwright-ui-form-best-practices` nos testes de tela (jornada, formulários, "Voltar", dados preservados após erro,
  390 px e 1280 px, foco e rótulos). `security-review` na F2b e na F2c; `code-review` no fim de cada etapa.
- **Regras do projeto que valem em todas:** jornada do bot (`botJourney.ts`) no mesmo commit quando o caminho do
  paciente muda (F3, F6); captura da ajuda que muda vai para `docs/capturas-pendentes.md` (recaptura só com
  autorização); tela nova com artigo entra em `scripts/capturas-ajuda.mjs` e `imagens.ts`; CSP só existe no build
  (Turnstile e QR conferidos no staging).

## 3. Etapas

Revistas com as decisões I1, I6 a I9 (cliente, 08/nov). Telas da recepção para todas as clínicas (seção 1.1).

| Etapa | O que entrega | Para quem |
|---|---|---|
| **F1 Fundação** | Banco e regras únicas, sem tela pública: item Portal na Matriz e o bot dependendo dele (liga o Portal onde já há bot, I6); apelidos da clínica e do profissional; "Atende particular" (só convênio) e observação por convênio no cadastro; canal `portal` e origem no atendimento; fila de confirmação (sem envio duplicado); funções únicas de horários para bot, Marcar e portal; **prazo do retorno sem os dias bloqueados inteiros** (I9; já vale no bot e no "Marcar retorno" da Agenda) | Todas (o prazo do retorno); o resto sem efeito visível |
| **D4 Desenho: retorno e exames** | Rodada 4 no canvas (sem código): botão Retorno no início do portal, lista das consultas com direito a retorno, aviso "o prazo do retorno acabou", caminho dos exames | — |
| **F2a Portal: escolher** | P1 (Agendar, Retorno, Minhas consultas), P2, P3, P5, P6, link do profissional, P11 e P13, celular e computador; o paciente escolhe o horário, ainda sem marcar | Com Portal; só staging |
| **F2b Identificação e segurança** | Código pelo WhatsApp, CAPTCHA, limites contra abuso, bloqueio progressivo, reserva do horário por 5 min | Com Portal; só staging |
| **F2c Marcar consulta** | P8, P8b, P9, P10 (.ics); confirmação pela fila; origem no atendimento aberto; quadro "Data de nascimento a conferir" | Com Portal; portal pode ir à produção depois desta |
| **F2d Retorno e exames no portal** | Telas da D4: retorno pelas regras do bot (I8) e exames | Com Portal |
| **F3 Bot com jornada única e links** | Bot: Agendar, Retorno e Exames levam ao portal; acaba a marcação no chat; Remarcar abre o portal; Cancelar segue no chat (I7); P12 Minhas consultas; Configurações › Portal, "Copiar link para…", QR; jornada do bot atualizada. **Muda o bot das clínicas em produção** | Com bot (todas com bot têm Portal) |
| **F5a Agenda da clínica grande** | Agenda em colunas (até 7 sem rolagem; 8+ com Especialidade/Profissional e barra de rolagem), atendimento aberto na coluna à direita, Próximos horários livres, celular com uma agenda por vez | Todas |
| **F5b Meu dia, Conversas, Meu perfil e celular** | Meu dia novo ("Precisa de você", tabela por profissional; atalho do link só com Portal); Conversas com aguardando primeiro, botão "Aguardando" e "Com quem ele já consulta" (com a Central); Meu perfil do profissional (link e QR só com Portal); barra embaixo no celular | Todas |
| **F6 Métricas e recuperação** | Métricas › Portal, Desempenho › "De onde vêm as marcações", aviso a quem não terminou de marcar (15 min), monitor do Suporte | Com Portal (origens em Desempenho: todas) |

Ordem proposta: F1 → D4 → F2a → F2b → F2c → F2d → F3 → F5a → F5b → F6. A F5a só depende da F1 e pode ser antecipada.
Em cada etapa: unidade e banco; Playwright em 390 e 1280 px; `security-review` na F2b, F2c e F3.

## 4. Pendências fora do código (pedir cedo)

| O quê | Quem | Quando precisa |
|---|---|---|
| Endereços `agendar.recepclinic.com.br` (produção) e `agendar-teste.recepclinic.com.br` (staging, I2): CNAME no DNS + domínio na Vercel | Cliente (DNS) e Claude (configuração) | Início da F2a: **feito (08/nov, 4.1)** |
| Template de autenticação na Meta (código com "Copiar código") | Claude envia; Meta aprova | **Revisto (09/nov, seção 14):** só na conta do número do RecepClinic, com a empresa do RecepClinic verificada (cliente pede) |
| Conta e chaves do Cloudflare Turnstile (staging e produção) | Cliente | Antes da F2b: **feito (08/nov, 4.1)** |
| Termo, política e menores (LGPD) revisados | Advogado | Antes da produção |
| Preço do item "Portal" no contrato | Cliente | Antes de vender |
| RD6 (horário por convênio) e perguntas do roteiro | Reunião com a clínica | Antes da F6 |

### 4.1 Endereços e Turnstile (cliente, 08/nov/2026)

- **`agendar-teste.recepclinic.com.br`**: projeto **recepclinic** (staging) na Vercel, ambiente Production; CNAME na
  Cloudflare → `ed13a388a0d7bbde.vercel-dns-017.com`, nuvem cinza. Conferido: `HTTP/2 200`, a mesma página do `teste.`.
- **`agendar.recepclinic.com.br`**: projeto **recepclinic-producao**; CNAME → `99094fc0daefbca7.vercel-dns-016.com`,
  nuvem cinza. Conferido: `HTTP/2 200`, a mesma página do `app.`.
- Até a F2a, os dois endereços abrem o sistema inteiro (login); a F2a faz o host `agendar…` servir só o portal.
- **Turnstile:** dois widgets na conta da Cloudflare, modo **Managed**, sem pre-clearance: "RecepClinic portal
  (staging)" (hostname `agendar-teste.`) e "RecepClinic portal (produção)" (hostname `agendar.`).
- **Variáveis** (Vercel, ambiente Production de cada projeto, e nos arquivos `.env.staging` e `.env.production`):
  `PUBLIC_TURNSTILE_SITE_KEY` (tipo Config: a Vercel avisa do prefixo público, e está certo, porque a Site Key vai na
  página) e `TURNSTILE_SECRET_KEY` (Sensitive). As duas Secret Keys foram testadas no `siteverify` com um token falso
  (`invalid-input-response`, ou seja, chave válida); as do staging e da produção são diferentes.
- Desenvolvimento local: as chaves de teste públicas da Cloudflare (sempre passam), postas no `.env` na F2b. Nenhum
  redeploy feito: as variáveis entram no ar com o deploy da F2b.

## 5. Riscos e cuidados

- **Portal público sem segurança não vai para a produção:** F2a pode ir ao staging sozinha (não marca nada); a
  produção recebe o portal só depois da F2c, com o item desligado nas clínicas até o cliente ligar.
- **Migrações aditivas** e testes de banco de "clínica com o item desligado igual a antes" em cada etapa.
- **Desempenho da grade** com 18 agendas: medir no staging antes de fechar a F5a.
- **Duas confirmações:** a fila com chave única substitui o envio dentro do pedido (FE segue mostrando falhas).

## 6. Decisões para o cliente (uma por vez)

| # | Pergunta | Recomendação |
|---|---|---|
| I1 | A F1 prepara o banco para vários números (conexão em cada conversa)? | **Decidido (cliente, 08/nov): não**; fica tudo na F4, quando ela for planejada |
| I2 | Endereço do portal no staging | **Decidido (cliente, 08/nov): `agendar-teste.recepclinic.com.br`** (CNAME pelo cliente; domínio na Vercel pelo Claude) |
| I3 | Branches, staging e validação | **Decidido (cliente, 08/nov): staging e validação a cada etapa.** Fim de cada etapa: testes + Playwright, merge na `main`, staging e parada até a validação do cliente; na D4, revisão tela por tela |
| I4 | O .ics (agenda do celular) leva o nome do médico? | **Decidido (cliente, 08/nov): sim**: "Consulta com {médico} — {Clínica}" e o endereço; sem especialidade nem convênio |
| I5 | Ordem das etapas (seção 3) | **Decidido (cliente, 08/nov): portal primeiro**, como na seção 3 (F5a depois da F3) |
| I6 | Clínicas que já têm o bot (ex.: piloto na produção) | **Decidido (cliente, 08/nov): a migração liga o item Portal em toda clínica com o bot** |
| I7 | Remarcar e cancelar pelo WhatsApp (revê a RD3) | **Decidido (cliente, 08/nov): Remarcar abre o portal nos horários do mesmo médico e modalidade (troca o link de hoje); Cancelar segue na conversa, com confirmação** |
| I8 | Retorno e exames (revê a RD5) | **Decidido (cliente, 08/nov): os dois também no portal.** Botão **Retorno** no início do portal; o portal confere quais consultas dão direito a retorno (mesmas regras do bot, Fase 17: última consulta na agenda, não domiciliar, um retorno por consulta, sem atendimento futuro na agenda, dentro do prazo); sem nenhuma, avisa que o prazo do retorno acabou e, se precisar, falar com a recepção. **No prazo do retorno, os dias em que a agenda do profissional está bloqueada não contam** (hoje: data da consulta + N dias corridos, `returnLastDate`, `appointments.ts:267`). Telas de retorno e exames ainda sem desenho: rodada 4 no canvas antes de implementar |
| I9 | Quais dias bloqueados saem do prazo do retorno | **Decidido (cliente, 08/nov): só dias bloqueados inteiros** (o bloqueio cobre todo o horário de atendimento da agenda naquele dia); bloqueio de parte do dia não muda o prazo; feriados não entram. Vale no portal, no bot e no "Marcar retorno" da Agenda (uma função só) |
| I10 | Como o Portal entra nos planos de venda | **Decidido (cliente, 08/nov): item próprio no Básico**, sem mudar o preço (Básico: Portal, Bot, Lembrete e Resumo do dia) |
| I11 | Métricas › Retomar contato com o prazo do retorno da I9 | **Decidido (cliente, 08/nov): sim, igual ao bot, já na F1** (função `app.return_last_date` no banco, usada por `metrics_return_rights`) |

Decidido (cliente, 09/nov; proposta, seção 17): a antecedência da RD10 vale só no portal; cancelar pelo WhatsApp segue sem prazo.

## 7. F1 feita (08/nov/2026, branch `recepcao-f1`)

Migração `20270102120000_portal_fundacao.sql`:

- **Matriz:** item `portal` ("Portal de agendamento", área Agenda); `whatsapp_bot` depende dele; a migração liga o
  Portal em toda clínica com o bot (I6). Planos: Portal no Básico (I10). Texto do item em Sistema › Matriz.
- **Apelidos:** `clinics.portal_slug` (só o Suporte, `set_clinic_portal_slug`; formato e endereço único conferidos;
  tela do Suporte na F2a) e `professionals.portal_slug` (automático pelo nome, sem acento, `-2` se repetido, nunca
  muda; os de hoje preenchidos na ordem do cadastro). `professionals.show_in_portal` (tela na F3).
- **Particular e convênios:** `professionals.accepts_private` (função `set_professional_accepts_private`: quem mantém
  convênios ou o próprio profissional) e `professional_insurance_plans.note` (até 300 caracteres; trilha
  `note_updated`). Tela: cartão "Particular e convênios" no cadastro do profissional (antes "Convênios atendidos"),
  com "Atende particular" e a observação de cada convênio marcado; recusa sem particular e sem convênio.
- **Bot (até a F3):** profissional só convênio não pergunta "particular ou convênio" e vai direto ao plano; plano não
  atendido não oferece particular (avisa e oferece a recepção). Jornada do bot atualizada.
- **Canal e origem:** `action_channel` ganha `portal`; `appointments.portal_entry` e `portal_place`; trilha "pelo
  portal de agendamento".
- **Prazos:** `clinic_settings.portal_hold_minutes` (3 a 10, padrão 5) e `portal_cancel_lead_hours` (padrão 24).
- **Prazo do retorno (I9):** `blockedDays.ts` acha os dias em que os bloqueios cobrem todo o horário de atendimento
  da agenda; `returnLastDate` não os conta. Vale em `findReturnOrigin` (bot, Marcar, link de agendar, remarcar) e no
  "Marcar retorno" da Agenda (`returnReady.ts`). Métricas › Retomar contato também (I11, abaixo).

**Movido (Claude, 08/nov):** a fila de confirmação vai para a F2c e as funções únicas de horários para a F2a, onde
são usadas (criar antes, sem uso, só arriscava retrabalho). **Fica para a F3:** "Informações › Convênios" do bot
não diz que o profissional não atende particular.

**Revisão de código (08/nov, `/code-review`):** corrigidos o apelido com hífen no fim (corte em 60), o apelido
repetido no preenchimento dos atuais ("Ana", "Ana 2", "Ana" → ana, ana-2, ana-2-2; os novos pulam o que existe), o
canal `portal` na trilha (`appointment_events`), o plano desativado contando como convênio, a ordem da gravação
(particular antes das ligações), o só convênio sem plano ativo (vai para a recepção) e o custo dos dias bloqueados
(só os dias tocados por bloqueio). Sem efeito: "Primeiro horário" com particular (desde a MS não junta
profissionais). Métricas › Retomar contato (e o Relacionamento, que usa a mesma função) passou a descontar os dias
bloqueados inteiros (I11): `app.return_last_date` e `app.is_whole_blocked_day`, com a mesma regra do código (um teste
confere que as duas contas dão o mesmo dia).

Testes: unidade (matriz, planos, dias bloqueados, prazo), banco (`portal-fundacao.test.ts`, retorno com bloqueio em
`marcar-retorno.test.ts`, só convênio em `bot-convenio.test.ts`) e Playwright no cartão (390 e 1280 px; salvar só
convênios com observação; erro sem nenhuma opção com as escolhas preservadas; correção sem repreencher).

### 7.1 Roteiro de validação da F1 (staging)

1. Sistema › Matriz de uma clínica: o item "Portal de agendamento" aparece; desligá-lo desliga o bot; clínicas que
   tinham o bot estão com o Portal ligado.
2. Configurações › Profissionais › um profissional: cartão "Particular e convênios"; desmarcar "Atende particular",
   marcar um convênio com observação e salvar ("Salvo: só convênios."); desmarcar tudo e salvar mostra o erro.
3. No WhatsApp de testes, marcar consulta com esse profissional: o bot vai direto a "Qual é o seu convênio?";
   "Outro convênio" não oferece particular.
4. Agenda: bloquear um dia inteiro de um profissional dentro do prazo de retorno de uma consulta; o "Marcar retorno"
   e o bot aceitam o retorno um dia a mais.

**Validação (cliente, 08/nov/2026):** os 4 passos conferidos no staging, sem ajustes. Passo 3 feito com uma consulta
que só o profissional "só convênio" faz (o bot olha todos os profissionais do serviço: se algum atende particular,
a pergunta "particular ou convênio" continua, como previsto). Passo 4 com prazo de 5 dias, consulta em 07/11 e
10/11 bloqueado o dia inteiro: retorno até 13/11 no "Marcar retorno" (aviso "Fora do prazo" só depois) e no bot.

## 8. D4 feita: retorno e exames no portal (08/nov/2026) [Cliente]

Rodada 4 no canvas (https://claude.ai/artifact/Npzjm2Vixb3UnEuUWfiAmb, fileiras "Rodada 4: retorno no portal" e
"Rodada 4: exames no portal"), revisada tela por tela e aprovada. Sem código.

- **Início (P1):** botões "Agendar consulta" (principal), "Marcar retorno", "Marcar exame" e "Minhas consultas", cada
  um com uma linha de explicação. "Marcar exame" só aparece na clínica com exames; "Marcar retorno", só com o serviço
  de retorno. Recusada: exames dentro da lista de especialidades.
- **Retorno, caminho:** Retorno → (celular e código, se não veio do WhatsApp) → "De qual consulta é o retorno?" →
  dias e horários → revisão → P10 "Retorno marcado". Três passos; não pergunta atendimento nem paciente (vêm da
  consulta); nunca mostra valor. Com uma só consulta com direito, pula a lista.
- **Lista do retorno:** um cartão por consulta com direito (paciente, médico, data da consulta, "Retorno até
  {dia}"); embaixo, as consultas sem direito com o motivo (prazo acabou, retorno já marcado...). Só o prazo, sem a
  linha que explica os dias bloqueados a mais.
- **Horários do retorno:** só os dias até o fim do prazo; quadro "Nenhum horário serve?" só com "Falar com a
  recepção".
- **Prazo acabou:** última consulta e até quando valia; botão principal "Agendar consulta com {o mesmo médico}" (abre
  com o médico escolhido) e "Falar com a recepção". Outros motivos com os textos do bot (domiciliar, retorno já
  marcado; atendimento futuro: "Ver minhas consultas").
- **Exames, caminho:** exame → P5 particular ou convênio (todos os convênios) → dias e horários (agenda de Exames) →
  celular e código → P8 → P9 com o preparo → "Exame marcado". Busca a partir de 8 exames; cartão com valor, duração e
  etiqueta do preparo.
- **Preparo:** quadro antes dos dias na tela de horários do exame; também na revisão, na tela final (com o PDF,
  quando há arquivo) e na confirmação.
- **.ics do exame:** "Exame {nome} — {Clínica}" e o endereço (complementa a I4).

## 9. F2a feita (08/nov/2026, branch `recepcao-f2a`)

Migração `20270103120000_portal_escolha.sql`:

- `resolve_portal_clinic(slug)`: a plataforma acha a clínica pelo endereço (como o link de agendar); o resto da página
  usa a credencial limitada à clínica.
- Apelidos reservados: profissional com o nome de um passo do portal (`especialidade`, `medicos`, `recepcao`...)
  ganha o `-2`; a clínica não pode ter um endereço do sistema (`admin`, `api`, `portal`...; erro `portal_slug_reserved`).
- Foto do profissional lida pela credencial da clínica (só `<clínica>/profissionais/...`; a da equipe, não).

Código:

- **Endereço:** `agendar.` e `agendar-teste.` servem só o portal (`/{clínica}/…` → páginas `/portal/{clínica}/…`,
  pelo middleware e pela rota `[...caminho]`, que pega o caminho sem página; nos outros endereços ela mostra a 404 de
  sempre). O painel e o `/api` não abrem no endereço do portal. No painel e no local, o portal fica em `/portal/{clínica}`.
- **Telas** (canvas aprovado, cor da clínica, 390 e 1280 px): P1 (início com "Agendar consulta", especialidades,
  "Ver médicos, convênios e valores", endereço e horário da recepção), P2 (busca pelo nome e pelos termos da
  especialidade, "Já sei o nome do médico"), P3 (cartões até 5, lista compacta com 6 ou mais, filtro "Atende meu
  convênio", busca pelo nome, sem horário = cartão sem toque), P5 (particular com valor e convênios com a observação;
  uma opção só = pulada), P6 (tipo de consulta quando há mais de um, faixa de dias, horários por turno, resumo ao lado
  no computador e barra fixa no celular), P11 (folha com a mensagem pronta e o número), P13 (link não encontrado; os
  estados "vencido" e "já usado" ficam prontos para os links da F3) e "Agendamento indisponível" (item desligado ou
  clínica suspensa). Link do profissional (início dele, sem outros médicos, "Passo n de 4"); clínica de um só
  profissional abre direto nele.
- **Regras:** quem aparece segue o catálogo do bot (ativo, "Mostrar no portal", Consulta individual com horário num
  local da clínica; domiciliar, turma, retorno e exames fora). Horários pelas mesmas funções do bot e do Marcar
  (`agenda/slots.ts`), no prazo do profissional. As escolhas ficam no endereço (`de`, `esp`, `conv`, `nome`, `mod`,
  `tipo`, `date`): o Voltar da tela e o do navegador voltam com elas.
- **Depois do "Continuar":** o horário é conferido de novo (ocupado: volta ao mesmo dia com o aviso). Como a
  identificação (F2b) e a marcação (F2c) não existem, a tela mostra o escolhido e "Pedir este horário no WhatsApp".
  Nada é gravado.
- **Suporte:** Sistema › Clínicas › clínica › "Portal de agendamento": o endereço da clínica (sugestão pelo nome) e o
  link para abrir.
- **Ficam para depois:** "Marcar retorno", "Marcar exame" e "Minhas consultas" no início (F2c/F2d); o código da sessão
  na mensagem da recepção ("parou em {etapa}", F6); o aviso da carteirinha (não há configuração para isso).

**Revisão de código (08/nov, `/code-review`):** corrigidos o profissional sem particular e sem convênio ativo (aparecia
e travava na P5; agora fica fora do portal), os links da faixa de dias e do tipo de consulta (saíam com `/portal` no
endereço público), a rota `[...caminho]` (só a 404; quem leva ao portal é o middleware), a lista de endereços
reservados repetida no código (fica só no banco) e a clínica que já tivesse um endereço reservado (a migração o tira).
Anotados, sem mudança agora: o custo do "próximo horário" de cada profissional a cada página (medir no staging com
muitos profissionais, como no risco da F5a); perfil e idade limite da agenda, que dependem do paciente (P8, F2c); um
caminho sem página no painel, sem login, agora leva ao login em vez da 404.

Testes: unidade (`portal.test.ts`: endereços, busca, passos, caminho, particular e convênio, textos), banco
(`portal-escolha.test.ts`: endereço e reservados, quem aparece, foto, horários, conferência do Continuar) e
Playwright em 390 e 1280 px (jornada, Voltar em cada tela, busca, filtro, horário ocupado, convênio inválido, folha da
recepção, estados de erro, tela do Suporte com erro e correção).

### 9.1 Roteiro de validação da F2a (staging)

1. Sistema › Clínicas › uma clínica com várias especialidades › "Portal de agendamento": salvar um endereço
   (ex.: `clinica-teste`). Tentar `admin` ou o endereço de outra clínica: aparece o erro no campo.
2. Abrir `agendar-teste.recepclinic.com.br/clinica-teste` no celular: início, "Agendar consulta", especialidade
   (buscar por um sintoma), médico (filtrar por um convênio), "Como será o atendimento?", dia e horário,
   "Continuar". Conferir o "Voltar" de cada tela (volta com o que foi escolhido) e o botão "Recepção".
3. No computador, o mesmo caminho: resumo "Seu agendamento" ao lado, com "Trocar".
4. Link do profissional: `agendar-teste.recepclinic.com.br/clinica-teste/{apelido}`. O apelido sai do nome (sem
   acento, ex.: `dr-mateus`) e o painel só mostra o link na F3 (Configurações › Portal, "Copiar link"); até lá, o
   Claude lista os do staging. Sem outros médicos e sem "Trocar".
5. Sistema › Matriz: desligar o "Portal de agendamento" da clínica: o endereço mostra "Agendamento indisponível".
   Religar.
6. `agendar-teste.recepclinic.com.br/admin` e um endereço inexistente: "Link não encontrado" (o painel não abre).

## 10. F2b feita (08/nov/2026, branch `recepcao-f2b`, sobre a F2a)

Cliente (08/nov): sem staging a cada etapa; F2a, F2b e as próximas são validadas juntas no staging depois (muda a I3).

Migração `20270104120000_portal_identificacao.sql`:

- **Sessão** (`portal_sessions`): cookie opaco `rc_portal` (2 h, HttpOnly, SameSite=Lax, Secure fora do local); o
  banco guarda só o hash; IP só truncado (IPv4 /24, IPv6 /48).
- **Código** (`portal_codes`): 6 números, só o hash (preso à sessão), 10 min, 5 tentativas (conferidas no banco com a
  linha travada, `portal_code_attempt`), reenvio depois de 60 s, o anterior deixa de valer.
- **Limites** (`portal_rate_hits`, `portal_blocks`, função `portal_rate_hit`): código 3 por celular e 10 por IP por
  hora; tentativas de código 30 por IP e 15 por sessão por hora; consultar horários 300 por IP e 60 por sessão em
  10 min; reservas 30 por IP por hora e 5 por celular em 24 h. Passou do limite: bloqueio 15 min, de novo no dia
  1 h, outra vez 24 h (nunca permanente); a contagem recomeça depois de cada bloqueio. `portal_release_block`: a
  Recepção ou o Administrador libera (tela na F6, com o monitor).
- **Reserva** (`slot_holds`, `portal_hold_slot`): só com o celular comprovado; trava por agenda; confere atendimentos
  ativos e reservas de outras sessões; o mesmo horário de novo devolve a mesma reserva; a nova, se der certo, solta a
  anterior; prazo `portal_hold_minutes` da clínica (padrão 5). O portal não mostra horário reservado por outra sessão;
  bot e Marcar ainda não olham as reservas (a marcação da F2c confere de novo).
- **Modelo do código**: `portal_code` (`rc_codigo_portal_v1`), template de autenticação da Meta (texto fixo, aviso de
  segurança, validade 10 min, botão "Copiar código"); em uso com o item Portal; não personalizável. O Suporte cria na
  conta da clínica como os outros (Configurações › WhatsApp) e a Meta aprova (pendência da seção 4).
- **Limpeza diária** (`limpar-portal`, 03:25): contagens com mais de 2 dias, bloqueios vencidos há 30 dias e sessões
  com mais de 30 dias (códigos e reservas vão junto). Tabelas novas com o registro do Suporte e o bloqueio de clínica
  suspensa, como as demais.

Telas (canvas, 390 e 1280 px):

- **P7** (`/{profissional}/continuar`): "Qual é o seu celular com WhatsApp?" com o CAPTCHA (Turnstile, só na entrada
  direta, RD9) → "Mandamos um código…" com o campo do código (colar funciona), "Reenviar código em 0:59",
  "Trocar número" e os erros da especificação (número inválido, código incorreto com as tentativas, venceu, muitas
  tentativas, bloqueio). Celular já comprovado na sessão: vai direto à reserva. No `npm run dev`, sem WhatsApp de
  verdade, o código aparece na tela (nunca no build).
- **Reserva** (`/{profissional}/reserva`): "Reservamos este horário por 4:59" (anunciado no último minuto), o resumo e
  o celular confirmado; o Voltar solta a reserva; vencida, "O tempo da reserva acabou". Até a F2c, a tela leva o
  pedido à recepção pelo WhatsApp.
- **Variáveis:** `PUBLIC_TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` (as duas ou nenhuma; local com as chaves de
  teste da Cloudflare, já no `.env.example`). CSP: script e moldura de `challenges.cloudflare.com` (conferir no
  staging, a CSP só existe no build).

**Revisões (08/nov):** `security-review` sem achados de risco alto ou médio. `/code-review`: corrigidos o bloqueio de
15 min que virava 1 h (a contagem não recomeçava), as tentativas do código ao mesmo tempo (passavam de 5), a reserva
que falhava soltando a atual, a página recarregada gastando o limite de reservas do dia, o IPv6 comprimido no
`/48`, a reserva aberta com outro profissional no endereço, o celular comprovado que pedia o código de novo quando
a reserva não saía, o limite gasto quando a clínica não tem como mandar o código e a limpeza das tabelas. Anotado:
"Reenviar código" não pede o CAPTCHA de novo (contido pelos limites de 3 por celular e 10 por IP por hora).

Testes: unidade (`portalIdentity.test.ts`, env, templates), banco (`portal-identificacao.test.ts`: limites e bloqueio
progressivo, código, tentativas simultâneas, reserva, concorrência, recarregar, Trocar número; isolamento, suspensão e
envio dos templates atualizados) e Playwright (celular inválido com o valor mantido, CAPTCHA de teste, código
errado e certo, reserva com contador, outro paciente sem o horário reservado, Voltar soltando, sessão comprovada
reservando direto). Fora do portal: `nao-atendimento-central.test.ts` (mensagens novas) falha às vezes conforme a
hora; falha igual sem a F2b.

### 10.1 Roteiro de validação da F2b (staging, junto com a F2a)

1. Configurações › WhatsApp (Suporte), card "Templates (Suporte)": "Código do portal" **Aprovado** (conta do
   RecepClinic, seção 14; nada a criar na clínica).
2. No portal, escolher um horário e "Continuar": digitar um celular fixo (erro), depois o celular do teste; o CAPTCHA
   passa sozinho; chega o código no WhatsApp com "Copiar código".
3. Digitar um código errado (avisa as tentativas) e depois o certo: "Reservamos este horário por 4:59".
4. Em outro celular ou janela anônima, o mesmo dia: o horário reservado não aparece. Voltar na primeira janela: ele
   volta a aparecer.
5. Esperar o contador acabar: "O tempo da reserva acabou".

## 11. F2c feita (08/nov/2026, branch `recepcao-f2c`, sobre a F2b)

Migração `20270105120000_portal_marcacao.sql`:

- **Paciente do portal:** `patients.created_via = 'portal'`; conta no limite de pacientes novos do telefone junto com
  o bot (`countBotNewPatients`). Selo "Cadastrado pelo portal" na ficha.
- **Reserva com quem será atendido:** `slot_holds.patient_id` (escolhido na P8) ou `new_patient` (dados da P8b, só
  gravados na marcação), `informed_birthdate`, `confirming_at` (a marcação é tomada uma vez: duplo toque não marca
  duas vezes) e `appointment_id` (recarregar mostra a mesma confirmação). A credencial da clínica grava só essas
  colunas.
- **Data de nascimento a conferir** (`portal_birthdate_checks`; função `resolve_portal_birthdate_check`, equipe da
  clínica): "Corrigir para {data}" ou "Manter {data}", com confirmação; resolvida, some da ficha e do atendimento.
- **Fila dos avisos** (`notice_queue`, chave única por atendimento e tipo): a confirmação sai na hora; o que ficou
  pendente sai pela rotina dos reenvios (minuto a minuto); envio travado há 10 min fica "deixado de lado" (sem mandar
  de novo). Falha de envio segue o reenvio automático das mensagens. Limpeza diária (`limpar-fila-avisos`, 03:35).

Telas (390 e 1280 px):

- **P8** (`/{profissional}/reserva`): "Para quem é a consulta?" com os pacientes do celular (nome completo, idade,
  "(você)") e "Outra pessoa"; sem cadastro no celular, vai direto à P8b. Confere idade limite do médico (com
  "Escolher outro médico" pela clínica), consulta já marcada com ele e os limites do bot (o de consultas futuras diz o
  número; os outros, "fale com a recepção"; o limite fica registrado para a equipe, como no bot).
- **P8b** (`/{profissional}/cadastro`): "Mim / Outra pessoa (filho, dependente)" (agenda Pediátrica ou celular que
  já é o próprio paciente: só outra pessoa); seu nome só com o celular sem cadastro; nome com sobrenome; data com as
  barras automáticas, por extenso e com a idade abaixo; menor de 18 não é "Mim". Nome parecido com paciente do mesmo
  celular: "É a mesma pessoa?" (mesma data) ou as três opções (data diferente); "É a mesma, mas a data certa é…" avisa
  na P9 que a recepção confere.
- **P9** (`/{profissional}/revisao`): médico e especialidade, atendimento (particular com valor ou o convênio com a
  observação), dia e hora, local com "Ver no mapa", paciente com a data por extenso, orientações do profissional,
  "Confirmação no WhatsApp, celular final 4321", "Alterar" em cada linha e o contador. Horário tomado: volta aos
  horários com o aviso.
- **P10** (`/{profissional}/marcada`): "Consulta marcada!", o resumo, "Adicionar à agenda do celular" (.ics por
  `/{profissional}/calendario`, só com a sessão; I4) e "Ver no mapa". "Precisa remarcar ou cancelar?" leva à recepção
  no WhatsApp até a F3 (Minhas consultas).
- **Agenda › atendimento aberto (R2):** a origem ("Portal · link do profissional, marcada pelo paciente em 08/11 às
  10:05", "WhatsApp · bot", "Recepção · {nome}") e o aviso "Data de nascimento a conferir", que abre a ficha.
- Indicador de passos ganha a Revisão. O envio único (`sendOnce`) passa a valer no portal.

**Revisões (08/nov):** segurança sem achados altos (telas e .ics presos à sessão; nada pessoal no endereço; paciente
sempre conferido contra o celular comprovado). Achado e corrigido nos testes: `app.is_clinic_member` dá null (não
false) para quem é de fora; a função de resolver usa `is not true`. Sem "carteirinha" (o bot não pede; a P8 da
especificação citava). Origem `portal_place` (Instagram, site…) fica para a F3, com os links. `/code-review`: corrigidos o
cadastro novo gravado de novo numa nova tentativa (a reserva passa a ter o paciente), o "Particular" que saía com o
convênio do cadastro, a confirmação fechada como "não conectado" quando o WhatsApp não carregou (fica pendente para a
rotina), o "Confirmando…" preso ao endereço (agora pela reserva), o "Para mim" de quem já tem o próprio paciente
desativado e os papéis da função de resolver. Mantido pela especificação: "Sim, é a mesma (manter a data)" também
abre a data a conferir (o paciente digitou outra).

Testes: unidade (`portalBooking.test.ts`, `bookingOrigin.test.ts`, passos), banco (`portal-marcacao.test.ts`:
cadastro para si e para outra pessoa, duplo toque, horário tomado, reserva vencida e de outra sessão, duplicado e data
a conferir, idade limite, consulta já marcada, fila e isolamento) e Playwright (jornada em 390 e 1280 px, dados
mantidos depois de erro, Voltar da P9, duplo clique, .ics sem sessão, recarregar, painel e ficha).

### 11.1 Roteiro de validação da F2c (staging, junto com a F2a e a F2b)

1. Pelo link de um profissional, escolher horário, confirmar o celular (sem cadastro na clínica): "Mim", nome sem
   sobrenome (erro, o resto fica), data 31/02 (erro), depois certo: revisão com tudo e "Confirmar agendamento".
2. "Consulta marcada!": chega a confirmação no WhatsApp; "Adicionar à agenda do celular" abre o evento com o médico e
   o endereço. Recarregar a página mostra a mesma confirmação.
3. Na Agenda, abrir o atendimento: "Portal · link do profissional, marcada pelo paciente em…".
4. Mesmo celular, outro dia: a P8 mostra o paciente "(você)"; escolher dá "já tem consulta com…".
5. "Outra pessoa" com o nome parecido de um paciente do celular e outra data: "É a mesma, mas a data certa é…";
   marcar; na Agenda, "Data de nascimento a conferir" → ficha → "Corrigir para…" (confirmação) e o aviso some.


## 12. F2d, parte 1: retorno no portal (09/nov/2026, branch `recepcao-f2d`, sobre a F2c)

A F2d foi dividida em duas partes (decisão técnica): **retorno** (esta) e **exames** (próxima, na mesma branch).

Migração `20270106120000_portal_retorno.sql`: a reserva guarda a consulta de origem (`slot_holds.return_origin_id`;
a credencial da clínica grava só essa coluna a mais).

- **Regras do bot (I8):** `returnVisit.ts` usa as mesmas funções do bot (`findReturnOrigin`,
  `evaluateReturnEligibility`, `findBlockingAppointment`): a última Consulta de cada paciente do celular em cada
  agenda de médico do portal com o serviço de Retorno; prazo pelo serviço, sem os dias bloqueados inteiros (I9).
  Retorno com médico fora do portal fica com a recepção. Limites do bot por telefone, como no `startReturn`.
- **Telas** (`/{clínica}/retorno/…`, 390 e 1280 px, canvas RT1a, RT2/DRT2, RT3, RT4, RT5):
  - Início (P1 e início da clínica de um profissional): "Marcar retorno" abaixo de "Agendar consulta", só com o
    serviço de retorno. O link do profissional (PP) fica sem o botão (a lista mostra médicos da clínica toda).
  - Sem o celular comprovado: "Qual é o seu celular com WhatsApp?" e o código (a P7 virou peça comum:
    `identityStep.ts` e `PortalPhoneCode.astro`; a P7 da consulta passou a usá-los, sem mudar o comportamento).
  - "De qual consulta é o retorno?": um cartão por consulta com direito ("Retorno até…", prazo mais curto primeiro);
    embaixo, as sem direito com o motivo. Uma só com direito: vai direto aos horários (o Voltar leva ao início).
  - Nenhuma com direito: o motivo principal na ordem do bot (domiciliar, já marcado, atendimento futuro, prazo). No
    prazo vencido, RT5 com "Agendar consulta com {médico}" (abre o atendimento dele) e "Falar com a recepção".
  - Horários: só até o fim do prazo (e do prazo do médico), nos locais do Retorno; "Nenhum horário serve?" só com a
    recepção. "Continuar" reserva com o paciente e a consulta de origem.
  - Revisão (sem valor) e "Marcar retorno" (uma vez só; recarregar mostra a mesma confirmação); "Retorno marcado!" com
    o `.ics` "Retorno com {médico} — {Clínica}".
- O atendimento sai pelo canal do portal, `portal_entry = clinic_link`, ligado à consulta de origem, com o convênio do
  cadastro (o retorno nunca fala de valor); a confirmação vai pela fila.
- Botão do cartão: "Marcar retorno de {primeiro nome}" (o canvas tinha "do João"/"da Maria"; o cadastro não diz o
  artigo).
- **Pendência para a F3:** apelidos de profissional iguais a uma rota do portal (`retorno`, `medicos`,
  `especialidade`, e `exames` na parte 2) esconderiam o profissional; hoje o apelido sai do nome (risco baixo). Na F3,
  quando o apelido ficar editável, recusar esses nomes.

- **"Trocar número"** na lista e na tela sem direito (achado no Playwright: sem ele, quem entrou com outro celular
  ficava preso até a sessão vencer).

**`/code-review` (09/nov), corrigidos:** reserva solta quando a consulta de origem não grava nela; sessão vencida ao
reservar volta ao celular; a marcação confere também o médico e o serviço da reserva; retorno que perde o direito no
meio (outro canal marcou) solta o horário e a lista avisa ("esse retorno não está mais disponível"); índice na chave
nova; a revisão confere o direito uma vez só por toque; origens buscadas ao mesmo tempo (clínica grande); o corte do
último dia numa função só (`scopeLastDate`); artigo do título ("com o", "ao") numa função só; a P7 lê a sessão uma
vez.

Testes: unidade (`portalReturn.test.ts`, título do `.ics`), banco (`portal-retorno.test.ts`: cartão e horários até o
fim do prazo, marcação ligada à origem, recarregar, duplo toque, prazo vencido, domiciliar, retorno marcado por outro
canal no meio, reserva de retorno recusada como consulta, outra sessão) e Playwright no computador local (jornada em
390 e 1280 px, celular inválido com o valor mantido, código errado, lista pulada com uma só consulta, Voltar de cada
tela, duplo clique, prazo vencido, "já marcado", P7 da consulta depois da mudança).

### 12.1 Roteiro de validação do retorno (staging, junto com a F2a a F2c)

1. Paciente com Consulta realizada há poucos dias com um médico que tem o serviço de Retorno. No início do portal,
   "Marcar retorno" → celular e código → (uma consulta só) direto em "Escolha o dia do retorno": só dias até o fim do
   prazo.
2. Escolher horário → "Confira o retorno" (sem valor) → "Marcar retorno" → "Retorno marcado!"; chega a confirmação no
   WhatsApp; na Agenda, o retorno ligado à consulta.
3. "Marcar retorno" de novo com o mesmo celular: "Não há retorno para marcar" (já marcado).
4. Celular com duas crianças com consulta recente e uma com prazo vencido: a lista com dois cartões e "1 consulta sem
   direito a retorno".
5. Celular só com consulta antiga: "O prazo do retorno acabou" → "Agendar consulta com…" abre o médico.

## 13. F2d, parte 2: exames no portal (09/nov/2026, branch `recepcao-f2d`)

Sem migração. O exame passa pelas telas da consulta (P5 a P10 e o `.ics`) como um "profissional" do portal
(`examProfessional`, endereço `/{clínica}/exame-1a2b3c4d/…`, o começo do id do serviço): agenda da equipe, só o exame
escolhido, valor e duração dele, sem idade limite, sem orientações do profissional.

- **Quais exames:** serviço do tipo Exame, individual (a turma fica fora), na agenda da equipe, com horário num local
  da clínica, e só com o item "Exames e procedimentos" da Matriz. **Convênio:** todos os planos ativos, com o item
  Convênios (como o bot: agenda sem profissional aceita todos); particular sempre.
- **Telas** (390 e 1280 px, canvas EX1 a EX3):
  - Início: "Marcar exame" abaixo de "Marcar retorno", com os dois primeiros exames na linha de explicação.
  - EX1 "Qual exame você vai fazer?": cartão com valor (particular ou convênio), duração e a etiqueta "Tem preparo" /
    "Sem preparo"; busca a partir de 8 exames; "Falar com a recepção" no fim.
  - Particular ou convênio (P5), dias e horários (P6) com o quadro "Preparo do exame" antes dos dias, celular e
    código (P7), "Para quem é o exame?" (P8/P8b), revisão (P9) com o preparo e "Exame marcado!" (P10) com "Antes do
    exame" e "A confirmação e o preparo chegam no WhatsApp". O link do arquivo (PDF) do preparo usa a página pública
    `/preparo/…` (no endereço do sistema).
  - Textos: "Exame" no lugar de "Médico", "o exame" no lugar de "a consulta", "Trocar o exame", "Ver outro exame"; a
    folha da recepção sem "do médico".
  - `.ics`: "Exame {nome} — {Clínica}" (D4 e I4).
- **Regra do bot:** o mesmo exame já marcado para o paciente impede outro ("já tem o exame … marcado"); os limites do
  telefone valem igual. O preparo sai pelo WhatsApp depois da confirmação (já era assim, `preparation.ts`).
- Fica para depois (sem dado cadastrado): a etiqueta do preparo com o resumo ("Jejum de 8 horas", canvas) e
  "Traga o pedido médico" no convênio.

**`/code-review` (09/nov), corrigidos:** a reserva de um exame valia na tela de outro exame (todos dividem a agenda da
equipe), o que deixava marcar de novo o mesmo exame: a reserva agora só vale na tela do exame dela (P8 a P10 e a
marcação); cada exame mostra só os locais dele; valor que muda com o local sai "a partir de"; o início e a lista
mostram só exames com horário livre no prazo (sem telas até "sem horários"); sem horário de consulta mas com retorno
ou exame, o aviso fala só da consulta, e "Ver médicos" some sem médicos; o endereço do exame mantém os parâmetros; o
preparo tira `*` e `_` só de palavras inteiras (endereços e nomes de arquivo ficam como estão); as palavras "consulta" ×
"exame" numa função só (`visitWords`).

Testes: unidade (título do `.ics` do exame), banco (`portal-exames.test.ts`: só o exame individual da equipe, com o
preparo, resolvido pelo endereço; sem o item da Matriz, nenhum; marcação pelo convênio para cadastro novo; o mesmo
exame não se marca de novo; sem idade limite; a reserva de um exame recusada na tela de outro) e Playwright no computador local (jornada em 390 e 1280 px até "Exame
marcado!", duplo clique, `.ics`, "Trocar o exame", Voltar em cadeia até o início, aviso do exame já marcado).

### 13.1 Roteiro de validação dos exames (staging, junto com a F2a a F2d)

1. Clínica com o item "Exames e procedimentos" e exames na agenda da equipe: no início, "Marcar exame" → lista com
   valor, duração e preparo.
2. Exame com preparo → convênio → o quadro do preparo antes dos dias → horário → celular e código → paciente →
   revisão com o preparo → "Exame marcado!"; chegam a confirmação e o preparo no WhatsApp; o evento do celular diz
   "Exame {nome} — {Clínica}".
3. O mesmo exame de novo para o mesmo paciente: "já tem o exame … marcado".
4. Exame em turma (grupo) não aparece; desligar o item na Matriz some com o botão.

## 14. Código do portal pelo número do RecepClinic (cliente, 09/nov/2026) [Cliente]

Na validação da F2b no staging, "Criar na Meta" recusou só o `rc_codigo_portal_v1`: *"This WhatsApp business account
does not have permission to create message template"*. Os outros 16 templates (utilidade) foram aprovados. Causa
provável, não confirmada na documentação oficial: a Meta só libera template de **autenticação** para portfólio com a
**verificação da empresa** feita (fornecedores como Vonage e MSG91 dizem isso; a página oficial dos templates de
autenticação não lista requisitos). Na produção, cada clínica conecta o número no portfólio dela: exigir a verificação
de cada uma travaria o portal das clínicas pequenas.

- **Decisão (cliente, 09/nov):** opção 1. O código sai de **um número do RecepClinic** (empresa do RecepClinic
  verificada uma vez), para todas as clínicas; o texto do código é fixo da Meta, sem o nome da clínica. Muda a RD2.
- **Verificação da empresa de cada clínica** continua recomendada, pelo volume: sem ela, a Meta limita a ~250
  pacientes por dia as mensagens iniciadas pela clínica (lembretes, confirmações). Passo da implantação (09/nov): o
  Suporte guia o dono a pedir a verificação **na sessão de conexão**; o guia "Antes de conectar" pede os documentos da
  empresa e o item do checklist do Suporte diz isso (`business_verification`, recomendado).
- **A aprovação dos templates não vence**, mas pode cair por qualidade (bloqueios e denúncias), por reclassificação
  da categoria ou por regra nova da Meta; a situação chega pelo webhook e aparece em Configurações › WhatsApp.
- **Feito com o cliente (09/nov):**
  - A empresa do RecepClinic **já é verificada** (portfólio "RecepClinic", `2975361582847128`). O staging usa o
    portfólio "Consultório de teste" (`1135158332268067`, não verificado): é o caso típico de clínica, por isso o
    template foi recusado lá.
  - **Número dos códigos:** +55 61 9656-4772, só na API (nunca abrir no app do WhatsApp), conectado e com o código
    verificado; nome de exibição "RecepClinic" em análise. ID do número `1380810041790028`; **conta de mensagens**
    (modelo novo da Meta, set–out/2026: a "conta do WhatsApp" guarda o número e a "conta de mensagens" guarda os
    templates e o pagamento; o ID dela é o antigo WABA ID) `1608311683725577`. Cartão do RecepClinic como padrão nela.
  - Usuário do sistema **recepclinic-codigos** (função Funcionário: o portfólio só aceita 1 administrador), token
    permanente com `whatsapp_business_messaging` e `whatsapp_business_management`.
  - Variáveis `WHATSAPP_CODE_PHONE_NUMBER_ID`, `WHATSAPP_CODE_WABA_ID`, `WHATSAPP_CODE_TOKEN`: **feitas (cliente,
    09/nov)** no `.env.staging`, no `.env.production` e na Vercel dos dois projetos (o número e a conta servem aos dois
    ambientes).
  - **Template `rc_codigo_portal_v1` criado na conta do RecepClinic e APROVADO na hora** (id `1014112705045978`,
    autenticação); vale para staging e produção.
- **Achado: a versão da API.** Numa chamada feita à mão pela **v21.0**, a conta de mensagens criada no modelo novo
  "não existe" (erro 100, subcódigo 33); da v22.0 em diante, aparece. **O sistema já usa a v24.0** desde a CN8
  (`GRAPH_API_VERSION` em `graph.ts`, conferido em 09/nov): nada a mudar. Nosso código não usa
  `paid_messaging_account_id` (a Meta tira em 31/dez/2026).
- **Feito (09/nov, itens 2 e 3, com o OK do cliente):**
  - O código sai pelo número do RecepClinic: `codeSender.ts` (remetente da plataforma, pelas três variáveis
    `WHATSAPP_CODE_*`, validadas em `env.ts`: as três ou nenhuma). `sendCode` não lê mais o WhatsApp nem os templates
    da clínica; sem as variáveis ou com recusa da Meta, "indisponível" (a página leva à recepção).
  - `rc_codigo_portal_v1` saiu dos templates das clínicas (`PORTAL_CODE_TEMPLATE`, fora do `DEFAULT_TEMPLATES`): o
    "Criar na Meta" não o pede, a lista do Suporte e a situação da implantação não o contam.
  - Configurações › WhatsApp, card "Templates (Suporte)", nas clínicas com o Portal: a situação do template na conta do
    RecepClinic, perguntada à Meta na hora (aprovado, em análise, recusado com o motivo, não criado, número não
    configurado ou sem resposta da Meta). Só o Suporte vê: a captura `config-whatsapp` (Administrador) não muda.
  - Testes: `codeSender.test.ts` (envio, recusa 131042, situação), `env.test.ts`, templates e `envio-whatsapp` (13
    templates criados, sem o código). 1180 de unidade, 1127 de banco (1 instável da NA4, passa sozinho 3 vezes), check.
- **Feito (09/nov, depois, com o OK do cliente):**
  - Tela do código no portal (`PortalPhoneCode.astro`): "A mensagem chega do RecepClinic, o sistema de agendamento da
    clínica." no pedido do celular e no aviso do código enviado (o paciente sabe de quem procurar a mensagem).
  - Item 4: guia "Pagamento na Meta" com a seção "Se aparecer 'Contas de mensagens'" (o cartão vai na conta de
    mensagens) e o ID dela na mensagem para o suporte da Meta.
- **Falta:** staging (push da `main`, sem migração); a validação da F2 segue do passo 2 do roteiro (código), confirmando
  no 1º envio que o cartão do RecepClinic funciona (sem o erro 131042); depois a F3.
- **Validação (09/nov): o código não chegou** ao celular pessoal do cliente, mas a Meta aceitou o envio (o código ficou
  gravado). A conta do número dos códigos não tinha o app inscrito, então o aviso de entrega não chegava. Feito: o
  webhook manda a falha de entrega desse número para Sistema › Erros ("código do portal não entregue", com o motivo da
  Meta; `cc45117`) e o app foi inscrito na conta `1608311683725577` com o desvio para o webhook do **staging**.
  **Atenção na produção:** inscrever de novo **sem** o desvio (senão os avisos vão para o staging).
- **Validação da F2 (09/nov): roteiros 9.1 a 13.1 validados pelo cliente**, menos "Adicionar à agenda do celular" no
  iPhone ("Não encontrado": o Calendário baixa o .ics sem o cookie da sessão). Corrigido (`802d700`): o .ics vale pelo
  id da reserva marcada (aleatório) até o fim do atendimento, "inline" no iPhone, sem o atributo `download`; conferido
  no staging sem cookie. **Validado pelo cliente no iPhone (09/nov). F2 inteira validada.**
- Mensagem do Suporte depois de "Criar na Meta" e "Atualizar situação" (09/nov): só os templates pendentes, os não
  enviados primeiro com a resposta da Meta (`templateSummary.ts`).

## 15. F3: plano em partes (09/nov/2026)

Divisão técnica (como a F2), na branch `recepcao-f3`:

| Parte | O que entrega |
|---|---|
| **F3a Link do bot no portal** | `agendar…/s/{token}`: abre o portal com o celular da conversa já comprovado (sem código), "Agendando pelo número ·· 4321" e "Usar outro número"; 30 min, uma marcação, revogado ao emitir outro; vencido/usado → P13 |
| **F3b Bot leva ao portal** | Marcar consulta, Marcar retorno e Marcar exame mandam o link (acaba a marcação no chat); textos e jornada do bot (`botJourney.ts`) |
| **F3c Minhas consultas** | P12 no portal (Remarcar com o mesmo médico e modalidade, Cancelar com confirmação, RD10 só no portal); Remarcar do bot e dos lembretes abre o portal; Cancelar segue no chat |
| **F3d Links e Configurações › Portal** | Configurações › Portal (Administrador), "Copiar link para…" (`?de=`, grava `portal_place`), QR com cartaz A4, antecedência (RD10), "Mostrar no portal"; apelidos reservados (`retorno`, `exames`…) |
| **D5 + F3e Domiciliar e turma no portal** | Desenho no canvas (endereço do domiciliar, escolha da turma), aprovação tela por tela, depois o código |
| **Fechamento** | "Informações › Convênios" diz quem não atende particular (pendência da F1); `security-review`, `/code-review`, staging e roteiro de validação |

Decisões do cliente pedidas antes do código (uma por vez): seção 15.1.

### 15.1 Decisões da F3

| # | Pergunta | Decisão |
|---|---|---|
| F3-1 | Atendimento domiciliar e em turma (o portal não marca) | **Decidido (cliente, 09/nov): entram no portal** (endereço do domiciliar e turma). Telas novas: rodada no canvas (D5) e aprovação antes do código; nova parte **F3e** |
| F3-2 | "Encaixe ou antecipar" sem consulta marcada | **Decidido (cliente, 09/nov): o link abre o portal, que marca e põe na lista de espera** (como hoje); aviso "Se vagar um horário mais cedo, avisamos no WhatsApp" nos horários e na revisão |
| F3-3 | Links da página antiga `/agendar/…` (Remarcar do lembrete, remarcação após cancelamento pela clínica, pedido não concluído) | **Decidido (cliente, 09/nov): todos abrem o portal.** Os já enviados valem até vencer (no máximo 2 dias); depois a página antiga sai. Retorno cancelado pela clínica segue sem o limite do prazo |
| F3-4 | O "Remarcar" do WhatsApp (bot e lembrete), que abre o portal, respeita a antecedência da RD10? | **Decidido (cliente, 10/nov): não**; o link do bot remarca a qualquer hora (como o cancelar pelo WhatsApp). O prazo vale só para quem entra direto em Minhas consultas |
| F3-9 | Quando a F3f (fim da marcação pelo chat) vai ao ar? | **Decidido (cliente, 10/nov): depois da F3e validada no staging, do portal ligado na clínica piloto em produção e das 3 primeiras marcações reais pelo portal sem problema** (sai o prazo de ~2 semanas; seção 15.4) |
| F3-5 | Bot sem link do portal (sem endereço, erro, clínica suspensa) depois da F3f | **Decidido (cliente, 10/nov): passa para a recepção** (conversa em Aguardando) |
| F3-6 | Fim do "Primeiro horário disponível"? | **Decidido (cliente, 10/nov): acaba**; o portal mostra o próximo horário de cada médico |
| F3-7 | Profissional "Fora do portal" no bot depois da F3f | **Decidido (cliente, 10/nov): passa para a recepção** |

### 15.2 F3a feita (09/nov/2026, branch `recepcao-f3`)

Migração `20270107120000_portal_links.sql`: `portal_links` (token = id, 22 caracteres no endereço; celular da conversa,
finalidade `book`/`return`/`exam`/`reschedule`/`my_appointments`, profissional ou exame, 30 min, uma marcação, um novo
do mesmo celular e finalidade revoga o anterior; colunas de remarcar, encaixe e funil já prontas para F3b/F3c),
`portal_sessions.link_id`, `resolve_portal_link_clinic` (só a plataforma) e a limpeza diária (30 dias).

- `/s/{token}` (`agendar…/s/…`; local `/portal/s/…`): válido abre uma sessão nova com o celular comprovado e leva ao
  atendimento do profissional escolhido na conversa (P5), ao retorno, ao exame ou ao início; vencido/trocado "Este
  link não vale mais" (410), usado "Este link já foi usado" (410), inexistente 404; portal desligado ou clínica sem
  endereço do portal: "Agendamento indisponível".
- P7 pulada; "Passo n de N" sem o celular. P8/P8b: "Confirmação no WhatsApp, celular final 0123" e "Usar outro
  número" (posta "trocar" na P7 do mesmo horário: solta a reserva, esquece o celular e o link, pede o código).
- Marcação (consulta, exame, retorno) por sessão do link: `portal_entry = whatsapp` e o link fica usado.
- **Para a produção:** toda clínica com bot precisa do endereço do portal (Suporte) antes da F3b subir.

Testes: banco (`portal-links.test.ts`), unidade (`portal.test.ts`), Playwright local (390 px: link → P5 "Passo 1 de 4"
→ horário → P8b com o celular → "Usar outro número" → P7 com o mesmo horário; 1280 px: vencido; estados por HTTP).

### 15.3 F3b, F3c e F3d feitas (09 e 10/nov/2026, branch `recepcao-f3`)

- **F3b (`d7166b4`):** Marcar consulta, retorno, exame e o "Encaixe ou antecipar" sem nada marcado mandam o link do
  portal (`bot/portalLink.ts`); o chat só marca onde o portal ainda não cobre (clínica sem endereço do portal ou com o
  Portal desligado, profissional fora do portal, domiciliar, turma, exame de agenda de profissional). Encaixe (F3-2):
  aviso no link, nos horários e na revisão; a marcação entra na lista de espera. Funil do bot pelo portal (link_sent,
  page_opened, link_expired, confirmed). Pedido não concluído do link do portal ("Não concluímos a sua marcação").
  Mensagem personalizável "Link para marcar" sem `{paciente}`.
- **F3c (`e5cc880`):** P12 `/{clínica}/minhas-consultas` (celular e código ou link do bot), Remarcar (mesmo
  profissional e local, "Confirme a remarcação") e Cancelar ("Tem certeza?"), antecedência só no portal (RD10). Remarcar
  do bot e do lembrete pelo portal, sem o prazo (I7, F3-4). Cancelamento pela clínica (bloqueio): link do portal por 2
  dias que marca de novo o mesmo atendimento (F3-3); tela Avisar com ele. Minhas consultas no início e nas telas finais.
- **F3d (`7a35c60`):** Configurações › Portal (Administrador): link da clínica e dos profissionais com "Copiar link
  para…" (`?de=`), QR code (PNG, cartaz A4, link do cartaz), "Mostrar no portal" / "Tirar do portal" e a antecedência.
  A origem segue pelas telas (`origem=`) e grava `appointments.portal_place`. Bot: "Informações › Convênios" diz quem
  não atende particular (pendência da F1).
- **Revisões (10/nov):** `security-review` sem achados altos; `/code-review` com 10 achados, todos corrigidos
  (`78fca3a`): links de remarcar de atendimentos diferentes não se anulam; uma marcação por link (o de remarcar não é
  gasto por consulta nova); o link de remarcar dispensa o prazo só para remarcar, só enquanto vale (+30 min); a lista
  mostra o Remarcar dele; novo link da clínica com 2 dias e a origem; ação explícita na API; textos num lugar só.
- **Testes:** 1183 de unidade, 1148 de banco; Playwright local em 390 e 1280 px (link do bot, encaixe, Minhas
  consultas, remarcar, cancelar, Configurações › Portal, QR, cartaz, copiar).
- **Staging (10/nov):** migração `20270107120000_portal_links` aplicada e conferida; `main` em `207cf87`. Endereço do
  portal no staging só na Clínica Exemplo Saúde (`clinica-teste`); as outras clínicas com bot seguem no chat até o
  Suporte definir o endereço. **Produção: não** (antes dela, o Suporte define o endereço de toda clínica com bot).
- **Fora desta entrega:** D5 + F3e (domiciliar e turma no portal), desenho antes. Capturas da ajuda na fila
  (`config-*` e `config-mensagens`), recaptura só com autorização.

#### 15.3.1 Roteiro de validação da F3 (staging, clínica `clinica-teste`)

1. **Bot leva ao portal:** no WhatsApp de testes da clínica, "Oi" → especialidade → profissional → Consultas › Marcar
   consulta: chega "Para escolher o dia e o horário de *consulta com …*, toque no link…". O link abre o portal já no
   atendimento do profissional, sem pedir o código ("Passo 1 de 4"); na tela "Para quem…", "Confirmação no WhatsApp,
   celular final …" e "Usar outro número". Marcar: a confirmação chega; na Agenda, "Portal · WhatsApp".
2. Abrir o mesmo link de novo: "Este link já foi usado" (com "Minhas consultas"). Pedir outro link e abrir o anterior:
   "Este link não vale mais".
3. **Retorno e exame:** Marcar retorno e Marcar exame mandam o link do portal (retorno: a lista das consultas com direito).
4. **Encaixe:** Consultas › Encaixe ou antecipar sem consulta marcada → Marcar consulta: o link avisa da lista de
   espera; nos horários e na revisão, "Ao marcar, você entra na lista de espera…"; marcado, aparece na Lista de espera.
5. **Pedido não concluído:** pedir o link e não abrir por 30 minutos: chega "Não concluímos a sua marcação" com Novo
   link / Falar com a recepção / Desistir; "Novo link" manda outro.
6. **Minhas consultas:** no início do portal, "Minhas consultas" → celular e código → a lista. Consulta a mais de 24 h:
   Remarcar (dias do mesmo profissional) → "Confirme a remarcação" (marcado para × novo horário) → "Pronto, remarcado"
   e o aviso no WhatsApp. Cancelar → "Tem certeza?" → "Não, manter" volta; "Sim, cancelar" cancela e avisa.
   Sem prazo desde 10/nov (padrão 0 h): remarca e cancela mesmo a menos de 24 h; com antecedência posta em
   Configurações › Portal, dentro dela só "Falar com a recepção".
7. **Remarcar pelo WhatsApp:** Consultas › Remarcar (ou o botão do lembrete): chega o link do portal com os dias do
   mesmo profissional; remarca mesmo a menos de 24 h.
8. **Cancelamento pela clínica:** Agenda › Bloquear um período com consulta e cancelar: o aviso traz o link do portal
   (vale 2 dias) que marca de novo o mesmo atendimento; a tela Avisar mostra o mesmo link.
9. **Configurações › Portal** (Administrador): o link da clínica e de cada profissional; "Copiar link para… Instagram"
   ("Link para o Instagram copiado"); QR code → Baixar imagem, Imprimir cartaz, Copiar link do cartaz; "Tirar do
   portal" (some do portal e o link dele não abre) e "Mostrar no portal"; mudar a antecedência para 48 h e conferir em
   Minhas consultas.
10. **Origem:** marcar pelo link copiado para o Instagram (`?de=instagram`): na Agenda, "Portal · link da clínica"
    (Métricas da origem chegam na F6).
11. **Informações › Convênios** no bot, com um profissional só convênio: "… Não atende particular."

#### 15.3.2 Validação da F3 (registro)

- **10/nov: roteiro 15.3.1 inteiro validado no staging (itens 1 a 11)**, com o achado do item 9 corrigido (`692b13d`,
  `f542bf9`).
- **10/nov, item 1 (achado do cliente):** depois de marcar, "marcar nova consulta" → celular → código → a tela pediu o
  celular de novo e avisou "Este celular já reservou muitos horários hoje". Causa: o limite de 5 reservas por celular em
  24 h contava toda reserva, até a que virou consulta (4 testes da madrugada + a consulta de hoje). **Decisão do cliente:
  contam só as reservas que viraram consulta marcada** (migração `20270107130000_portal_limite_marcadas`). Tela: com o
  celular já comprovado, o aviso aparece com o celular e "Trocar número", sem pedir o celular nem o código de novo; o
  texto fala do botão da recepção no topo (no computador ele se chama "Falar com a recepção").
- **10/nov, achados do cliente (4, na `main`; validados no staging em 10/nov):**
  1. **Sem prazo para remarcar e cancelar pelo portal** (RD10 revista): padrão 0 h e todas as clínicas em 0 h (migração
     `20270109120000_portal_sem_prazo`); quem quiser põe um prazo em Configurações › Portal.
  2. **Confirme a remarcação** no celular: "Confirmar remarcação" numa barra fixa no rodapé (sempre à vista); o mesmo
     na revisão da marcação ("Confirmar agendamento") e na do retorno ("Marcar retorno") (cliente, 10/nov).
  3. **Ficha do paciente**, cartão Dados: o nome aparece (o "Editar" dali muda o nome).
  4. **Bot**: data com o ano em 2 números (25/11/84, 251184) vira 25/11/1984 com o "Você quis dizer…?" (20xx se não
     for futura, senão 19xx).
- **Pedido do cliente (10/nov): desbloqueio pela recepção na ficha do paciente. Feito e validado no staging (10/nov).** Canvas:
  https://claude.ai/artifact/JW4oj3TYsfoaDEiMAbzJk1. Decisões do cliente: **opção A**, faixa amarela no alto da ficha,
  só enquanto houver bloqueio (motivo, até quando, os outros pacientes do mesmo celular) com "Liberar agora" e
  confirmação; **libera os dois tipos**: código pedido demais (`portal_blocks`, chave `phone:`) e o limite do dia (5
  consultas marcadas em 24 h). Migração `20270109130000_portal_liberar_celular`: tabela `portal_limit_resets` (a
  contagem do limite recomeça na última liberação; `portal_hold_slot` e `portal_hold_group_slot` recriadas só com isso),
  `portal_phone_status` e `portal_release_phone` (Administrador e Recepção). Bloqueio por IP ou por sessão fica para o
  monitor da F6. Teste `tests/db/portal-liberar-celular.test.ts`; artigo "Ficha do paciente" com o campo "Portal
  bloqueado".
  **Roteiro (staging, `clinica-teste`):** no portal, pedir o código 4 vezes em 1 hora com o mesmo celular (o 4º
  bloqueia) → na ficha de um paciente desse celular, a faixa "Portal bloqueado para este celular · Pediu código demais
  · libera sozinho às …" → "Liberar agora" → confirmar → "Portal liberado para …" e a faixa some → o portal manda o
  código de novo. Limite do dia: marcar 5 consultas pelo portal com o mesmo celular → a faixa mostra "Marcou 5
  consultas em 24 h" → liberar → a 6ª marca.
- **10/nov, item 9 (achado do cliente): Minhas consultas pelo link do profissional.** Abria a lista da clínica
  (`/{clínica}/minhas-consultas`) e o Voltar ia ao início da clínica. **Decisão do cliente:** pelo link do profissional,
  só as consultas dele; pelo link da clínica, todas, separadas por profissional (exames juntos). Feito: endereço
  `/{clínica}/{profissional}/minhas-consultas` (e `/remarcar`, `/confirmar`, `/cancelar`), que reescreve para as telas
  da clínica com o parâmetro `profissional` (`mineScope` e `mineRewriteTarget` em `lib/data/portal/page.ts`); o cartão
  do profissional no alto (revisto pelo cliente, 10/nov: o mesmo cabeçalho dos grupos do link da clínica, foto ou
  iniciais, nome e especialidade com a linha embaixo, também na lista vazia e na tela do celular; componente
  `PortalMineGroup`); Voltar, Remarcar, Cancelar e "Agendar
  consulta" no endereço dele. Sem migração. Teste `src/lib/data/portal/mineScope.test.ts`.
  **Roteiro (staging):** link do profissional › Minhas consultas → o endereço com o profissional, o cartão dele e só as
  consultas dele → Remarcar/Cancelar ficam no endereço dele → Voltar leva ao início do profissional. Pelo link da
  clínica: as consultas em grupos com o nome e a especialidade de cada profissional.
- **Pergunta do cliente (10/nov), item 1: "Usar outro número".** Hoje o cadastro não muda: o portal identifica pelo
  celular comprovado; com um número sem cadastro, nasce um contato e uma ficha nova (a antiga segue com o número
  antigo). Para criança com pai e mãe marcando cada um pelo seu número, isso divide a ficha (histórico, lembretes,
  Minhas consultas, retorno, regra de uma consulta futura por médico, documentos, métricas). **Decisão do cliente:
  vários responsáveis por paciente** (a recepção liga outro responsável, com o número dele, à ficha; bot e portal
  reconhecem o paciente pelos dois números; ninguém se liga sozinho pelo portal). **Planejar em outra sessão**:
  decisão de arquitetura nova em `arquitetura.md`, desenho no canvas (ficha, quem recebe as mensagens, bot e portal)
  e as etapas.

### 15.4 Próximas partes da F3 (plano, 10/nov/2026)

Ordem proposta ao cliente: validação da F3 (15.3.1) → **D5** (desenho de domiciliar e turma no portal, aprovação tela a
tela) → **F3e** (código) → **F3f** (limpeza) → produção.

**F3f, limpeza do caminho antigo** (branch curta própria, sem migração):

- **Condições (revistas pelo cliente, 10/nov, F3-9):** F3e validada no staging; produção com o portal ligado na clínica
  piloto (a única em produção, poucos agendamentos); as **3 primeiras marcações reais pelo portal sem problema**. Sai o
  prazo de ~2 semanas (com uma clínica e poucos agendamentos, dava pouca informação). A F3f não tem migração: se der
  errado, desfaz o commit e o chat volta. Toda clínica com bot precisa do endereço do portal antes (staging e produção).
- **Sai:** a marcação no chat (`bot/booking.ts`: serviço, profissional/"Primeiro horário", local, endereço, convênio,
  para quem, paciente, idade, link `/agendar`; a lista do retorno no chat), o Remarcar com `/agendar` e a confirmação do
  endereço do domiciliar (`manage.ts`), a página `/agendar/{link}` e `api/agendar` (depois de vencerem os últimos links,
  máx. 2 dias), o link de remarcação antigo do bloqueio, o pedido não concluído dos links antigos, `{paciente}` da
  mensagem "Link para marcar", os ramos "Não: marcação no chat" da Jornada do bot.
- **Fica:** Cancelar pelo WhatsApp (I7), encaixe de quem tem consulta, Informações gerais, Perguntas frequentes, Falar
  com a recepção, oferta de vaga, confirmação de presença, a escolha de especialidade/profissional no começo; a tabela
  `booking_links` só leitura (histórico das Métricas; sai depois, em migração própria).
- **Decisões (cliente, 10/nov):** **F3-5** sem link do portal (clínica sem endereço do portal, erro ou clínica
  suspensa): o bot passa para a recepção ("a recepção vai te atender por aqui"; conversa em Aguardando). **F3-6** o
  "Primeiro horário disponível" acaba (o portal mostra o próximo horário de cada médico na lista). **F3-7** profissional
  "Fora do portal": o bot passa para a recepção (o médico segue fora do portal).
- **Testes:** os de banco do bot que percorrem o chat passam a testar o link ou saem; Playwright WhatsApp → portal em
  390/1280; artigos da Central que falam da marcação no chat revistos; capturas na fila.

### 15.5 D5 feita: domiciliar e turma no portal (10/nov/2026, branch `recepcao-d5`) [Cliente]

Rodada 5 no canvas (https://claude.ai/artifact/Npzjm2Vixb3UnEuUWfiAmb, fileiras "Rodada 5 (D5): atendimento domiciliar"
e "Rodada 5 (D5): exame em turma"), revisada tela por tela e aprovada. Sem código.

- **Onde (DM1c):** só para o profissional que atende no consultório e em casa: dois botões "No consultório R$ 350" /
  "Em casa R$ 550" em cima dos dias (P6); os dias e horários mudam com o lugar. Sem tela nova. Quem atende só em casa
  pula a escolha e mostra "Em casa" no resumo. Recusadas: tela própria (DM1a) e junto da P5 (DM1b).
- **Endereço (DM2b):** depois do paciente (P8/P8b), com o celular já comprovado e o horário em reserva: "Mesmo
  endereço da última visita" (o padrão do contato, como o bot) ou "Outro endereço". Recusado: antes dos horários (DM2a).
- **Campos:** rua e número, complemento (se tiver), bairro e ponto de referência (se tiver); cidade da clínica, com
  "fale com a recepção" para outra. Gravado num texto só (`appointments.home_visit_address` e o padrão do contato,
  como o bot): sem migração prevista.
- **Revisão (DM3):** linha "Endereço do atendimento" com Alterar (volta à DM2b).
- **Remarcar em casa (DM4):** "Confirme a remarcação" pergunta "O endereço continua o mesmo?" ("Sim, é esse"
  marcado; "Não, mudou" abre os campos ali). Retorno de domiciliar segue recusado (regra do bot).
- **Turma, lista de exames (TU1):** etiqueta "Em grupo, horário fixo" e a linha que explica o termo.
- **Turma, dia (TU2a):** lista de cartões (dia por extenso e hora) com "Ver mais dias", no lugar da faixa de dias;
  **sem número de vagas**, só as turmas com vaga no prazo. A reserva segura uma vaga. Recusada: faixa de dias (TU2b).

- **Exame em agenda de profissional (F3-8, 10/nov): sem efeito.** A pergunta foi feita e respondida (na lista de
  exames, EP1a/EP1b), mas o caso não existe: desde 08/nov (decisão do cliente, migração `20270101150000`) exame é
  sempre da agenda de Exames e o banco recusa exame com profissional (`services_exam_team_only`). O item vinha do plano
  da F3b sem conferência no código; a F3e-3 foi desfeita antes do commit. As telas EP1a, EP1b e EP2 ficam no canvas só
  como registro.

**F3e em partes** (branch `recepcao-d5`, testes a cada parte): **F3e-1** domiciliar (onde, endereço, revisão,
remarcar) → **F3e-2** turma (o bot e a Jornada do bot junto de cada parte) → revisões (`security-review`,
`/code-review`), staging. A F3e-3 (exame do profissional) saiu: o caso não existe (F3-8 acima).

#### 15.5.1 F3e-1 feita: atendimento em casa no portal (10/nov/2026, branch `recepcao-d5`)

Migração `20270108120000_portal_domiciliar` (`slot_holds.home_visit_address`, até 500 caracteres), aplicada no banco
local com o OK do cliente; staging e produção: não.

- **Dados:** o domiciliar entra nos locais do profissional (consultório primeiro), com o valor de cada lugar
  (`PortalConsultation.prices`); o valor de casa conta no "a partir de" do cartão. Exames seguem só no consultório; o
  retorno, só no consultório (domiciliar não dá direito a retorno). Início do profissional: "No consultório e em casa".
- **P6 (DM1c):** "Onde será o atendimento?" com "No consultório R$ 300 / Em casa R$ 450" em cima dos dias
  (`?onde=casa|consultorio`, consultório por padrão); os dias e horários são só os do lugar escolhido. Em casa, sem o
  endereço do consultório no topo; passo "Endereço" a mais na contagem.
- **Endereço (DM2b, tela nova `/{clínica}/{profissional}/endereco`):** depois do paciente (a revisão manda para lá se
  falta o endereço); "Mesmo endereço da última visita" (padrão do contato), "O endereço informado agora" (voltando pelo
  Alterar) ou "Outro endereço" com rua e número, complemento, bairro e ponto de referência (`joinHomeAddress`, um texto
  só). Erro: os campos ficam como foram digitados.
- **Revisão, P10 e `.ics`:** "Endereço do atendimento" com Alterar; "Particular, R$ 450, em casa" (o valor do lugar,
  também na barra e nos resumos); P10 "Em casa" com o endereço; o `.ics` leva o endereço. A marcação grava o endereço
  no atendimento e no padrão do contato; sem endereço, não marca (`no_address`).
- **Remarcar em casa (DM4):** Minhas consultas remarca o domiciliar; a confirmação pergunta "O endereço continua o
  mesmo?" ("Não, mudou" abre os campos; o novo vai para o atendimento e o contato). Também pelo link do bot e pelo link
  depois do cancelamento pela clínica.
- **Bot:** Marcar consulta com profissional que atende em casa e Remarcar em casa mandam o link do portal (só a turma
  segue no chat). Jornada do bot atualizada (`JOURNEY_UPDATED` 10/11/2026).
- **Testes:** 1188 de unidade; banco: `portal-domiciliar.test.ts` (locais e valores, sem endereço não marca, endereço no
  atendimento e no contato, reserva de outra sessão, remarcar com endereço novo), `portal-escolha` revisto e o Remarcar
  em casa em `bot-portal-link`; bateria de banco inteira passou (1152) antes da migração da sessão de validação
  (`20270107130000_portal_limite_marcadas`, ainda sem commit na `main`) mudar o limite de reservas no banco local:
  `portal-identificacao` › "cinco reservas" falha por isso, não pela F3e-1.
- **Playwright (porta 4322, clínica temporária apagada no fim):** 390 e 1280 px; Em casa → 14:00 → celular e código →
  paciente → endereço (erro sem a rua preserva complemento, bairro e referência) → revisão → Voltar em cadeia →
  duplo clique em Confirmar (um atendimento só) → P10; Minhas consultas → Remarcar → "Não, mudou" (erro preserva os
  campos) → "Pronto, remarcado". Console sem erros. Achado e corrigido: o atendimento em casa mostrava "Particular, a
  partir de R$ 300" no lugar de "Particular, R$ 450, em casa".
- **Capturas da Central:** nenhuma tela com captura mudou.

#### 15.5.2 F3e-2 feita: exame em turma no portal (10/nov/2026, branch `recepcao-d5`)

Migração `20270108130000_portal_turma` (função `portal_hold_group_slot`: a reserva segura uma vaga enquanto marcados +
reservas de outras sessões não chegam à capacidade), aplicada no banco local com o OK do cliente; staging e produção:
não. Para aplicar só ela, a migração da sessão de validação (`20270107130000`, ainda sem commit) foi copiada para o
worktree durante o comando e apagada em seguida.

- **Dados:** a turma da agenda da equipe entra em `portal.exams` (`isGroup`); dias e horários = as sessões com vaga no
  prazo (`groupSessions`), descontando as vagas que outros pacientes do portal estão confirmando
  (`getGroupSessions` com `holds`). Próximo horário, "ainda livre" e a lista de exames passam a valer para a turma.
- **Lista de exames (TU1):** etiqueta "Em grupo, horário fixo" e a linha "\"Em grupo\": várias pessoas fazem o exame
  juntas, no mesmo horário".
- **Dia da turma (TU2a):** "Escolha o dia", lista de cartões (dia por extenso e "às 10:00"), sem número de vagas, 8 por
  vez com "Ver mais dias". O resto do caminho é o dos exames (celular, paciente, revisão com o preparo, "Exame marcado!").
- **Bot:** Marcar exame com turma da agenda da equipe manda o link do portal. Remarcar turma segue no chat (o portal não
  remarca turma). Jornada do bot atualizada.
- **Limite conhecido:** a reserva de uma vaga de turma ainda conta como horário ocupado para um exame individual da
  mesma agenda no mesmo horário (janelas da turma e dos exames individuais costumam ser separadas).
- **Testes:** 1188 de unidade; banco: `portal-turma.test.ts` (lista e sessões, uma vaga por reserva, turma cheia por
  reservas some e recusa, a mesma reserva ao recarregar, marcação como turma, função recusa serviço individual) e
  `portal-exames` revisto; bateria inteira 1156 de 1157 (a falha é a de 15.5.1, da migração da sessão de validação).
- **Playwright (porta 4322, clínica temporária apagada):** 390 e 1280 px; lista com a etiqueta → turma → lista de dias
  → celular e código → paciente → revisão com o preparo → duplo clique (um atendimento) → "Exame marcado!"; Voltar da
  lista de dias leva à lista de exames. Sem erros do portal no console.

#### 15.5.3 Revisões da F3e (10/nov/2026)

- **`security-review`:** sem achados (reserva e endereço presos à sessão comprovada; função da turma com a clínica, a
  agenda e o serviço conferidos; saída escapada).
- **`/code-review` (8 achados):** corrigidos o limite da turma (só reservas marcadas, como a `c9cb2b5`), o "Ver mais
  dias" no teto de 60, o endereço do contato só depois de gravado no atendimento, a leitura das reservas da turma em
  paralelo, os campos do endereço e a leitura do resultado da reserva num lugar só (`e2d7ced8`). Decididos pelo cliente:
  - **Valor do local escolhido (cliente, 10/nov):** revisão, celular e tela final mostram o valor da unidade escolhida,
    não o menor (`priceAt`, `97e31f96`).
  - **Reserva na agenda de Exames (cliente, 10/nov):** só segura o mesmo exame (a turma, uma vaga); exames diferentes
    no mesmo horário não se bloqueiam, como os exames marcados. Migração `20270108140000_portal_reserva_exame`
    (`portal_hold_slot` sobre a versão da `20270107130000`), aplicada no banco local com o OK do cliente; `loadHolds`
    filtra pelo exame. Isso também resolve o limite conhecido da 15.5.2.
- **Migrações da F3e para o staging, nesta ordem:** `20270108120000_portal_domiciliar`, `20270108130000_portal_turma`
  (`create or replace`), `20270108140000_portal_reserva_exame`.
- **Testes:** 1188 de unidade; 1159 de banco (bateria inteira).

#### 15.5.4 F3e no staging e roteiro de validação (10/nov/2026)

Migrações `20270108120000`, `20270108130000` e `20270108140000` aplicadas no staging (simulação → aplicar → conferir:
coluna `slot_holds.home_visit_address` e função `portal_hold_group_slot` no banco; histórico em dia). Produção: não.

**Roteiro (clínica `clinica-teste`, celular de testes):**

1. **Preparar:** um profissional com o local "Domiciliar" e horário em casa (Configurações › Horários) e o serviço de
   Consulta com valor diferente em casa; um exame em turma na agenda de Exames (Configurações › Serviços, "Turma", com
   capacidade).
2. **Em casa pelo portal:** abrir o portal → profissional → "Em casa" (só os dias e horários de casa, com o valor de
   casa) → horário → celular e código → paciente → **endereço** (com campos vazios, o erro mantém o resto) → revisão
   com "Endereço do atendimento" e "Particular, R$ …, em casa" → "Consulta marcada!" com o endereço → na Agenda, o
   atendimento com o endereço.
3. **Endereço salvo:** marcar de novo em casa com o mesmo celular: aparece "Mesmo endereço da última visita".
4. **Remarcar em casa:** Minhas consultas → Remarcar → "O endereço continua o mesmo?" → "Não, mudou" → novo endereço
   no atendimento.
5. **Bot:** no WhatsApp, Marcar consulta com esse profissional manda o link do portal (sem perguntar o endereço no
   chat); Remarcar a consulta em casa também.
6. **Turma:** Marcar exame → a turma com "Em grupo, horário fixo" → lista de dias (sem número de vagas) → marcar.
   Com a turma cheia (marcados e reservas), o dia some.
7. **Agenda de Exames:** enquanto alguém confirma a turma (reserva aberta), outro exame no mesmo horário continua
   aparecendo no portal.

## 16. F5a: agenda da clínica grande (10/nov/2026, branch `agenda-colunas`)

Sessão de implementação (worktree `../recepclinic-impl`). Desenho aprovado: R3 (grade de 18), R3c (clínica pequena),
R2 (atendimento aberto), R3b (Próximos horários livres) e M4 (celular), rodada 3 do canvas; especificação R3.

**Partes** (testes a cada parte; Playwright em 390 e 1280 px):

| Parte | O que entrega |
|---|---|
| **F5a-1 Grade** | Agenda › Dia em grade por horário: uma coluna por agenda, linhas de 30 min, nomes e horas fixos, rolagem só dentro da grade. Até 7 agendas: colunas na largura toda e o filtro "Agenda". A partir de 8: Especialidade **ou** Profissional (com busca), colunas agrupadas por especialidade, barra de rolagem no topo ("Profissionais 1 a 7 de 18", setas, trilho) e "Mais {n}" na borda. Filtro Situação. Cor pela situação, com legenda; reserva do portal tracejada "Em reserva até 10:42"; bloqueio hachurado; turma; "Livre" leva à Marcar. Sem lembrar filtro (sai o cookie da agenda escolhida) |
| **F5a-2 Atendimento aberto** | Painel à direita (o de hoje, com "Fechar"); a agenda do atendimento vai para a primeira coluna, destacada; o resto que couber continua visível |
| **F5a-3 Próximos horários livres** | Tela própria: Especialidade, Atendimento e "A partir de"; os 2 primeiros dias com vaga de cada profissional, com os convênios que atende, "Mais cedo" e "Ver mais dias"; horário em reserva apagado; tocar abre a Marcar preenchida. A Marcar passa a recusar horário em reserva do portal |
| **F5a-4 Celular** | Uma agenda por vez (setas, deslizar, lista com busca), "Próximos horários livres" em destaque |

**Conferido no código antes de começar:**
- **Não existe atendimento online** no banco (local: `clinic` ou `home_visit`). O filtro "Atendimento (presencial/online)"
  da R3b vira **"No consultório / Em casa"** (as palavras do portal, D5) e só aparece na clínica que tem local em casa.
- **Especialidade da coluna:** a primeira do profissional (`professional_specialties.position`); a agenda da Equipe
  fica no grupo "Exames"; profissional sem especialidade, em "Outros". O filtro Especialidade acha o profissional por
  qualquer uma das dele.
- **Reserva do portal:** a equipe já lê `slot_holds` (política `slot_holds_member`); sem migração.
- **Marcar e reserva:** hoje a Marcar ignora a reserva do portal (`loadHolds` só no portal). A R3 pede a recusa: os
  horários e a conferência da Marcar passam a contar a reserva (no código, sem migração).
- **Desempenho:** os horários livres do dia liam a ocupação agenda por agenda, em sequência; com 18 agendas, passa a ler
  em paralelo e por período (uma leitura por agenda para os dias da R3b).

### 16.1 F5a feita (10/nov/2026, branch `agenda-colunas`)

As quatro partes num commit só (`f3d057f0`) e as correções da revisão. **Sem migração.**

**Na `main` e no staging (10/nov/2026, `cd08925`)**: juntada a pedido do cliente depois de trazer a `main` (testes: astro check, 1202 de unidade e 1166 de banco; a correção da reserva do exame da F3e conferida). Validação do cliente pendente; captura `agenda-dia` na fila.

- **Grade** (`AgendaGrid.astro`, regras puras em `src/lib/agendaGrid.ts`): linhas de 30 min (2 px por minuto), faixa de
  horas pelo horário de atendimento do dia e pelo que está marcado; itens sobrepostos dividem a coluna; linha de agora;
  abre na hora atual. A grade ocupa o resto da tela (rolagem só dentro dela). "Livre" aparece ao passar o mouse ou com
  o foco (no toque, sempre) e leva à Marcar. A escolha da agenda não é mais lembrada (sai o cookie `rc_agenda`).
- **Filtros:** até 7 agendas, "Agenda" (como hoje); a partir de 8, `ColumnPicker` (Especialidade ou Profissional, com
  busca sem acento, setas e Enter); Situação em todas. Os filtros ficam no endereço (`agenda`, `esp`, `situacao`).
- **Atendimento aberto:** o painel de hoje, à direita (372 px); a coluna dele vai para a primeira, destacada; Fechar e
  Esc devolvem a ordem e o foco.
- **Próximos horários livres** (`/admin/agenda/livres`, regra em `src/lib/nextFree.ts`): 30 dias a partir de "A partir
  de"; cartões pela ordem do primeiro horário, "Mais cedo" quando só um tem o primeiro; convênios e particular do
  profissional; "Ver mais dias" abre a agenda dele no dia seguinte ao último mostrado.
- **Reserva do portal:** tracejada na grade; na agenda de Exames não esconde o "Livre" (a reserva só segura o mesmo
  exame). Marcar e Remarcar da equipe não oferecem nem aceitam horário em reserva (`TEAM_HOLDS`, `respectHolds`);
  o portal e o bot seguem como antes. O teste do portal "horário tomado antes de confirmar" passou a usar o bot.
- **Celular:** `AgendaPhoneList` (uma agenda por vez, `ver` no endereço; setas, deslizar, lista com busca; com filtro
  vindo do computador ou de "Ver mais dias", o link "Ver todas as agendas").
- **Ajuda:** artigo "Ver a agenda" e textos das situações atualizados; captura `agenda-dia` na fila
  (`capturas-pendentes.md`), à espera da autorização.
- **Testes:** unidade (grade e próximos livres) e banco (`agenda-colunas.test.ts`: horários por período com o local,
  reserva lida pela equipe, Marcar recusando a reserva). Playwright (390 e 1280 px, clínica local com 19 agendas
  temporárias, apagadas no fim): voltar de Próximos horários livres e da Marcar com os filtros, busca dos filtros pelo
  teclado, Situação, painel com Esc e foco, setas e "Mais", celular (setas, dia seguinte mantendo a agenda, painel
  embaixo), sem rolagem lateral, sem erro no console. Achados corrigidos: seta da busca ia para "Todas"; Esc não
  devolvia o foco.
- **`/code-review`:** 10 achados; corrigidos 9 (celular preso num filtro, reserva de exame apagando horários de outros
  exames, contagem com Situação "Cancelado", calendário perdendo a agenda do celular, busca pelas outras especialidades,
  turmas sem paginação em 30 dias, especialidades lidas duas vezes e as inativas, dia com reserva antes de outro).
  Fica: os bloqueios lidos duas vezes por agenda nos horários livres (custo pequeno, em paralelo).
- **Tempo (local, 19 agendas):** Agenda ~0,2 s; Próximos horários livres ~0,4 s. Medir no staging (meta < 2 s).
