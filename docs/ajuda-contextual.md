# Ajuda contextual: padrão do painel e das páginas do paciente

Projeto pedido pelo cliente em 23/out/2026: o usuário entende o que cada campo, indicador e
funcionalidade faz sem recorrer ao suporte. Etapas: 1 diagnóstico, 2 padrões (este documento),
3 regras de UX, 4 componentes, 5 inventário, 6 proposta visual (canvas), 7 implementação, 8 testes.

## Diagnóstico (Etapa 1, 23/out)

- 69 telas (59 do painel, 6 do paciente, mais login e senha), cerca de 250 campos com rótulo.
- Astro 7 + Tailwind 4, sem biblioteca de interface; nenhum componente de tooltip ou popover.
- Base a reaproveitar: o "i" dos indicadores (`metricas/Kpi.astro`, `<details>`, funciona sem
  JavaScript, pelo teclado e pelo toque; Esc e tocar fora fecham), o texto `HINT` (~150 usos),
  `Notice`, `ConfigEmpty`, `FormMessage`/`FlashMessage`, `Attention`.
- Problemas: P1 orientação não ligada ao campo (`aria-describedby` em só 11 arquivos); P2 dois
  estilos de campo (`fieldStyles.ts`, antigo, em 5 telas da Agenda); P3 nenhum "Como funciona?";
  P4 legenda das situações sem explicação; P5 termos técnicos para a clínica (template, marcadores,
  24 horas, execução); P6 termos do ramo sem explicação (RQE, ANS, CNES, regime especial); P7
  gráficos e blocos das Métricas sem a regra; P8 erros genéricos ("Não foi possível salvar. Tente de
  novo."); P9 estados vazios sem dizer como a lista se enche; P10 telas do Suporte técnicas (prioridade
  baixa).

## Os 5 tipos de ajuda (Etapa 2)

Escolha pela pergunta: **"sem isto, a pessoa erra o preenchimento?"** Se sim, o texto fica
**visível** (B). Se só ajuda a entender, fica **atrás do ícone** (A ou D). Se é uma regra que
atravessa a tela inteira, vai no **"Como funciona?"** (C).

### A. Ajuda curta no campo (ícone "i")

- **Quando:** o rótulo não basta para entender **para que serve** ou **o que muda** (ex.: "Prazo
  para oferecer horários", "RQE", "Intervalo entre atendimentos"). Nunca em campo óbvio (Nome,
  Data de nascimento, E-mail).
- **Conteúdo:** 1 a 3 frases, até ~280 caracteres. Ordem: para que serve → o que muda → exemplo
  (quando ajuda). Começa pelo assunto, sem "Este campo…". Sem repetir o rótulo.
- **Interação:** botão "i" ao lado do rótulo; **toque ou clique abre**, de novo fecha; Esc fecha
  e devolve o foco ao botão; tocar fora fecha; um aberto por vez. **Hover não abre** (no celular
  não existe e, no computador, abre sem querer).
- **Onde abre:** **logo abaixo do rótulo, dentro do fluxo da tela** (empurra o campo para baixo),
  não flutuando. Assim nunca é cortado por tabela com rolagem nem sai da tela no celular, e não
  precisa de cálculo de posição.
- **Acessibilidade:** é um botão de verdade (`<summary>`), com nome "Ajuda: {rótulo}"; área de toque
  de 44px no celular (o ícone visível pode ser menor); o texto aberto fica ligado ao campo.

### B. Orientação visível perto do campo

- **Quando:** formato, unidade, limite, regra de preenchimento ou consequência que a pessoa precisa
  saber **antes** de preencher (ex.: "Contado da última consulta na mesma agenda. Vazio = sem prazo.").
- **Conteúdo:** 1 frase curta, abaixo do campo. Não repete o rótulo nem o exemplo do placeholder.
  A unidade vai no rótulo quando couber ("Duração (min)").
- **Acessibilidade:** sempre ligada ao campo por `aria-describedby`, para o leitor de tela ler junto.
- **Erro:** a mensagem de erro do campo entra no lugar da orientação (mesma posição), em vermelho,
  e a orientação volta quando o erro some.

### C. "Como funciona?" das funcionalidades

- **Quando:** funcionalidade com regra de negócio que a pessoa precisa entender para confiar no
  resultado (Lista de espera e oferta de vaga, Série, Bloquear e cancelar, Retomar contato,
  Aguardando remarcação, limites do bot, Lembretes, Mensagens, carga da agenda, DMED, Nota fiscal).
- **Formato:** link discreto "Como funciona?" no cabeçalho da seção ou do cartão; abre um painel
  **dentro da página**, logo abaixo, com no máximo 4 blocos curtos:
  1. **Para que serve** (1 frase);
  2. **Como funciona** (3 a 5 itens, as regras de verdade);
  3. **Exemplo** (uma situação concreta, com datas e horários);
  4. **Se algo der errado** (o problema comum e o que fazer), quando houver.
