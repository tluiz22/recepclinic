# Brief de redesign do frontend · RecepClinic

> Para o Claude Design. Baseado na auditoria de 14/10/2026
> ([relatório](frontend-audit-report.md), [cobertura](frontend-test-coverage.md)). Este documento
> explica **problemas e objetivos**; as soluções visuais ficam livres, desde que respeitem as
> restrições da seção 10.

## 1. Contexto e objetivo

O RecepClinic é a "recepção inteligente" de clínicas de saúde pequenas e médias (pediatria,
psicologia, fisioterapia, odontologia, exames), vendido como SaaS para várias clínicas. Tem três
frentes:

1. **Painel da clínica** (`/admin`): a recepção e os profissionais operam agenda, pacientes, rotina
   do dia, pagamentos e nota fiscal. É usado sobretudo **no computador da recepção**, mas também no
   celular (há barra inferior e o painel é instalável como app).
2. **Bot de WhatsApp**: marca, remarca e cancela sozinho. Não tem tela, mas muitas telas do painel
   mostram o que ele fez (Envios, Funil do bot, Contatos para revisar).
3. **Páginas públicas** abertas pelo paciente a partir do WhatsApp: escolher horário, preparo de
   exame, orientações. Usam **a cor e o logo da clínica**.

**Objetivo do redesign:** deixar o painel mais rápido de ler e de operar no dia a dia da recepção,
consistente entre telas, utilizável no celular e mais seguro contra erro e perda de dados, sem mudar
as regras de negócio.

## 2. Públicos e perfis

| Perfil | Quem é | O que mais faz | Contexto de uso |
| --- | --- | --- | --- |
| **Recepção** | Atendente, alto volume, muitas interrupções | Agenda do dia, marcar, remarcar, confirmar presença, registrar comparecimento, pagamento | Computador, telas abertas o dia todo; WhatsApp ao lado |
| **Recepção restrita** | Atendente de só algumas agendas | O mesmo, filtrado | Idem |
| **Profissional** | Médico(a), psicólogo(a), fisioterapeuta | Ver a própria agenda, ficha do paciente, métricas | Celular entre atendimentos |
| **Administrador** | Dono(a) ou gestor(a) da clínica | Configurações, equipe, financeiro, métricas, DMED | Computador, uso esporádico e longo |
| **Suporte RecepClinic** | Equipe da plataforma | Entrar em qualquer clínica, sistema, vendas, erros | Computador; todo acesso é registrado |
| **Paciente / responsável** | Público leigo, muitas vezes pai ou mãe | Escolher horário pelo link, ler preparo | **Celular**, vindo do WhatsApp |

O vocabulário muda conforme o perfil da clínica: Pediátrica usa "criança" e "responsável", Adultos
usa "paciente" e "contato", e há o perfil Misto (decisão D4).

## 3. Telas e jornadas

