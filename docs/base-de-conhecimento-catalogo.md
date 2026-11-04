# Base de Conhecimento: catálogo inicial (proposta, Etapa 2)

> **Proposta para avaliação do cliente (31/out/2026). Nada publicado nem ativo.** Na Etapa 3, cada entrada entra
> no banco como **rascunho**; só passa a responder depois de aprovada, ativada e publicada pelo Suporte, e na
> clínica com o item "Perguntas frequentes no bot" ligado. Ajustes, exclusões e inclusões: direto neste arquivo.
> Arquitetura e decisões: [`base-de-conhecimento.md`](base-de-conhecimento.md).

## Como ler

- **Uma entrada = uma intenção.** Perguntas que levam à mesma resposta ficam como sinônimos da mesma entrada.
- **Sinônimos** servem para casar o texto (sem acento, sem caixa, com erros comuns: "vcs", "q", "hj"). A lista é
  inicial; o Suporte acrescenta pelo que o bot não reconheceu (decisão 4).
- **Palavras-chave:** pelo menos uma precisa estar na mensagem; evita casar só por semelhança.
- **Tipo:** `modelo` (texto com variáveis), `fonte` (a fonte monta a resposta), `fluxo` (abre um fluxo existente),
  `fixo` (texto igual para todas as clínicas), `recepcao`.
- **Fontes:** lista fechada, do código; leem só a clínica do token. `{variável}` sem fonte não publica.
- **Sem dado:** quando a clínica não tem a informação cadastrada, a entrada não responde nela e a mensagem segue
  como o "não entendi" de hoje (nunca inventa).
- **Vale para:** em vez de uma lista por tipo de estabelecimento (médica, odontológica, exames…), cada entrada vale
  quando a clínica tem o dado ou o item da matriz. Ex.: "preparo de exame" só existe onde há exame com preparo.
  Assim a mesma base serve consultório médico, odontológico, pediatria e clínica de exames sem duplicar perguntas.
  O tipo de estabelecimento aparece só nos sinônimos (ex.: "dentista") e no dicionário de especialidades.
- Depois de responder, o bot **repete o passo** em que a pessoa estava (no menu, o menu).

Total: **31 entradas** em 18 categorias (a 15, documentos, fica de fora) + dicionário de especialidades + filtro clínico.

---

## 1. Funcionamento e horários

### F1. Qual o horário de funcionamento?
- **Sinônimos:** que horas vocês abrem; que horas fecha; até que horas funciona; qual o horário de atendimento;
  vocês abrem sábado; atendem aos sábados; atende domingo; funciona hoje; está aberto agora; abre feriado;
  horário da clínica; que horas começa o atendimento.
  **Dias de atendimento (C28, 04/nov/2026):** vocês atendem na segunda; atende na terça; atendem na quarta-feira;
  abre na quinta; tem atendimento na sexta; quais dias vocês atendem; que dias tem atendimento; dias de atendimento;
  atende todos os dias; atende de segunda a sexta; funciona durante a semana; abre no fim de semana; qual dia vocês
  atendem; segunda vocês atendem; atendem segunda; vocês funcionam na terça (migração `20261208120000`). Os nomes
  dos dias não viram palavra-chave: tiravam "quero agendar para quarta" da M1 e "a Dra. Ana atende na quarta?" da P2.
- **Palavras-chave:** horário, hora(s), abre, abrem, fecha, funciona, funcionamento, aberto, sábado, domingo,
  feriado.
- **Tipo / fontes:** `modelo` · `horario_recepcao` (decisão 7; sem horário salvo, o sugerido pelas agendas, como
  na F8.5b), `feriado_hoje`.
- **Resposta:** "Nosso horário de atendimento:\n{horario_semana}" + se hoje é feriado da clínica: "Hoje
  ({feriado}) não há atendimento."
  - `{horario_semana}`: "Segunda a sexta: 8h às 18h\nSábado: 8h às 12h\nDomingo: fechado" (dias iguais agrupados).
- **Sem dado:** sem horário e sem agenda com horário → não responde.

## 2. Endereço e localização