- **Lembrar:** fica fechado por padrão; aberto uma vez, a tela lembra só no navegador da pessoa
  (conveniência, sem banco).

### D. Ajuda dos indicadores e gráficos

- **Quando:** todo número ou gráfico das Métricas e do Início cuja conta não é óbvia. Hoje só os 8
  indicadores do alto têm; passa a valer também para gráficos, tabelas e blocos.
- **Conteúdo, nesta ordem:** o que mostra (1 frase) → **a conta** ("Compareceram ÷ (compareceram +
  faltaram)") → **qual data vale** (do atendimento, da marcação, do cancelamento) → **o que fica de
  fora** → diferença do indicador parecido, quando houver.
- **Regra de ouro:** a conta escrita é a **conta do código**. Cada texto é conferido na função que
  calcula (`src/lib/data/` ou função do banco) e o arquivo fica anotado no inventário.
- **Interação:** a mesma do "i" (A). Nos cartões de indicador, abre como hoje, sobre o cartão.

### E. Mensagens e estados do sistema

Os exemplos abaixo mostram a **forma**; o texto final de cada tela é conferido na regra do código
no inventário (Etapa 5).

- **Erro:** **o que aconteceu + por que (quando se sabe) + o que fazer.** Ex.: em vez de "Não foi
  possível salvar. Tente de novo.", "Não salvamos: o horário de fim é antes do início. Corrija o fim
  e salve de novo." Quando o motivo é falha técnica: "Não salvamos por uma falha do sistema (já
  registrada para o suporte). Tente de novo em instantes."
- **Estado vazio:** o que é a lista + como ela se enche + a ação, se houver. Ex.: "Ninguém na lista
  de espera. Entra aqui quem já tem horário marcado e pede para antecipar, pelo WhatsApp ou pela
  recepção."
- **Confirmação de ação de impacto** (já existe na Agenda): diz a consequência **antes** de
  confirmar ("3 pacientes serão avisados pelo WhatsApp").
- **Sucesso:** curto e com o resultado ("Bloqueio salvo. 2 atendimentos cancelados e avisados.").

## Escrita (vale para todos)

- Português do Brasil, frases curtas, voz ativa, "você" só quando precisar.
- Sem termos técnicos para a clínica: "mensagem aprovada pela Meta" (não "template"), "campos que
  mudam sozinhos, como o nome do paciente" (não "marcadores"/"variáveis"), "quem não falou com a
  clínica nas últimas 24 horas" (explicar a regra da Meta, não citá-la como sigla).
- Termos do ramo (RQE, ANS, CNES, ISS) ficam, mas com o significado por extenso na ajuda.
- O vocabulário segue o perfil da clínica (`vocabulary`: paciente/cliente, profissional etc.);
  a ajuda usa as mesmas palavras da tela.
- Glossário fixo (o mesmo termo em todo o painel): **atendimento** (o que está marcado), **serviço**
  (Consulta, Retorno, Exame…), **agenda** (de um profissional ou da equipe), **horário** (o bloco de
  disponibilidade em Configurações), **lembrete** (mensagem antes do atendimento), **aviso**
  (mensagem de marcação, remarcação ou cancelamento), **bot** (o atendimento automático no WhatsApp),
  **recepção** (as pessoas da clínica).
- Nunca escrever regra que não esteja no código; regra indefinida vira pendência neste documento.

## Componentes (Etapa 4, proposta)

Tudo em Astro, sem biblioteca nova e sem mudar o banco. Funciona sem JavaScript (`<details>`); o
JavaScript só melhora (Esc, tocar fora, um aberto por vez, lembrar o "Como funciona?").

| Componente | Tipo | O que faz | Reaproveita |
|---|---|---|---|
| `ui/HelpTip.astro` | A e D | Botão "i" + texto. `variant="inline"` (padrão): abre abaixo do rótulo, no fluxo. `variant="card"`: balão sobre o cartão, como o indicador de hoje. Nome acessível "Ajuda: {assunto}"; 44px de toque no celular. | O `<details>` do `metricas/Kpi.astro`, que passa a usar este componente |
| `scripts/helpTips.ts` | A, C e D | Esc fecha e devolve o foco, tocar fora fecha, um aberto por vez. Carregado nas molduras (`AdminLayout`, `PatientLayout`, `PublicLayout`). | O script do "i" que hoje está só em `metricas.astro` |
| `ui/Field.astro` + `ui/field.ts` | A, B e E | Rótulo + "i" opcional + o campo (slot) + orientação + erro do campo. `field.ts` dá os ids e o `aria-describedby` do campo (o slot do Astro não recebe atributos). O erro do campo aparece no lugar da orientação. | `LABEL`/`HINT` de `config/formStyles.ts`; as 5 telas com o `fieldStyles.ts` antigo passam para o estilo do redesign |
| `ui/HowItWorks.astro` | C | Link "Como funciona?" no cabeçalho da seção; painel na página com "Para que serve", "Como funciona" (itens), "Exemplo" e "Se algo der errado". Fechado por padrão; lembra aberto só no navegador (`localStorage`, com try/catch). | `Notice` (tom informação) para a caixa |
| `ui/EmptyState.astro` | E | O que é a lista + como ela se enche + a ação. | `config/ConfigEmpty.astro`, que passa a usar este componente |