Inventário completo no [relatório, seção 3](frontend-audit-report.md#3-inventário-de-telas). As
jornadas que mais pesam:

| # | Jornada | Telas | Frequência |
| --- | --- | --- | --- |
| J1 | Ver o dia e agir em cada atendimento | Agenda (Dia) › cartão › Confirmar presença / Remarcar / Cancelar / Pagamento / Trilha | Contínua |
| J2 | Marcar atendimento | Agenda › Marcar (paciente › serviço › data/horário › série) › Cadastrar paciente | Muitas vezes por dia |
| J3 | Fechar o dia | Resumo do Dia (7 abas): lembretes, lista de espera, a registrar, registradas, envios | Diária |
| J4 | Receber pagamento e emitir nota | Agenda ou Ficha › Pagamento | Diária |
| J5 | Encontrar um paciente | Pacientes (busca) › Ficha › (Marcar, Pagamentos, Trilha) | Contínua |
| J6 | Configurar a clínica | Configurações (14 seções) | Na implantação e eventualmente |
| J7 | Acompanhar resultados | Métricas (6 abas), Financeiro, DMED | Semanal ou mensal |
| J8 | Paciente agenda pelo link | `/agendar/[token]` | Do lado do paciente |
| J9 | Suporte entra numa clínica | Escolher clínica › painel › Trocar | Diária (Suporte) |

## 4. Problemas de UX e interface encontrados

Os defeitos (com ID) estão confirmados no navegador; os itens "U" são observações de design.

| Tema | O que acontece | IDs |
| --- | --- | --- |
| **Perda de dados em formulários** | Em quase todos os formulários de Configurações e no Pagamento, um erro apaga os outros campos ou volta valores ao padrão | F-02, F-03 |
| **Rótulo enganoso** | Na tela Marcar, o botão de sair mostra "Marcar" | F-01 |
| **Erro longe do campo** | A mensagem aparece no topo, sem destaque no campo, e o foco se perde | A-02 |
| **Agenda densa na primeira dobra** | Busca, filtro, data e legenda empilhados antes dos atendimentos; colunas fixas com rolagem lateral já no computador | U-01 |
| **Cartão de atendimento carregado** | 6 ações em 3 linhas, todas com o mesmo peso | U-02 |
| **Componentes que mudam de tela para tela** | Abas sublinhadas × pílulas; cartões de número diferentes no Início e nas Métricas; "Voltar" × "‹ Nome da tela" | U-03, U-04, U-05 |
| **Hierarquia de títulos** | As listas de Configurações têm o título "Configurações"; os formulários têm título próprio | U-06 |
| **Menu do Suporte** | 13 itens em 2 ou 3 linhas; "Trocar" de clínica invisível | U-07, F-05 |
| **Configurações › Clínica** | Uma tela muito longa com um só "Salvar"; rolagem lateral no celular | U-11, F-04 |
| **Celular** | "Resumo do Dia" cortado na barra inferior; alvos de toque pequenos em formulários longos | F-07, A-04 |
| **Mensagens** | Textos de erro desiguais e pouco orientadores | U-08 |
| **Acessibilidade** | 14 campos sem rótulo; sem "pular para o conteúdo" | A-01, A-03 |
| **Acabamento** | Data "Sexta-Feira, 23 De Outubro De 2026" | F-08 |

**O que já funciona bem e deve ficar:** o "Voltar" leva de fato à tela de origem, com data e busca
(21 de 23 jornadas); diálogos de confirmação acessíveis por teclado; aviso claro de acesso negado;
páginas públicas limpas e legíveis no celular; carregamento rápido.

## 5. Capturas de referência

Todas em [`evidencias/`](evidencias/), com dados fictícios do ambiente local. Padrão de nome:
`<id>-desktop.jpg` (1280px, página inteira) e `<id>-390.jpg` (celular, página inteira). A pílula
escura no pé das capturas é a barra de desenvolvimento do Astro: ignorar.

| Tela | Computador | Celular |
| --- | --- | --- |
| Início | [adm-01](evidencias/adm-01-inicio-desktop.jpg) | [adm-01](evidencias/adm-01-inicio-390.jpg) |
| Agenda (dia com atendimento) | [adm-03](evidencias/adm-03-agenda-dia-com-dados-desktop.jpg) | [adm-03](evidencias/adm-03-agenda-dia-com-dados-390.jpg) |
| Agenda semana / mês | [adm-04](evidencias/adm-04-agenda-semana-desktop.jpg) · [adm-05](evidencias/adm-05-agenda-mes-desktop.jpg) | [adm-04](evidencias/adm-04-agenda-semana-390.jpg) · [adm-05](evidencias/adm-05-agenda-mes-390.jpg) |
| Marcar (passo 3, série) | [F-01b](evidencias/F-01b-marcar-serie-cabecalho.jpg) | [adm-06](evidencias/adm-06-agenda-marcar-390.jpg) |
| Bloquear | [adm-07](evidencias/adm-07-agenda-bloquear-desktop.jpg) | [adm-07](evidencias/adm-07-agenda-bloquear-390.jpg) |
| Pacientes / Ficha | [adm-16](evidencias/adm-16-pacientes-desktop.jpg) · [adm-18](evidencias/adm-18-paciente-ficha-desktop.jpg) | [adm-18](evidencias/adm-18-paciente-ficha-390.jpg) |
| Resumo do Dia | [adm-21](evidencias/adm-21-resumo-dia-desktop.jpg) · [adm-26](evidencias/adm-26-resumo-confirmadas-desktop.jpg) | [adm-21](evidencias/adm-21-resumo-dia-390.jpg) |
| Métricas | [adm-28](evidencias/adm-28-metricas-visao-geral-desktop.jpg) · [adm-32](evidencias/adm-32-metricas-funil-desktop.jpg) | [adm-28](evidencias/adm-28-metricas-visao-geral-390.jpg) |
| Financeiro / Pagamento / DMED | [adm-34](evidencias/adm-34-financeiro-desktop.jpg) · [adm-15](evidencias/adm-15-pagamento-desktop.jpg) · [adm-35](evidencias/adm-35-financeiro-dmed-desktop.jpg) | [adm-15](evidencias/adm-15-pagamento-390.jpg) |
| Configurações › Clínica | [adm-36](evidencias/adm-36-config-desktop.jpg) | [adm-36](evidencias/adm-36-config-390.jpg) (rolagem lateral) |
| Configurações › formulário com erro | [FORM-03](evidencias/FORM-03.jpg) (campos apagados) | |
| Configurações › Serviço | [adm-47](evidencias/adm-47-config-servico-novo-desktop.jpg) | [adm-47](evidencias/adm-47-config-servico-novo-390.jpg) |
| Cabeçalho do Suporte | [1280](evidencias/sup-13-cabecalho-1280.jpg) · [1024](evidencias/sup-13-cabecalho-1024.jpg) · [768](evidencias/sup-13-cabecalho-768.jpg) | |
| Sistema › Vendas | [sup-07](evidencias/sup-07-sistema-vendas-desktop.jpg) | [sup-07](evidencias/sup-07-sistema-vendas-390.jpg) |
| Público: agendar | [pub-02](evidencias/pub-02-agendar-avaliacao-desktop.jpg) | [pub-02](evidencias/pub-02-agendar-avaliacao-390.jpg) |
| Público: preparo | [pub-07](evidencias/pub-07-preparo-desktop.jpg) | [pub-07](evidencias/pub-07-preparo-390.jpg) |
| Login | [pub-10](evidencias/pub-10-login-desktop.jpg) | [pub-10](evidencias/pub-10-login-390.jpg) |

## 6. Melhorias recomendadas por tela

Objetivos, não soluções. O "porquê" está entre parênteses.

**Agenda (Dia, Semana, Mês)**
- Mostrar os atendimentos do dia na primeira dobra do computador; filtros e busca mais compactos (U-01).
- Ver todas as agendas do dia sem rolagem lateral em 1280px, ou deixar claro que há mais colunas (U-01).
- No cartão, separar a ação principal do momento (confirmar presença, registrar comparecimento) das
  secundárias e da destrutiva (Cancelar), mantendo os botões compactos (U-02).
- Legenda de status mais legível; o status também precisa ser entendido sem depender só da cor.

**Marcar**
- Deixar claro o progresso dos 3 passos e o resumo do que vai ser marcado antes de confirmar.
- Repensar o vínculo entre o dia escolhido na Agenda e os horários oferecidos (U-09, depende do cliente).
- Quando "série" está marcada, o botão e a confirmação devem dizer isso (F-01).

**Formulários (todos)**
- Erro **no campo** (destaque + texto abaixo), resumo no topo quando houver vários, foco no primeiro
  campo inválido, e **nenhum valor perdido** (F-02, F-03, A-02).
- Mensagens que dizem como corrigir ("WhatsApp com DDD: (84) 99999-9999") (U-08).
- Indicar obrigatório e opcional do mesmo jeito em todas as telas.

**Pagamento**
- Destacar quem pagou e o CPF que vai na nota antes de registrar (F-03, U-10).

**Resumo do Dia**
- 7 abas em pílulas; avaliar agrupamento ou contadores por aba para orientar a rotina.

**Configurações**
- Dividir "Clínica" em blocos com salvamento próprio ou navegação interna (U-11).
- Mesmo padrão de lista, formulário e título em todas as seções (U-06).
- Corrigir a largura no celular (F-04).

**Métricas e Início**
- Um só componente de indicador (número, rótulo, comparação) (U-04).

**Cabeçalho e navegação**
- Menu do Suporte agrupado (por exemplo "Clínica" × "Sistema") e "Trocar" sempre visível (U-07, F-05).
- Barra inferior do celular com rótulos que caibam (F-07).
- Link "pular para o conteúdo" (A-03).

**Páginas públicas**
- Já estão boas; manter a cor e o logo da clínica, o aviso de emergência e a leitura no celular.

## 7. Componentes a padronizar

| Componente | Hoje | Objetivo |
| --- | --- | --- |
| Abas | Sublinhadas (Agenda) e pílulas (Resumo, Métricas, Configurações) | Um padrão, com estado ativo claro e rolagem no celular |
| Link de retorno | "‹ Voltar" e "‹ Nome da tela" | Um padrão de rótulo; o destino continua sendo a origem real |
| Indicador (KPI) | Dois estilos | Um componente |
| Cartão de atendimento | Agenda, Resumo do Dia e busca usam variações | Um cartão com variações de ação por contexto |
| Mensagens (erro, sucesso, aviso) | Faixa no topo, cores próprias por tela | Faixa e erro por campo com o mesmo vocabulário visual |
| Campos de formulário | Rótulo às vezes ausente (só placeholder) | Sempre rótulo visível ou acessível |
| Botões | Primário azul, secundário com borda, destrutivo vermelho com borda | Manter a hierarquia; tamanho mínimo de toque no celular |
| Selos (status, pago, tipo) | Várias cores pequenas | Paleta de status única, legível e não só por cor |
| Diálogo de confirmação | `ConfirmDeleteDialog` (bom) | Manter; padronizar títulos e textos |
| Telefone + WhatsApp | `PhoneLinks` | Manter (regra do cliente) |

## 8. Proposta de hierarquia visual

1. **Título da tela (h1)** sempre específico do que se vê ("Profissionais", não "Configurações"),
   com o caminho de volta logo acima.
2. **Ação principal da tela** em destaque único (Marcar, Cadastrar, Registrar pagamento).
3. **Contexto e filtros** compactos, numa linha no computador e recolhíveis no celular.
4. **Conteúdo** (cartões, listas, tabelas) com o dado mais importante primeiro: horário e paciente
   na Agenda, valor e situação no Financeiro.
5. **Ações secundárias** agrupadas e menores; **destrutivas** separadas.
6. **Avisos do sistema** (lembrete não rodou, certificado vencendo) com nível visual de acordo com a
   urgência, sem competir com a tarefa do momento.

## 9. Responsividade e acessibilidade

- Larguras de referência: 390px (celular), 768px, 1024px e 1280px. Nenhuma tela com rolagem lateral
  da página; rolagem lateral só em áreas próprias (colunas da Agenda), indicada visualmente.
- Alvos de toque de pelo menos 24px (ideal 44px) nas ações dos cartões e dos formulários longos.
- Todo campo com rótulo acessível; erros ligados ao campo (`aria-invalid`, `aria-describedby`) e
  anunciados; foco no primeiro campo inválido.
- Status não só por cor; contraste a verificar (não medido nesta auditoria).
- Manter o que já funciona: ordem do Tab lógica, foco visível, diálogo que prende o foco e fecha com Esc.

## 10. Restrições a preservar

**Decisões do cliente (não mudar sem ele):**
- **Toda ação que muda um atendimento na Agenda e no Resumo do Dia pede confirmação**, pelo diálogo
  do painel (nunca o `confirm` do navegador), dizendo o que vai acontecer, com qual paciente e horário.
- **Ações com cara de botão; descrições sem cara de clicável.** Botões dos cartões **compactos**,
  do tamanho do texto, nunca esticados na largura toda.
- **Telefone é texto simples** (sem link de ligação), com o botão do WhatsApp ao lado; sem rótulo
  quando o paciente fala por si; com responsável: "Responsável: Nome · número".
- **"Voltar" leva à tela de onde a pessoa veio** (parâmetros `volta`/`return_to`), inclusive depois
  de salvar.
- Sem "Cancelar selecionados" na Agenda: cancelar vários é pelo "Bloquear e cancelar".

**Regras de negócio e arquitetura** ([`docs/arquitetura.md`](../arquitetura.md)):
- Papéis e permissões do painel (D6) e isolamento por clínica (D1): o menu e as telas variam por perfil.
- Vocabulário e configuração por clínica e nicho (D4): Pediátrica, Adultos ou Mista; os textos mudam.
- Agendas por clínica (D2), atendimentos recorrentes/séries (D9), convênios (D10).
- Páginas públicas com a identidade da clínica (cor e logo configuráveis) e o aviso de emergência.

**Restrições técnicas:**
- Astro com renderização no servidor; formulários são `POST` HTML que funcionam sem JavaScript.
  Interatividade em scripts pequenos, sem framework de componentes no cliente.
- **CSP**: nada de JavaScript em atributos (`onclick`, `onchange`); estilos inline só em atributo
  (usados para a cor da clínica e as barras do funil). Imagens externas só por https.
- Tailwind CSS 4. Painel instalável (manifest e ícones).
- Português do Brasil em toda a interface.

## 11. Prioridades de redesign

| Ordem | Tema | Por quê | Telas |
| --- | --- | --- | --- |
| 1 | Formulários seguros (erro no campo, nada se perde, rótulo certo nos botões) | Perda de dados e erro fiscal (F-01, F-02, F-03, A-02) | Marcar, Pagamento, Configurações, Pacientes |
| 2 | Agenda (Dia) e cartão de atendimento | Tela mais usada; densidade e primeira dobra (U-01, U-02) | Agenda, Resumo do Dia, busca |
| 3 | Sistema de componentes (abas, KPI, retorno, mensagens, selos) | Consistência (U-03 a U-06, U-08) | Todas |
| 4 | Configurações reorganizadas e responsivas | Tela longa e quebrada no celular (U-11, F-04) | Configurações |
| 5 | Navegação: cabeçalho do Suporte, barra do celular, "pular para o conteúdo" | F-05, F-07, U-07, A-03 | Layout |
| 6 | Acabamento (datas, ícone, textos) | F-08, A-05 | Várias |