### E1. Qual o endereço da clínica?
- **Sinônimos:** onde fica; onde vocês ficam; qual a localização; manda a localização; como chego aí; fica em
  qual bairro; endereço do consultório; qual a rua; ponto de referência.
- **Palavras-chave:** endereço, onde, localização, local, chego, chegar, rua, bairro, fica.
- **Tipo / fontes:** `modelo` · `enderecos` (locais do tipo clínica, ativos, com endereço; como Informações ›
  Endereço).
- **Resposta:** um local: "Estamos em {endereco}.\nVer no mapa: {link_mapa}"; vários: um bloco por local com o
  nome.
  - `{link_mapa}`: gerado do endereço (`https://www.google.com/maps/search/?api=1&query=…`); não é cadastro novo.
- **Sem dado:** nenhum local com endereço → não responde.

### E2. Vocês têm site?
- **Sinônimos:** qual o site; tem página na internet; endereço do site.
- **Palavras-chave:** site, página, internet.
- **Tipo / fontes:** `modelo` · `site` (`website_url`).
- **Resposta:** "Nosso site: {site}"
- **Sem dado:** sem site → não responde.

## 3. Serviços e especialidades

### S1. Quais serviços vocês oferecem?
- **Sinônimos:** o que vocês fazem; quais consultas vocês têm; quais exames vocês fazem; quais procedimentos;
  que tipo de atendimento tem; quais tratamentos.
- **Palavras-chave:** serviços, consultas, exames, procedimentos, tratamentos, atendimentos, fazem, oferecem.
- **Tipo / fontes:** `fonte` · `servicos` (catálogo do bot: só serviço com agenda e horário).
- **Resposta:** "Atendemos:\n• {serviço}\n…" (consultas e exames separados quando houver os dois) + "Para marcar,
  escolha no menu."
- **Sem dado:** sem serviço no catálogo → não responde (o bot já transfere nesse caso, regra de 11/out).

### S2. Vocês fazem {serviço}?
- **Sinônimos:** tem {serviço}; vocês atendem {serviço}; fazem exame de {x}; tem consulta de {x}; realizam {x}.
- **Palavras-chave:** o nome (ou parte) de um serviço do catálogo **da clínica**.
- **Tipo / fontes:** `fonte` · `servicos` (casa o texto com os nomes dos serviços da clínica).
- **Resposta:** achou: "Sim, fazemos {serviço}." + botão "Marcar" (abre a marcação já com o serviço). Não achou:
  como S1 (nunca "não fazemos", mesma regra da decisão 11).
- **Sem dado:** sem catálogo → não responde.

### S3. Quais especialidades vocês têm?
- **Sinônimos:** quais especialidades; quais especialistas; que tipo de médico tem; que tipo de dentista tem.
- **Palavras-chave:** especialidade(s), especialista(s).
- **Tipo / fontes:** `fonte` · `profissionais` (catálogo).
- **Resposta:** "Atendemos por aqui:\n• {especialidade}: {profissional}\n…" (sem especialidade cadastrada: a
  profissão).
- **Sem dado:** sem profissional com agenda → não responde.

### S4. Vocês têm {especialidade}?
- **Sinônimos:** tem pediatra; tem médico de pulmão; tem dentista de criança; atende {especialidade}; tem algum
  {especialista}.
- **Palavras-chave:** um termo do **dicionário de especialidades** (seção 18).
- **Tipo / fontes:** `fonte` · `profissionais` + dicionário (decisão 11).
- **Resposta:** achou: "Sim! {profissional} atende {especialidade}." + botão "Marcar consulta". Não achou: como S3
  (nunca "não temos").
- **Sem dado:** como S3.

## 4. Profissionais

### P1. Quais profissionais atendem?
- **Sinônimos:** quem atende; quais médicos; quais dentistas; qual o nome do médico; quem são os profissionais;
  quem é a doutora.
- **Palavras-chave:** profissionais, médico(s), médica(s), dentista(s), doutor(a), dr, dra, quem atende.
- **Tipo / fontes:** `fonte` · `profissionais`.
- **Resposta:** mesma lista de S3 (por profissional).
- **Sem dado:** como S3.