**Mensagens (E), sem componente novo:**
- Os textos genéricos ficam num lugar só (`GENERIC` em `src/lib/data/formAction.ts`) e são
  reescritos no padrão "o que + por quê + o que fazer".
- O aviso de erro (`Flash`) passa a levar a mensagem **de cada campo** (hoje leva só o nome do
  campo), para o `Field` mostrar o erro embaixo do campo; o aviso no alto do formulário continua.

**Onde ficam os textos:** um catálogo por módulo em `src/lib/ajuda/` (`agenda.ts`,
`configuracoes.ts`, `pacientes.ts`, `financeiro.ts`, `metricas.ts`, `publico.ts`, `suporte.ts`),
para o "i" (A), o "Como funciona?" (C) e os indicadores (D). Cada texto de regra anota o arquivo que
calcula ou decide (ex.: `src/lib/data/botFunnel.ts`). A orientação visível (B) continua escrita na
própria tela, como hoje. Um teste confere os limites (A até ~280 caracteres; C com no máximo 5
itens) e que todo texto do catálogo é usado em alguma tela.

## Inventário (Etapa 5, 23/out)

[Inventário da ajuda contextual](https://claude.ai/artifact/SXkvcsAALCLhDeDApcyxnk): 56 pontos em 10
módulos (Agenda, Resumo do Dia, Início, Configurações, Pacientes, Financeiro, Métricas, páginas do
paciente, mensagens do sistema e Suporte), 22 de prioridade Alta. Cada ponto traz a dúvida, o tipo,
o texto sugerido, a regra de origem e o critério de aceite. 35 regras já conferidas no código ou nas
decisões; 21 marcadas "conferir na implementação" (o texto só vai para a tela depois de conferido no
arquivo indicado). Correção feita na conferência: a lista de espera é de quem **já tem horário e quer
antecipar** (`src/lib/data/waitlist/offers.ts`), não de quem não achou vaga.

## Proposta visual (Etapa 6, 23/out)

[Canvas da ajuda contextual](https://claude.ai/artifact/MjDsWH1x5HugKCcxZeUsP1), 5 quadros: (1) o padrão,
com os 5 tipos e os estados fechado, foco pelo teclado e aberto; (2) Configurações › Serviço com "i"
em Tipo e Como é marcado e a orientação visível no Prazo do retorno; (3) celular (390px) com o "i" de
44px de toque e o erro embaixo do campo; (4) Resumo › Lista de espera com o "Como funciona?"; (5)
Métricas › Agendamento digital com o balão do indicador e o "i" dentro do bloco "Como terminaram".
Os quadros 2 a 5 funcionam no Play (abrir e fechar).

## Implementação (Etapa 7)

Em 3 partes, aprovadas pelo cliente em 23/out: **7a** componentes e catálogo, **7b** mensagens do sistema
(`GENERIC` de `formAction.ts` e o erro de cada campo no aviso), **7c** os pontos de prioridade Alta, módulo a
módulo. O cliente valida cada parte antes da seguinte.

**7a (23/out), implementada, testada no navegador local e publicada no staging (sem migração); o cliente valida a Etapa 7 inteira no fim:**
- `ui/HelpTip.astro` (inline e card), `ui/Field.astro` + `ui/field.ts`, `ui/HowItWorks.astro`,
  `ui/EmptyState.astro` e `src/scripts/helpTips.ts`, este nas 3 molduras (`AdminLayout`, `PatientLayout`,
  `PublicLayout`). O texto do "i" inline fica fora do `<details>` e aparece por CSS (`:has`), para abrir
  abaixo do rótulo e empurrar o campo. A setinha só aparece com JavaScript.
- Catálogo em `src/lib/ajuda/` (`tipos.ts`, `configuracoes.ts`, `resumo.ts`), com o teste
  `catalogo.test.ts` (dica até 280 caracteres, "Como funciona?" com até 5 itens e todo texto usado numa tela).
- Já usam os componentes: o `Kpi` das Métricas (o "i" passou a se chamar "Ajuda: {indicador}"; o script
  antigo saiu de `metricas.astro`) e o `ConfigEmpty`. Pilotos com a regra conferida: o "i" do **Tipo** em
  Configurações › Serviços (sem o Exame quando o item está desligado) e, no Resumo › **Lista de espera**, o
  "Como funciona?" (regras conferidas em `offers.ts`) e a lista vazia explicada.
- Conferido em 1280 e 360px: Enter abre, Esc fecha e devolve o foco, clicar fora fecha, clicar no texto
  não fecha, um aberto por vez, 44px de toque no celular, sem rolagem lateral, o "Como funciona?" lembra o
  aberto ao recarregar e o "Fechar" devolve o foco. `npm test` (617) e `astro check` sem erros.

**7b (23/out), implementada, testada no navegador local e publicada no staging (sem migração):**
- Avisos genéricos do painel (`GENERIC` em `src/lib/data/formAction.ts`) com os textos aprovados no
  inventário: falha do sistema, sem permissão, recurso fora do plano, cadastro não encontrado e limite de
  profissionais. O "em uso" ficou **sem** o "Desative em vez de apagar": ele só acontece ao tirar ligações
  (agenda ou local de um serviço), horários, feriados e membros, onde não existe "Desativar" (critério do
  inventário: "só onde existe Desativar"). Texto: "Não dá para tirar: está em uso (ex.: tem atendimentos ou
  horários ligados)."
- As páginas sem login (`/formulario` e `/importar`) seguem com os textos antigos (`GENERIC_PUBLIC`): lá não
  há papel nem plano, e elas não guardam o que foi digitado.
- O aviso (`Flash`) leva a mensagem de cada campo (`fieldMessages`). O `keepFormValues` põe cada uma
  embaixo do campo (depois da linha do campo, nunca no meio dela; no fim do grupo de rádios ou caixas), no
  lugar da orientação ligada ao campo pelo `Field`. Se todas acharam o campo, o aviso do alto fica curto
  ("Não salvamos: confira o campo marcado." ou "os N campos marcados"); senão, segue com todas. Sem
  JavaScript, nada muda. Digitar no campo tira o erro dele.
- Conferido no Novo serviço (3 campos errados, cada um com a sua mensagem, os valores de volta e o foco no
  primeiro) e no cartão "Editar" da Clínica (aviso dentro do cartão). `npm test` (619) e `astro check`.

**7c (23/out), pontos de prioridade Alta, módulo a módulo, cada um publicado no staging (sem migração):**
- **Agenda:** "Como funciona?" da legenda das situações na Agenda do Dia e no Resumo do Dia (o "Confirmado"
  conferido: botão "Confirmar presença" do lembrete, a mesma confirmação pelo bot, ou a recepção no cartão);
  "i" junto do selo "Faltou X de Y" (regra de `isFrequentNoShow`), num balão novo (`HelpTip` variant `pop`)
  que não estica o cartão e não passa da tela no celular; no Bloquear, com atendimentos no período, as duas
  consequências escritas antes dos botões. Conferido no local em 1280 e 360px, com um paciente de teste com 2
  faltas (criado e apagado no banco local).
- **Configurações:** "i" do Prazo para oferecer horários (Clínica); "Como funciona?" dos limites do bot
  (conferido em `botLimits.ts`), de Horários (divisão do bloco conferida em `freeSlots.ts`; o exemplo usa a
  agenda sem intervalo), de Lembretes (conferido em `reminders.ts` e `retryRules.ts`) e de Mensagens (as duas
  listas pelo nome da tela); "i" em Papéis e em Acesso às agendas (Equipe). **Correção na conferência:** o
  Profissional não entra no Financeiro (só Administrador e Recepção, `AREA_ROLES`); os textos ao lado de cada
  papel foram corrigidos (a Recepção ganhou o Financeiro). Sem "template" nem "marcador" na tela da clínica:
  "mensagens aprovadas pela Meta" e "campos automáticos", inclusive nos erros de `customMessages.ts`.
- **Pacientes:** "i" em "Quem fala com a clínica pelo WhatsApp" no Cadastrar (os envios usam o telefone do
  contato). A confirmação do Anonimizar já listava o que o banco faz e "Não dá para desfazer"; ganhou "Só a
  pedido do paciente (LGPD)" e, com o Financeiro, "Os pagamentos continuam guardados, pelo prazo fiscal".
- **Financeiro:** "i" no CPF de quem pagou (Pagamento) e "Como funciona?" da DMED (só pagamento sem CPF fica
  de fora, conferido em `dmed.astro`).
- **Métricas:** "i" no gráfico do Desempenho (conferido em `metrics_activity` e na soma da tela) e em "Como
  terminaram" (`classify` de `botFunnel.ts`). Retomar contato: a regra do inventário já está escrita no alto
  da aba; um "i" repetiria o texto, então o ponto fica atendido como está.
- Ajuste do `HelpTip`: o círculo não aumenta a linha do rótulo (campos lado a lado seguem alinhados, como Nome
  e CPF no Pagamento).
