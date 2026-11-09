# Implementação: recepção digital integrada (Etapa 3)

> **Estado atual (retomar daqui), 08/nov/2026.** Plano aprovado (decisões I1 a I11, seção 6; regra da Matriz, bot e
> portal, seção 1.1). **F1 feita, no staging e validada pelo cliente (08/nov)** (`aba61a8`, migração `20270102120000`;
> roteiro 7.1 sem ajustes). Produção: não. **D4 feita e aprovada tela por tela (08/nov, seção 8)**, rodada 4 no canvas.
> Endereços do portal (`agendar-teste`, `agendar`) e chaves do Turnstile: feitos (cliente, 08/nov, 4.1). **F2a feita
> (08/nov, seção 9; migração `20270103120000`)**: validação do cliente pelo roteiro 9.1. Próximo: F2b.

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
| Template de autenticação na Meta (código com "Copiar código"), por conta | Claude envia; Meta aprova | Antes da F2b |
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

A decidir na F3 (proposta, seção 17): se a antecedência da RD10 vale também para cancelar pelo WhatsApp.

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
4. Link do profissional: `agendar-teste.recepclinic.com.br/clinica-teste/{apelido}` (apelido em Configurações ›
   Profissionais): sem outros médicos e sem "Trocar".
5. Sistema › Matriz: desligar o "Portal de agendamento" da clínica: o endereço mostra "Agendamento indisponível".
   Religar.
6. `agendar-teste.recepclinic.com.br/admin` e um endereço inexistente: "Link não encontrado" (o painel não abre).