### P2. O(a) {profissional} atende aí?
- **Sinônimos:** a dra {nome} atende; o dr {nome} ainda atende; qual a especialidade do dr {nome}; {nome} atende
  em qual dia.
- **Palavras-chave:** o nome de um profissional **da clínica**.
- **Tipo / fontes:** `fonte` · `profissionais`.
- **Resposta:** "Sim, {profissional} ({profissão}, {especialidade}) atende por aqui." + botão "Marcar consulta".
  Dia e horário não são informados: o link de marcar mostra as datas livres.
- **Sem dado:** nome não encontrado → como P1.
- Sem o registro no conselho (Q2); ele só vai na P3.

### P3. Qual o CRM do(a) {profissional}?
- **Sinônimos:** qual o registro do dr {nome}; CRM da doutora; CRO do dentista; o médico tem RQE; número do
  conselho.
- **Palavras-chave:** CRM, CRO, CRP, CREFITO, CRN, RQE, registro, conselho.
- **Tipo / fontes:** `fonte` · `profissionais` (conselho, número, UF, RQE).
- **Resposta:** "{profissional}: {conselho} {número}/{UF}{, RQE {rqe}}." Sem profissional citado e com um só na
  clínica: o dele; com vários: um por linha.
- **Sem dado:** registro não cadastrado → não responde.

## 5. Valores e formas de pagamento

### V1. Quanto custa a consulta?
- **Sinônimos:** qual o valor; quanto é; qual o preço; valor da consulta; quanto custa o exame; quanto fica;
  valor particular; preço do atendimento; quanto custa com o dr {nome}.
- **Palavras-chave:** valor, preço, custa, custo, quanto é, quanto fica, cobra, particular.
- **Tipo / fontes:** `fonte` · `valores`, `pagamento` (decisão 10).
- **Resposta:** genérica: lista de Informações › Valores + formas de pagamento. Serviço ou profissional citado: só
  aquele serviço. Na marcação com serviço escolhido: o valor dele (e do local, se escolhido). Preço zero: "Sem
  custo".
- **Sem dado:** serviço citado inexistente/sem horário → não informa valor (lista geral). Valor pelo convênio →
  não responde.

### V2. Quais as formas de pagamento?
- **Sinônimos:** aceita cartão; aceita pix; pode parcelar; aceita débito; aceita dinheiro; como posso pagar;
  paga na hora; tem desconto à vista.
- **Palavras-chave:** pagamento, pagar, cartão, crédito, débito, pix, dinheiro, parcela, parcelar, à vista.
- **Tipo / fontes:** `modelo` · `pagamento` (`bot_payment_info`, texto da clínica).
- **Resposta:** "Formas de pagamento: {pagamento}". O bot não responde "sim/não" a "aceita pix?": mostra o texto
  da clínica.
- **Sem dado:** texto vazio → não responde.

## 6. Convênios

### C1. Quais convênios vocês aceitam? / Aceitam {plano}?
- **Sinônimos:** atendem Unimed; aceitam plano de saúde; trabalham com convênio; meu plano é aceito; atende pelo
  plano; aceita Hapvida; atende particular e convênio; o dr {nome} atende {plano}.
- **Palavras-chave:** convênio(s), plano, planos, plano de saúde, aceita, aceitam, operadoras comuns (Unimed, Hapvida,
  Amil, Bradesco, SulAmérica, NotreDame, Cassi, GEAP, Porto Seguro) e o nome (ou nome alternativo) de um plano **da
  clínica**.
- **Tipo / fontes:** `fonte` · `convenios` (decisão 6).
- **Resposta:**
  - plano citado e aceito: "Sim, atendemos {plano}." (com profissional citado e exceção: "{profissional} não
    atende {plano}; {outros} atendem.");
  - plano citado e não encontrado: "Não encontrei {texto} entre os convênios que atendemos: {lista}." (Q3);
  - sem plano citado: "Atendemos os convênios: {lista}."
  - sem cadastro de planos: o texto "Convênios" das Informações do bot.
- **Sem dado:** item "Convênios" desligado e sem texto → não responde.

## 7. Marcação de consultas

### M1. Quero marcar uma consulta
- **Sinônimos:** agendar consulta; marcar horário; quero uma consulta; tem vaga; tem horário; tem horário
  amanhã; qual o próximo horário; primeira consulta; marcar para meu filho; marcar para outra pessoa; como faço
  para marcar; como funciona o agendamento.
- **Palavras-chave:** marcar, agendar, agendamento, consulta, vaga, horário livre ("encaixar" foi para EN1, 31/out).
- **Tipo / fontes:** `fluxo` · Marcar consulta.
- **Resposta:** o submenu Consultas (marcar, retorno, remarcar, cancelar, encaixe; cliente, 31/out/2026).
- **Sem dado:** sem consulta no catálogo → não responde. **Já marcando:** repete o passo.

## 8. Marcação de exames

### X1. Quero marcar um exame
- **Sinônimos:** agendar exame; fazer um exame; marcar procedimento; tem horário para exame.
- **Palavras-chave:** exame(s), procedimento + marcar/agendar/fazer.
- **Tipo / fontes:** `fluxo` · Marcar exame.
- **Resposta:** o submenu Exames (cliente, 31/out/2026).
- **Sem dado:** item "Exames" desligado ou sem exame no catálogo → não responde.

### EN1. Preciso de um encaixe (ajuste da homologação, 31/out/2026)
- **Sinônimos:** consigo um encaixe; tem encaixe; tem como encaixar; quero adiantar minha consulta; antecipar a
  consulta; antecipar o exame; tem horário mais cedo; quero entrar na lista de espera; entrar na fila de espera; se
  alguém desistir me avisa; tem desistência.
- **Palavras-chave:** encaixe, encaixar, encaixa, adiantar, antecipar, antecipação, mais cedo, lista de espera, fila de
  espera, desistência.
- **Tipo / fontes:** `fluxo` · Encaixe ou antecipar (categoria "Encaixe e lista de espera").
- **Resposta:** o "Encaixe ou antecipar" de hoje (Consultas ou Exames, pela mensagem).
- **Sem dado:** sem o item Lista de espera → "O encaixe é combinado com a recepção. Você quer falar com a
  recepção?" (sem recepção no app: o aviso de que a clínica responde e o menu).

## 9. Remarcação

### R1. Quero remarcar
- **Sinônimos:** mudar a data; trocar o horário; adiar a consulta; mudar o dia; passar para outro dia; como faço
  para remarcar; não vou poder ir (também em K1: empate → "Você quis dizer…?"); não vou poder ir nesse horário,
  quero outro.
- **Palavras-chave:** remarcar, remarcação, mudar, trocar, adiar, outro dia, outro horário.
- **Tipo / fontes:** `fluxo` · Remarcar (data de nascimento → atendimento → link). Nunca pede a data digitada.
- **Sem dado:** sem atendimento futuro → a resposta do fluxo de hoje.

## 10. Cancelamento

### K1. Quero cancelar
- **Sinônimos:** desmarcar; cancelar consulta; cancelar exame; não vou mais; não vou poder ir; desistir da
  consulta.
- **Palavras-chave:** cancelar, cancelamento, desmarcar, desistir, não vou.
- **Tipo / fontes:** `fluxo` · Cancelar.
- **Observação:** "não vou poder ir" sozinho é ambíguo entre R1 e K1 → "Você quis dizer…? Remarcar / Cancelar".

## 11. Consulta de retorno

### T1. Quero marcar retorno
- **Sinônimos:** agendar retorno; marcar a volta; levar o exame para o médico ver; consulta de revisão.
- **Palavras-chave:** retorno, revisão, volta.
- **Tipo / fontes:** `fluxo` · Marcar retorno.
- **Sem dado:** sem serviço de retorno → não responde.

### T2. Qual o prazo do retorno? O retorno é pago?
- **Sinônimos:** até quando posso voltar; quantos dias tenho para o retorno; retorno tem custo; retorno é
  gratuito; preciso pagar o retorno.
- **Palavras-chave:** retorno + prazo, dias, até quando, pago, paga, custo, grátis, gratuito, valor.
- **Tipo / fontes:** `fonte` · `retorno` (`return_deadline_days` e valor do serviço de retorno).
- **Resposta:** "O retorno pode ser marcado em até {prazo} dias depois da consulta. Valor: {valor | Sem custo}."
  (cada parte só se cadastrada).
- **Sem dado:** sem prazo e sem serviço de retorno → não responde.

## 12. Preparação para exames

### PR1. Qual o preparo do exame?
- **Sinônimos:** precisa de jejum; como me preparar para o exame; o que fazer antes do exame; tem preparo;
  quantas horas de jejum; posso comer antes do exame.
- **Palavras-chave:** preparo, preparação, jejum, antes do exame, preparar.
- **Tipo / fontes:** `fonte` · `preparo` (texto ou arquivo do serviço, como Informações › Preparo).
- **Resposta:** exame citado: o preparo dele (arquivo ou texto). Sem exame citado: a lista de exames com preparo
  (passo de hoje).
- **Sem dado:** nenhum exame com preparo → não responde. "Jejum" não aciona o filtro clínico.

### X2. O resultado do meu exame já saiu?
- **Sinônimos:** meu exame ficou pronto; quando sai o resultado; como pego o resultado; buscar resultado; entrega
  do exame; laudo pronto.
- **Palavras-chave:** resultado, laudo, pronto, ficou pronto, entrega + exame.
- **Tipo / fontes:** `recepcao` · "Sobre resultados de exames, a recepção pode te ajudar. Você quer falar com a
  recepção?" (Sim/Não). Sem recepção no app: "{designação} responderá sua mensagem em breve." e o menu (Q5).
- **Observação:** pergunta de interpretação ("meu exame deu…", "está normal?") vai para o filtro clínico, não aqui.

## 13. Atendimento domiciliar

### D1. Vocês atendem em casa?
- **Sinônimos:** atendimento domiciliar; visita em casa; vem até minha casa; atende a domicílio; consulta em
  casa.
- **Palavras-chave:** domiciliar, domicílio, em casa, minha casa, visita.
- **Tipo / fontes:** `fonte` · `domiciliar` (item da matriz + serviços com horário em local domiciliar).
- **Resposta:** "Sim, fazemos atendimento domiciliar: {serviços}." + valores domiciliares + botão "Marcar".
- **Sem dado:** sem domiciliar → "No momento não fazemos atendimento domiciliar." (Q4; dado estruturado).

## 14. Crianças e adolescentes

### I1. Vocês atendem crianças?
- **Sinônimos:** atende bebê; atende recém-nascido; atende adolescente; qual a idade que vocês atendem; até que
  idade; atende adulto.
- **Palavras-chave:** criança(s), bebê, recém-nascido, adolescente, idade, adulto, infantil.
- **Tipo / fontes:** `fonte` · `perfil` (pediátrica/adultos/mista), `idade_limite`.
- **Resposta:** pediátrica: "Atendemos crianças e adolescentes{ até {idade} anos}."; mista: "Atendemos crianças e
  adultos."; com idade limite: "Consultas até {idade} anos; acima disso, só retorno e exames." Adultos + pergunta
  sobre criança: não responde (não há dado de idade mínima).
- **Sem dado:** como acima.

## 15. Documentos necessários

**Fora da base** (decisão 8): segue como o "não entendi" de hoje.

## 16. Confirmação de consultas

### CF1. Quero confirmar minha consulta
- **Sinônimos:** confirmar presença; confirmo a consulta; vou comparecer; quero confirmar o horário.
- **Palavras-chave:** confirmar, confirmo, confirmação, comparecer.
- **Tipo / fontes:** `fluxo` · Confirmar (o da entrada: data de nascimento → atendimento → confirma).
- **Observação:** "sim" ou "vou" sozinhos nunca vêm para cá (são respostas de passo).

### CF2. Minha consulta está marcada? Para quando é?
- **Sinônimos:** que dia é minha consulta; que horas é minha consulta; tenho consulta marcada; quero ver meu
  agendamento; esqueci o horário.
- **Palavras-chave:** minha consulta, meu exame, meu agendamento, marcada, marcado + quando, que dia, que horas.
- **Tipo / fontes:** `fluxo` · Atendimentos do contato (o da entrada, com a data de nascimento antes de qualquer
  detalhe, regra de 24/out). A BC não lê agendamento nenhum.

## 17. Lembretes

### L1. Vou receber lembrete?
- **Sinônimos:** quando chega o lembrete; vocês avisam antes; mandam mensagem antes da consulta; como recebo o
  lembrete.
- **Palavras-chave:** lembrete, lembrar, avisam, aviso.
- **Tipo / fontes:** `modelo` · `lembrete` (item "Lembrete automático", ligado, véspera/no dia e hora).
- **Resposta:** "Sim! Enviamos um lembrete por aqui {na véspera | no dia}, por volta das {hora}h, com os botões
  para confirmar, remarcar ou cancelar."
- **Sem dado:** lembrete desligado → não responde.

## 18. Atendimento humano

O pedido digitado ("atendente", "recepção", "humano"…) continua como hoje, antes da BC.

### H1. Quero falar com o médico
- **Sinônimos:** falar com a doutora; falar com o dentista; mandar mensagem para o médico; o médico pode me
  responder.
- **Palavras-chave:** falar, conversar, mensagem + médico(a), doutor(a), dentista, profissional.
- **Tipo / fontes:** `recepcao` · "Quem responde por aqui é a recepção. Você quer falar com a recepção?" (Sim/Não,
  como o pedido digitado). Sem recepção no app: "{designação} responderá sua mensagem em breve." e o menu.

### H2. Qual o telefone da clínica?
- **Sinônimos:** posso ligar; tem outro número; qual o número para ligar; tem telefone fixo.
- **Palavras-chave:** telefone, ligar, ligação, número, fixo.
- **Tipo / fontes:** `fixo` · "Este WhatsApp é o canal de atendimento {da clínica}. Pode falar por aqui mesmo."
  + com recepção no app: o Sim/Não da recepção.

## 19. Dúvidas gerais

### G1. Obrigado / tchau
- **Sinônimos:** obrigado(a); obg; valeu; brigado; ok obrigado; tchau; até logo; só isso.
- **Palavras-chave:** obrigad, obg, valeu, tchau, até logo.
- **Tipo / fontes:** `fixo` · "Por nada! Se precisar, é só mandar mensagem por aqui." Não repete o menu nem conta
  como "não entendi". Num passo que espera resposta, repete o passo.

### G2. Oi / bom dia
- **Sinônimos:** olá; bom dia; boa tarde; boa noite; oi tudo bem.
- **Tipo / fontes:** `fixo` · "Olá!" + repete o passo. (Na 1ª mensagem, as boas-vindas de hoje; a BC não entra.)

### G3. É um robô?
- **Sinônimos:** estou falando com robô; é automático; tem alguém aí; é uma pessoa.
- **Palavras-chave:** robô, automático, alguém aí, pessoa.
- **Tipo / fontes:** `fixo` · "Sou o atendimento automático {da clínica}. Se quiser falar com a recepção, é só
  escrever *atendente*." (sem recepção no app: sem a 2ª frase).

---

## 20. Dicionário de especialidades (decisão 11)

Nome canônico → como o paciente fala. Cruza com o texto da especialidade (e da profissão) do cadastro da clínica.

| Especialidade | Termos do paciente |
|---|---|
| Pediatria | pediatra, médico de criança, médico infantil |
| Clínica médica | clínico geral, médico geral, clínico |
| Cardiologia | cardiologista, cardio, médico do coração |
| Pneumologia | pneumologista, pneumo, médico do pulmão, respiração |
| Pneumologia pediátrica | pneumopediatra, pneumo infantil, médico do pulmão de criança |
| Dermatologia | dermatologista, dermato, médico de pele |
| Ginecologia e obstetrícia | ginecologista, gineco, GO, obstetra, pré-natal |
| Ortopedia | ortopedista, médico de osso, coluna, joelho |
| Otorrinolaringologia | otorrino, médico de ouvido, nariz e garganta |
| Oftalmologia | oftalmologista, oftalmo, oculista, médico de olho, vista |
| Neurologia | neurologista, neuro |
| Neuropediatria | neuropediatra, neuro infantil |
| Psiquiatria | psiquiatra |
| Endocrinologia | endocrinologista, endócrino, endocrino, tireoide |
| Gastroenterologia | gastroenterologista, gastro, médico do estômago |
| Urologia | urologista, uro |
| Nefrologia | nefrologista, médico do rim |
| Alergia e imunologia | alergista, imunologista |
| Reumatologia | reumatologista, reumato |
| Geriatria | geriatra, médico de idoso |
| Hebiatria | hebiatra, médico de adolescente |
| Odontologia (clínica geral) | dentista, clínico geral dentista |
| Odontopediatria | odontopediatra, dentista de criança, dentista infantil |
| Ortodontia | ortodontista, aparelho, aparelho nos dentes |
| Endodontia | endodontista, canal, tratamento de canal |
| Periodontia | periodontista, gengiva |
| Implantodontia | implante, implante dentário |
| Prótese dentária | prótese, dentadura |
| Cirurgia bucomaxilofacial | bucomaxilo, siso, tirar o siso |
| Psicologia | psicólogo(a), terapia, terapeuta |
| Fisioterapia | fisioterapeuta, fisio |
| Fonoaudiologia | fonoaudiólogo(a), fono |
| Nutrição | nutricionista, nutri, dieta |
| Terapia ocupacional | terapeuta ocupacional, TO |

## 21. Filtro clínico (decisão 9)

Antes da BC. Mensagem com termo destes grupos → "Por aqui não conseguimos dar orientação de saúde." + "Quer falar
com a recepção?" (Sim/Não; sem recepção no app: o aviso e o menu).

- **Sintomas:** dor, febre, tosse, sangramento, sangrando, vômito, diarreia, falta de ar, cansaço, alergia,
  coceira, mancha, inchaço, inchado, convulsão, desmaio, machucou, caiu, bateu a cabeça.
- **Remédio:** remédio, medicamento, dose, dosagem, posso tomar, posso dar, antibiótico, gotas, mg, xarope,
  pomada, vacina (reação).
- **Resultado e diagnóstico:** meu exame deu, o resultado deu, está normal, é normal, é grave, o que pode ser, o
  que eu tenho, interpretar, valor de referência.

Não acionam: "jejum", "preparo", "exame" sozinho, nome de serviço ou especialidade (ex.: "consulta de alergia" →
S2/S4), "resultado do exame saiu/ficou pronto" (X2).

**Sintoma com pedido de marcação** ("quero marcar, meu filho está com febre"): abre a marcação (M1), sem nenhuma
orientação sobre o sintoma (Q1).

## 22. Fora da base nesta carga (sem dado no cadastro)

Seguem como o "não entendi" de hoje: documentos necessários (decisão 8); estacionamento e acessibilidade; multa
ou prazo para cancelar; nota fiscal e recibo; reembolso; autorização ou guia do plano; Instagram e redes sociais;
"não recebi o lembrete". Podem entrar depois, com o dado cadastrado.

## 23. Decisões do cliente sobre o catálogo (31/out/2026)

- **Q1.** Sintoma com pedido de marcação: abre a marcação, sem orientar (seção 21).
- **Q2.** Registro no conselho fora da P2; entrada própria (P3) quando o paciente pergunta.
- **Q3.** Plano não encontrado: "Não encontrei {texto} entre os convênios que atendemos: {lista}".
- **Q4.** Clínica sem domiciliar: "No momento não fazemos atendimento domiciliar."
- **Q5.** Resultado de exame (administrativo): entrada própria (X2) que oferece a recepção, sem o aviso de saúde.
- **Q6.** Agradecimento e saudação ficam na base (G1, G2).
