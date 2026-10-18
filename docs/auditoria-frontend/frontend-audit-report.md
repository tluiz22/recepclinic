# Auditoria de frontend: relatório técnico

> Feita em 14/10/2026 com a skill `playwright-ui-form-best-practices`, pelo MCP Playwright, no
> ambiente **local** (`npm run dev` em `http://localhost:4321` + Supabase local com o `seed.sql`).
> Só auditoria: **nenhum código da aplicação foi alterado.**
>
> **Atualização (14/10/2026):** os defeitos de severidade Alta (F-01, F-02, F-03), Média (F-04, F-05,
> A-02) e Baixa (F-06, F-08, F-09, A-01, A-03, A-05) foram corrigidos e revalidados no navegador;
> F-07 não se reproduziu fora do servidor de desenvolvimento. Status de cada achado na [seção 12](#12-status-das-correções).

## 1. Resumo executivo

O painel e as páginas públicas carregam sem erros de JavaScript e sem respostas HTTP 5xx em
**89 endereços** varridos (cada um em 1280px e 390px). Permissões por perfil e isolamento entre
clínicas se comportaram como esperado. A navegação de retorno ("Voltar") está bem resolvida:
**21 de 23** jornadas passaram.

Os problemas que mais pesam:

1. **Botão "Sair" disfarçado de "Marcar" na tela Marcar** (F-01, Alta). Um script da página muda o
   texto do botão de sair do cabeçalho para "Marcar" (ou "Marcar a série"). Quem clica é desconectado
   sem aviso, e o botão verdadeiro não reflete a série.
2. **Formulários que apagam o que foi digitado quando há erro** (F-02 e F-03, Alta). Em 8 de 12
   cenários, os campos válidos se perderam depois de um erro de validação: todos os cadastros e
   edições de Configurações e o **Pagamento**, onde o pagador e o CPF voltam ao padrão, com a
   emissão de nota marcada.
3. **Configurações › Clínica com rolagem lateral no celular** (F-04) e o **link "Trocar" (de clínica)
   invisível para o Suporte** (F-05).
4. **Acessibilidade de formulários**: mensagens de erro não ligadas aos campos, foco perdido depois
   do erro e 14 campos sem rótulo acessível.

| Severidade | Defeitos confirmados |
| --- | --- |
| Bloqueador | 0 |
| Alta | 3 (F-01, F-02, F-03) |
| Média | 3 (F-04, F-05, A-02) |
| Baixa | 7 (F-06, F-07, F-08, F-09, A-01, A-03, A-05) |

Mais 1 **suspeita** (envio duplo) e 12 **recomendações de UX** (subjetivas, separadas dos defeitos).

## 2. Ambiente e ferramentas

| Item | Valor |
| --- | --- |
| Aplicação | RecepClinic (Astro 5 SSR, adaptador Vercel, Tailwind 4, Supabase) |
| URL | `http://localhost:4321` (servidor de desenvolvimento, barra de ferramentas do Astro visível nas capturas) |
| Banco | Supabase local com dados fictícios do `supabase/seed.sql` |
| Navegador | Chromium do MCP Playwright; larguras 1280, 1024, 768 e 390px |
| Logins | Os do seed (senha local `recepclinic-local`): admin, recepção, recepção restrita, profissional (pediatra), admin da Odonto Exemplo, Suporte |
| Ferramentas | MCP Playwright (navegação, scripts de varredura, capturas); leitura do banco local só para descobrir IDs e conferir que nada foi gravado |

## 3. Inventário de telas

65 arquivos de página em `src/pages` (fora `api/`), que viram as telas abaixo. As abas por `?tab=`
contam como estados da mesma tela.

### Painel da clínica (`/admin`, com login)

| Área | Tela (rota) | Objetivo | Ações principais | Estados relevantes |
| --- | --- | --- | --- | --- |
| Início | `/admin/dashboard` | Panorama do dia | Atalhos, revisar contatos, alertas | Alertas (lembrete, certificado), contatos para revisar, aviso de acesso negado |
| Agenda | `/admin/agenda` (Dia), `/semana`, `/mes` | Ver e operar os atendimentos | Marcar, Bloquear, Bloqueios, buscar paciente, filtrar agenda, navegar datas | Dia vazio, dia com atendimentos, legenda de status |
| Agenda | `/admin/agenda/marcar` | Marcar atendimento (3 passos) | Buscar/cadastrar paciente, serviço, data/horário, série | Sem paciente, com paciente, com horários, série |
| Agenda | `/admin/agenda/remarcar` | Remarcar atendimento | Escolher novo horário | |
| Agenda | `/admin/agenda/bloquear`, `/bloqueios`, `/bloqueios/[id]` | Bloquear horários | Criar, editar, excluir bloqueio | Conflitos com atendimentos |
| Agenda | `/admin/agenda/buscar` | Atendimentos de um paciente | Buscar | Com e sem resultado |
| Agenda | `/admin/agenda/trilha/[id]`, `/serie/[id]`, `/avisar` | Histórico, série, avisar pacientes | Ver, cancelar série, avisar | |
| Pacientes | `/admin/pacientes`, `/novo`, `/[id]`, `/contato/[id]` | Cadastro e ficha | Buscar, cadastrar, editar, marcar, financeiro | Lista, busca sem resultado, ficha completa |
| Resumo do Dia | `/admin/consultas?tab=` (7 abas) | Rotina da recepção | Registrar comparecimento, lista de espera, envios | Resumo, Lembretes, Lista de espera, Aguardando remarcação, A registrar, Registradas, Envios |
| Métricas | `/admin/metricas?tab=` (6 abas) | Indicadores | Período, agenda, busca | Visão geral, Atendimentos, Faltosos, Financeiro, Funil do bot, Retomar contato |
| Financeiro | `/admin/financeiro`, `/dmed`, `/pagamento/[id]` | Pagamentos, nota e DMED | Registrar pagamento, emitir nota, gerar DMED | Sem pagamento, pago, pago em parte |
| Configurações | `/admin/configuracoes` + 13 seções (Clínica, Profissionais, Locais, Agendas, Serviços, Horários, Feriados, Convênios, Equipe, Contatos, Lembretes, Mensagens, Nota fiscal, WhatsApp\*) | Configurar a clínica | Cadastrar, editar, desativar, excluir | \*WhatsApp só para o Suporte |
| Sistema (Suporte) | `/admin/escolher-clinica`, `/admin/sistema/*` (Clínicas, Nova clínica, Matriz, Vendas/Planos, Uso, Erros, Tecnologia) | Operação da plataforma | Entrar numa clínica, cadastrar clínica, planos | |
| Acesso | `/admin/login`, `/esqueci-senha`, `/nova-senha` | Entrar e recuperar senha | | Sem sessão, link de recuperação |

### Páginas públicas (sem login, recebidas pelo paciente)

| Tela | Objetivo | Estados |
| --- | --- | --- |
| `/agendar/[token]` | Paciente escolhe data e horário | Marcar, remarcar, turma de exame, já marcado, link inválido (404) |
| `/preparo/[id]` | Preparo do exame | Com conteúdo |
| `/orientacoes/[id]` | Orientações da clínica | Sem conteúdo (404 "Orientações não encontradas") |
| `/formulario/[token]` | Formulário de cadastro da clínica (onboarding) | Só o link inválido |
| `/` | Em ambiente local, redireciona para o login | |
| `404` | Página não encontrada | |

### Perfis e o que cada um alcança (observado)

| Perfil (login do seed) | Menu | Bloqueado (vai para o Início com aviso) |
| --- | --- | --- |
| Administrador (`admin@exemplo-saude`) | Início, Agenda, Pacientes, Resumo do Dia, Configurações, Métricas, Financeiro | Sistema |
| Recepção (`recepcao@`) | Início, Agenda, Pacientes, Resumo do Dia, Financeiro | Métricas, Configurações, Sistema |
| Recepção restrita (`recepcao2@`) | Igual à Recepção; Agenda só da psicóloga e do fisioterapeuta | Pagamento de atendimento de outra agenda (vai para a Agenda) |
| Profissional (`pediatra@`) | Início, Agenda, Pacientes, Resumo do Dia, Métricas | Financeiro, Configurações, Sistema |
| Admin de outra clínica (`admin@odonto-exemplo`) | Menu completo da própria clínica | Paciente e pagamento da Clínica Exemplo (isolamento ok) |
| Suporte (`suporte@recepclinic`) | Escolher clínica; dentro dela, tudo + Sistema | |

## 4. Cobertura

| O quê | Executado |
| --- | --- |
| Varredura de telas (carrega, console, HTTP, rótulos, nomes acessíveis, rolagem no celular, capturas) | **89 endereços**, cada um em 1280 e 390px (178 capturas) |
| Cabeçalho em larguras intermediárias (Suporte) | 768, 1024, 1280 |
| Controles de retorno | **23 cenários** |
| Preservação de campos após erro | **12 cenários** em 9 formulários |
| Permissões e isolamento | 6 perfis × 10 telas |
| Teclado e diálogo de confirmação | Agenda (Tab, Enter, Esc) |
| Associação de erro e foco | 2 formulários |

Detalhe por rota em [`frontend-test-coverage.md`](frontend-test-coverage.md). **Nenhum envio que
grava dados foi feito** (marcar, cancelar, pagar, salvar, convidar), então o "reenvio após corrigir o
campo" ficou **BLOQUEADO** em todos os formulários.

## 5. Cenários executados e resultados

### 5.1 Controles de retorno (regra obrigatória)

Critério: o retorno leva à tela imediatamente anterior, com a mesma URL (parâmetros incluídos), o
mesmo título e o estado (data, busca).

| ID | Jornada | Resultado |
| --- | --- | --- |
| NAV-01 a 05 | Agenda (dia 23/10) › Marcar / Remarcar / Pagamento / Trilha / Ficha › Voltar | PASSOU (volta ao dia 23/10) |
| NAV-06, 07, 22 | Semana › Bloquear; Mês › Bloqueios; Semana › Bloqueios › Voltar | PASSOU |
| NAV-08, 23 | Bloqueios › Editar › Voltar (e dois níveis: Semana › Bloqueios › Editar › Voltar › Voltar) | PASSOU |
| NAV-09 | Pacientes (busca "Ana") › Ficha › Voltar | PASSOU (busca preservada) |
| NAV-10, 11, 12 | Pacientes › Cadastrar; Financeiro › Ficha; Início › Contato | PASSOU |
| NAV-13, 14 | Ficha › Trilha; Ficha › Marcar › Voltar | PASSOU |
| NAV-16, 17, 18, 21 | Config › Profissionais › Novo; Serviços › Editar; Equipe › Editar; Financeiro › DMED (retorno pelo link "‹ Destino") | PASSOU |
| NAV-19 | Resumo do Dia (Registradas) › Ficha › Voltar | PASSOU |
| **NAV-15** | Marcar (busca "Ana") › Cadastrar paciente novo › "‹ Marcar" | **FALHOU**: volta para Marcar, mas a busca "Ana" se perde (F-06) |
| NAV-20 | Métricas › Faltosos › paciente | BLOQUEADO: sem faltosos no seed |

### 5.2 Preservação dos campos após erro (regra obrigatória)

Cada cenário: tudo preenchido com dados fictícios, **um** campo inválido (de forma que passe na
validação do navegador e só falhe no servidor) e comparação do **valor real** de cada campo antes e
depois do envio.

| ID | Formulário · campo inválido | Mensagem | Campos válidos perdidos | Resultado |
| --- | --- | --- | --- | --- |
| FORM-01 | Cadastrar paciente · WhatsApp "123" | "Telefone inválido: informe DDD + número." | 0 de 8 | PASSOU |
| FORM-02 | Cadastrar paciente · "o próprio paciente" com 6 anos | "Paciente menor de 18 anos precisa de um responsável" | 0 de 8 | PASSOU |
| FORM-06 | Bloquear agenda · fim antes do início | "O fim precisa ser depois do início." | 0 de 9 | PASSOU |
| FORM-11 | Novo profissional · nome vazio | Validação do navegador ("Preencha este campo") | 0 (sem envio) | PASSOU |
| **FORM-03** | Novo profissional · WhatsApp "12" | "Telefone inválido" | **7 de 7** (nome, profissão, especialidade, conselho, número, UF, RQE) | **FALHOU** |
| **FORM-04** | Novo contato da equipe · WhatsApp "12" | "Telefone inválido" | **1 de 3** (nome) | **FALHOU** |
| **FORM-05** | Novo serviço · valor "abc" | "Valor inválido" | **4 de 16** (tipo, nome, duração, agenda) | **FALHOU** |
| **FORM-07** | Pagamento · valor "abc" | "Informe um valor maior que zero." | **3 de 6** (forma, nome e CPF de quem pagou voltam ao padrão) | **FALHOU** |
| **FORM-08** | Novo plano/convênio · nome só com espaços | "Informe o nome do plano" | **2 de 5** (outros nomes, código ANS) | **FALHOU** |
| **FORM-09** | Editar profissional · especialidade alterada + WhatsApp "12" | "Telefone inválido" | **1 de 7** (a especialidade volta ao valor salvo) | **FALHOU** |
| **FORM-10** | Editar serviço · duração alterada + valor "abc" | "Valor inválido" | **1 de 15** (a duração volta ao valor salvo) | **FALHOU** |
| **FORM-12** | Novo local · nome só com espaços | "Informe o nome do local" | **1 de 2** (endereço) | **FALHOU** |

Padrão observado: os formulários que **passam** enviam para a própria página (o servidor responde com
o formulário e os valores). Os que **falham** enviam para `/api/admin/...` e voltam por
redirecionamento só com a mensagem.

### 5.3 Outros cenários

| ID | Cenário | Resultado |
| --- | --- | --- |
| PERM-01 | Perfil sem acesso abre tela proibida | PASSOU: vai para o Início com "Essa tela não está disponível para o seu acesso." |
| PERM-02 | Admin da Odonto abre paciente e pagamento da Clínica Exemplo | PASSOU: não abre (isolamento) |
| PERM-03 | Recepção restrita abre pagamento de agenda que não é dela | PASSOU: vai para a Agenda |
| KB-01 | Agenda pelo teclado (Tab) | PASSOU na ordem e no foco visível; **sem link "pular para o conteúdo"** (A-03) |
| KB-02 | Diálogo "Confirmar presença" pelo teclado | PASSOU: abre com Enter, foco dentro, Esc fecha e devolve o foco ao botão |
| ERR-01 | Página inexistente (`/admin/nao-existe`, `/nao-existe`) | PASSOU: 404 com "Página não encontrada" |
| ERR-02 | Link público inválido (`/agendar/...`) | PASSOU: 404 "Link inválido" |
| CON-01 | Erros de JavaScript e HTTP 5xx nas 89 telas | PASSOU: nenhum |

## 6. Problemas funcionais (defeitos confirmados)

### F-01 · O botão de sair vira "Marcar" na tela Marcar · **Alta**

> **Status:** corrigido e validado em 14/10/2026 (seção 12).

- **Tela:** Agenda › Marcar (`/admin/agenda/marcar`), todos os perfis.
- **Critério:** controles com rótulo fiel à ação; nada destrutivo sem confirmação.
- **Passos:** 1) Agenda › Marcar. 2) Olhar o canto superior direito: o botão "Sair" mostra
  **"Marcar"**. 3) Escolher paciente, serviço e horário e marcar "Repetir este atendimento (série)":
  o botão do cabeçalho passa a **"Marcar a série"**. 4) Clicar nele.
- **Esperado:** o cabeçalho mostra "Sair"; o botão do formulário muda para "Marcar a série" e a
  confirmação para "Criar a série?".
- **Observado:** o clique no cabeçalho **encerra a sessão** sem confirmação. O botão do formulário
  continua "Marcar" e a confirmação continua "Marcar o atendimento?", mesmo com série.
- **Causa (no código):** `src/pages/admin/agenda/marcar.astro:368` usa
  `document.querySelector("form[method='POST'] button[type='submit']")`, que pega o **primeiro**
  formulário POST da página: o de sair, no cabeçalho.
- **Impacto:** a recepção pode perder o trabalho em andamento ao "marcar"; a série é criada com uma
  confirmação que diz "atendimento".
- **Evidência:** [`F-01-botao-sair-rotulado-marcar.jpg`](evidencias/F-01-botao-sair-rotulado-marcar.jpg),
  [`F-01b-marcar-serie-cabecalho.jpg`](evidencias/F-01b-marcar-serie-cabecalho.jpg),
  [`adm-06-agenda-marcar-desktop.jpg`](evidencias/adm-06-agenda-marcar-desktop.jpg).
- **Recomendação:** limitar o seletor ao formulário de marcar (por exemplo `main form[method='POST']`
  ou um `data-` próprio).

### F-02 · Cadastros e edições de Configurações perdem o que foi digitado após erro · **Alta**

> **Status:** corrigido e validado em 14/10/2026 (seção 12). Telas não testadas: corrigido mas não validado.

- **Telas:** Novo profissional, Editar profissional, Novo contato da equipe, Novo serviço, Editar
  serviço, Novo plano/convênio, Novo local (FORM-03, 04, 05, 08, 09, 10, 12).
- **Passos (ex. FORM-03):** Configurações › Profissionais › Novo; preencher nome, profissão,
  especialidade, conselho, número, UF, RQE e WhatsApp "12"; Cadastrar.
- **Esperado:** mensagem no telefone e os demais campos preenchidos.
- **Observado:** mensagem "Telefone inválido" e **o formulário inteiro em branco**. Nas edições, a
  alteração válida volta ao valor salvo, sem aviso de que não foi salva.
- **Impacto:** retrabalho e risco de desistência; nas edições, a pessoa pode achar que salvou.
- **Evidência:** [`FORM-03.jpg`](evidencias/FORM-03.jpg), [`FORM-04.jpg`](evidencias/FORM-04.jpg),
  [`FORM-05.jpg`](evidencias/FORM-05.jpg), [`FORM-08.jpg`](evidencias/FORM-08.jpg),
  [`FORM-09.jpg`](evidencias/FORM-09.jpg), [`FORM-10.jpg`](evidencias/FORM-10.jpg),
  [`FORM-12.jpg`](evidencias/FORM-12.jpg).
- **Recomendação:** devolver os valores enviados junto com o erro (como já fazem Cadastrar paciente e
  Bloquear agenda) e, se possível, apontar o campo.
- **Não verificado:** Agendas, Horários, Feriados, Lembretes, Mensagens, Nota fiscal, Equipe (convite)
  e Clínica usam o mesmo caminho (`/api/admin/configuracoes/...`) e **provavelmente** têm o mesmo
  problema. Não foram testados para não gravar dados nem enviar convite.

### F-03 · Pagamento: depois de um erro, pagador e CPF voltam ao padrão · **Alta**

> **Status:** corrigido e validado em 14/10/2026 (seção 12).

- **Tela:** Financeiro › Pagamento (`/admin/financeiro/pagamento/[id]`), FORM-07.
- **Passos:** abrir o pagamento de um atendimento; escolher **Dinheiro**, "Outra pessoa", nome
  "Pagador QA", um CPF; digitar valor "abc"; Registrar pagamento.
- **Esperado:** erro no valor e o resto mantido.
- **Observado:** erro "Informe um valor maior que zero." e a forma volta para **Pix**, o nome volta
  para o responsável financeiro salvo e o **CPF volta ao padrão**. "Emitir a nota fiscal agora" vem
  marcado.
- **Impacto:** quem corrige só o valor e reenvia registra o pagamento **e a nota fiscal no CPF de
  outra pessoa**, com a forma de pagamento errada. É um dado fiscal (e entra na DMED).
- **Evidência:** [`FORM-07.jpg`](evidencias/FORM-07.jpg).
- **Recomendação:** manter todos os valores enviados; considerar destacar pagador e CPF antes de
  confirmar.

### F-04 · Configurações › Clínica com rolagem lateral no celular · **Média**

> **Status:** corrigido e validado em 14/10/2026 (seção 12.5).

- **Tela:** `/admin/configuracoes` em 390px.
- **Observado:** a página fica com 424px de largura (rolagem horizontal). Passam da tela a linha do
  logo ("Escolher arquivo / Nenhum arquivo escolhido"), a fileira de cores e o campo "Site da clínica".
- **Evidência:** [`adm-36-config-390.jpg`](evidencias/adm-36-config-390.jpg).
- **Recomendação:** deixar a linha do arquivo e as cores quebrarem linha; campos com largura máxima
  de 100%.

### F-05 · Suporte: o link "Trocar" (de clínica) fica invisível · **Média**

> **Status:** corrigido e validado em 14/10/2026 (seção 12.5).

- **Tela:** cabeçalho do painel com o Suporte dentro de uma clínica.
- **Observado:** o link existe, mas fica fora do bloco do nome da clínica, que tem 140px e
  `overflow: hidden` (o link começa em x=230). Aparece só "Clínica Exemplo Sa…" em 768, 1024 e 1280px.
- **Contorno:** abrir `/admin/escolher-clinica` pelo endereço ou sair e entrar de novo.
- **Evidência:** [`sup-13-cabecalho-1280.jpg`](evidencias/sup-13-cabecalho-1280.jpg),
  [`-1024`](evidencias/sup-13-cabecalho-1024.jpg), [`-768`](evidencias/sup-13-cabecalho-768.jpg).

### F-06 · Marcar › Cadastrar paciente novo › "‹ Marcar" perde a busca · **Baixa**

> **Status:** corrigido e validado em 14/10/2026 (seção 12.6).

- NAV-15. O retorno leva a `/admin/agenda/marcar?date=…` sem `busca=Ana`: o campo volta vazio e a
  pessoa precisa digitar de novo. A cadeia de retorno até a Agenda se mantém.

### F-07 · "Resumo do Dia" cortado na barra inferior do celular · **Baixa**

> **Status:** não reproduzido (seção 12.6): o corte era a barra de ferramentas do Astro, que só aparece no `npm run dev`.

- Em 390px o rótulo quebra em duas linhas e "Dia" fica cortado.
  Evidência: [`adm-03-agenda-dia-com-dados-390.jpg`](evidencias/adm-03-agenda-dia-com-dados-390.jpg).

### F-08 · Data por extenso com maiúsculas erradas · **Baixa**

> **Status:** corrigido e validado em 14/10/2026 (seção 12.6).

- Agenda (Dia): "Sexta-Feira, 23 **De** Outubro **De** 2026". Causa: classe CSS `capitalize` em
  `src/pages/admin/agenda.astro:107`.
  Evidência: [`adm-03-agenda-dia-com-dados-desktop.jpg`](evidencias/adm-03-agenda-dia-com-dados-desktop.jpg).

### F-09 · Status HTTP diferentes para link público inválido · **Baixa**

> **Status:** corrigido e validado em 14/10/2026 (seção 12.6).

- `/agendar/<inválido>` responde **404** e `/formulario/<inválido>` responde **200**, ambos com
  "Link inválido". Afeta monitoramento e indexação, não o paciente.

## 7. Problemas de acessibilidade

| ID | Severidade | Problema | Onde | Evidência |
| --- | --- | --- | --- | --- |
| A-01 | Baixa | **Campos sem rótulo acessível** (só placeholder ou nada): data da Agenda e do Resumo (`date`), busca do Marcar (`busca`), serviço do Marcar (`service_id`), busca de Pacientes e Financeiro (`q`), plano de saúde no cadastro e na ficha (`plan_id`), agenda e busca em Métricas (`agenda`, `busca`), 6 textos em Configurações › Mensagens (`text`) | 14 campos em 10 telas | Varredura; snapshot do Marcar mostra `combobox` sem nome |
| A-02 | Média | **Erro de formulário não ligado ao campo:** sem `aria-invalid`, sem `aria-describedby`, sem `role="alert"`/`aria-live`; o foco vai para o `body` e a mensagem fica no topo, longe do campo | Cadastrar paciente, Novo profissional (e o mesmo componente nas demais) | [`FORM-03.jpg`](evidencias/FORM-03.jpg) |
| A-03 | Baixa | **Sem link "pular para o conteúdo"**: 8 paradas de Tab no menu antes do conteúdo em toda tela | Todo o painel | [`QA-teclado-agenda.jpg`](evidencias/QA-teclado-agenda.jpg) |
| A-04 | Indício | **Alvos de toque pequenos** (< 24px em alguma dimensão) no celular: até 11 por tela (Vendas, Pagamento, Novo serviço, Ficha). Inclui caixas de seleção e botões de opção nativos de 16px | Formulários longos | Varredura (`alvos<24`) |
| A-05 | Baixa | `favicon.ico` 404 nas páginas sem layout do painel e aviso do Chrome sobre `apple-mobile-web-app-capable` obsoleta | Login, públicas | Console |

Não foi feita auditoria WCAG completa: sem leitor de tela, sem medição de contraste, sem zoom de 200%.

## 8. Problemas de usabilidade e inconsistências visuais (recomendações, não defeitos)

| ID | Tela | Observação | Impacto |
| --- | --- | --- | --- |
| U-01 | Agenda (Dia) | Busca, seletor de agenda, data e legenda empilhados ocupam a primeira dobra; as colunas têm largura fixa e, com 4 agendas, exigem rolagem lateral já em 1280px | Mais rolagem para ver o dia |
| U-02 | Cartão de atendimento | 6 ações em 3 linhas (Confirmar presença, Lista de espera, Remarcar, Cancelar, Pagamento, Trilha), "Cancelar" ao lado das demais | Densidade; risco de clique errado (mitigado pela confirmação) |
| U-03 | Abas | Agenda usa abas sublinhadas (Dia/Semana/Mês); Resumo do Dia, Métricas e Configurações usam pílulas | Inconsistência de componente |
| U-04 | Indicadores | Início: número grande colorido e centralizado; Métricas: rótulo em caixa alta, número à esquerda | Dois padrões para o mesmo tipo de informação |
| U-05 | Retorno | Ora "‹ Voltar", ora "‹ Profissionais", "‹ Serviços", "‹ Equipe", "‹ Financeiro", "‹ Marcar" | Inconsistência de rótulo (os dois funcionam) |
| U-06 | Títulos | Listas de Configurações têm h1 "Configurações"; formulários têm h1 próprio ("Novo profissional") | Hierarquia irregular |
| U-07 | Cabeçalho (Suporte) | 13 itens + perfil em 2 linhas (1280) ou 3 linhas (768); cabeçalho de 109px | Menu pesado para o Suporte |
| U-08 | Mensagens | "Telefone inválido" vs "Telefone inválido: informe DDD + número."; valor "abc" gera "Informe um valor maior que zero." | Mensagens pouco orientadoras e desiguais |
| U-09 | Marcar | Vindo do dia 23/10 da Agenda, ao escolher o serviço a data some da URL e os horários começam no primeiro dia livre (16/10) | Pode confundir quem escolheu o dia antes. **Comportamento esperado a confirmar com o cliente** |
| U-10 | Pagamento | "Emitir a nota fiscal agora" vem marcado | Combinado com F-03, aumenta o risco. **Decisão de negócio: só registrar** |
| U-11 | Configurações › Clínica | Tela única muito longa (identidade, mensagens, perfil, páginas públicas, informações do bot, limites) com um só "Salvar" no fim | Difícil de achar e revisar; um erro perde tudo (F-02) |
| U-12 | Remarcar | O retorno usa `return_to`; as demais telas usam `volta` | Inconsistência técnica (funciona) |

## 9. Suspeitas e pontos não verificados

| Item | Situação |
| --- | --- |
| **Envio duplo** | Suspeita: os botões de envio não são desabilitados durante o envio (só aparece a barra de carregamento do layout). Confirmar exigiria gravar dados duas vezes |
| Reenvio após corrigir o campo | BLOQUEADO em todos os formulários (gravaria dados) |
| Ações da Agenda (confirmar, cancelar, lista de espera, remarcar), registrar pagamento, emitir nota, gerar DMED, convidar pessoa, salvar configurações, upload de logo e certificado | Não executadas (gravam dados ou enviam mensagens) |
| `/formulario/[token]` válido, `/admin/nova-senha` com link de recuperação, `/orientacoes` com conteúdo | BLOQUEADO: dependem de código ou e-mail que não existem no seed |
| Métricas › Faltosos com dados | BLOQUEADO: sem faltosos no seed |
| Site institucional (`/`) | Em local, redireciona ao login; não avaliado |

## 10. Limitações

- **Ambiente local de desenvolvimento**: a barra do Astro aparece nas capturas; o CSP só vale no
  build (não testado); tempos de carga (~0,6s) não representam produção.
- **Dados fictícios do seed**: nomes, telefones e CPFs nas capturas são fictícios; não há dado real.
- **Efeitos no banco local:** nenhum registro foi criado ou alterado pelos formulários (conferido no
  banco). A navegação como **Suporte dentro da clínica** gravou o registro de acesso que o sistema
  mantém ("cada tela aberta fica registrada").
- As medições automáticas (rótulos, alvos, rolagem) são heurísticas e foram confirmadas visualmente
  só nos casos citados.
- O Odonto Exemplo foi usado só para isolamento e menu, sem varredura completa.

## 11. Recomendações priorizadas

| Prioridade | Recomendação | Telas | Impacto | Justificativa |
| --- | --- | --- | --- | --- |
| 1 · Impede tarefa essencial | Corrigir o seletor do script do Marcar (F-01) | Marcar | Alto | Marcar é a tarefa central da recepção; o botão desconecta |
| 2 · Erro ou perda de dados | Devolver os valores enviados em todos os formulários `/api/admin/...` (F-02) | Configurações (todas) | Alto | Retrabalho e edições "perdidas" sem aviso |
| 2 · Erro ou perda de dados | Manter forma, pagador e CPF no Pagamento após erro (F-03) | Pagamento | Alto | Nota fiscal no CPF errado |
| 3 · Esforço do usuário | Ligar o erro ao campo, focar o primeiro campo inválido e anunciar a mensagem (A-02) | Todos os formulários | Médio | Recuperação mais rápida, inclusive com leitor de tela |
| 3 · Esforço do usuário | Corrigir a rolagem lateral de Configurações › Clínica no celular (F-04) e dividir a tela em blocos (U-11) | Configurações | Médio | Uso no celular |
| 3 · Esforço do usuário | Mostrar "Trocar" para o Suporte (F-05) e enxugar o menu (U-07) | Cabeçalho | Médio | Operação do Suporte |
| 3 · Esforço do usuário | Proteger contra envio duplo (suspeita) | Formulários | Médio | Evita duplicidade de pagamento e atendimento |
| 4 · Inconsistências | Rótulos acessíveis nos 14 campos (A-01); padronizar abas (U-03), indicadores (U-04), retorno (U-05), mensagens (U-08); manter a busca no retorno (F-06) | Várias | Baixo | Consistência e acessibilidade |
| 5 · Estético | Data sem `capitalize` (F-08); "Resumo do Dia" na barra do celular (F-07); favicon (A-05); "pular para o conteúdo" (A-03) | Várias | Baixo | Acabamento |

## 12. Status das correções

> 14/10/2026, ambiente local (`npm run dev` + Supabase local com o `seed.sql`), MCP Playwright,
> Chromium em 1280px, login `admin@exemplo-saude.local`. Escopo desta rodada: **só os defeitos
> funcionais de severidade Alta** (não houve Bloqueador). Nenhum envio que grava dados foi feito:
> contagem de linhas de 17 tabelas (profissionais, serviços, convênios, locais, contatos da equipe,
> atendimentos, pagamentos, notas etc.) igual antes e depois dos testes.

### 12.1 O que mudou no código

| Achado | Correção | Arquivos |
| --- | --- | --- |
| F-01 | O script do Marcar passou a procurar o botão só no formulário de marcar (`form[action='/api/admin/agenda/atendimentos/novo']`), não no primeiro formulário POST da página (o de sair) | `src/pages/admin/agenda/marcar.astro` |
| F-02, F-03 | Correção única no layout do painel: ao enviar um formulário POST, o navegador guarda os campos na `sessionStorage` da aba; se a tela seguinte for a mesma e mostrar aviso de **erro**, devolve os valores ao mesmo formulário e avisa os scripts da tela (eventos `input`/`change`, para o Pagamento mostrar os campos de quem pagou). O dado guardado é lido e apagado na carga seguinte, com erro ou não. Ficam de fora senha, arquivo e campos escondidos. As rotas `/api/admin/...` e as regras do servidor não mudaram | `src/scripts/keepFormValues.ts` (novo), `src/layouts/AdminLayout.astro`, `src/components/admin/FlashMessage.astro` (marca `data-flash` com o tom do aviso), `src/scripts/confirmDelete.ts` (o diálogo de confirmação envia com `form.submit()`, que não dispara `submit`; agora avisa o script antes) |

### 12.2 Revalidação

| Cenário | Antes | Depois | Evidência |
| --- | --- | --- | --- |
| F-01 · Marcar: cabeçalho | "Marcar" / "Marcar a série" no botão de sair | "Sair" no carregamento, com paciente/serviço/horário e com a série marcada | [`CORR-F-01-depois.jpg`](evidencias/CORR-F-01-depois.jpg) |
| F-01 · Marcar: série | Botão do formulário "Marcar", confirmação "Marcar o atendimento?" | Com a série: "Marcar a série" e diálogo "Criar a série?"; sem a série volta a "Marcar" / "Marcar o atendimento?" (diálogo fechado sem marcar) | idem |
| FORM-03 · Novo profissional | 7 de 7 perdidos | **0 de 8** perdidos, "Telefone inválido" | [`CORR-FORM-03-depois.jpg`](evidencias/CORR-FORM-03-depois.jpg) |
| FORM-04 · Novo contato da equipe | 1 de 3 | **0 de 4**, "Telefone inválido" | [`CORR-FORM-04-depois.jpg`](evidencias/CORR-FORM-04-depois.jpg) |
| FORM-05 · Novo serviço | 4 de 16 | **0 de 18**, "Valor inválido" | [`CORR-FORM-05-depois.jpg`](evidencias/CORR-FORM-05-depois.jpg) |
| FORM-07 · Pagamento | 3 de 6 (forma, nome e CPF de quem pagou) | **0 de 13**: Dinheiro, "Outra pessoa", "Pagador QA" e o CPF mantidos, com os campos visíveis e ativos; a confirmação diz "(Dinheiro)"; "Informe um valor maior que zero." | [`CORR-FORM-07-depois.jpg`](evidencias/CORR-FORM-07-depois.jpg) |
| FORM-08 · Novo plano/convênio | 2 de 5 | **0 de 6**, "Informe o nome do plano" | [`CORR-FORM-08-depois.jpg`](evidencias/CORR-FORM-08-depois.jpg) |
| FORM-09 · Editar profissional | Especialidade volta ao valor salvo | **0 de 8**: "Especialidade QA 09" mantida (salvo: "Terapia cognitivo-comportamental") | [`CORR-FORM-09-depois.jpg`](evidencias/CORR-FORM-09-depois.jpg) |
| FORM-10 · Editar serviço | Duração volta ao valor salvo | **0 de 17**: duração 35 mantida | [`CORR-FORM-10-depois.jpg`](evidencias/CORR-FORM-10-depois.jpg) |
| FORM-12 · Novo local | 1 de 2 | **0 de 3**, "Informe o nome do local" | [`CORR-FORM-12-depois.jpg`](evidencias/CORR-FORM-12-depois.jpg) |

Comparação feita pelo **valor efetivo** de cada controle (texto, seleção, `checked`), antes e depois
do envio, com um único campo inválido por cenário.

**Regressão:**

| Verificação | Resultado |
| --- | --- |
| FORM-01 · Cadastrar paciente (envia para a própria página, sem o script novo) | PASSOU: 0 de 10 perdidos, "Telefone inválido: informe DDD + número." |
| Pagamento: "Emitir a nota fiscal agora" **desmarcada** antes do erro | PASSOU: continua desmarcada depois do erro |
| Recarregar a tela depois do erro | PASSOU: sem aviso e com os valores padrão (nada é devolvido duas vezes) |
| Digitar e sair pelo link sem enviar | PASSOU: nada guardado; o formulário abre vazio |
| Armazenamento da aba depois de cada cenário | PASSOU: vazio em todos |
| Console | Sem erros; só o aviso já conhecido de A-05 |
| `npm test` (Vitest) | 473 de 473 testes passando |
| `astro check` | 0 erros, 0 avisos |
| `npm run build` | Concluído |

### 12.3 Status de cada achado

| Achado | Sev. | Status |
| --- | --- | --- |
| F-01 | Alta | **Corrigido e validado** |
| F-02 (Profissionais novo/editar, Contato da equipe novo, Serviços novo/editar, Convênio novo, Local novo) | Alta | **Corrigido e validado** |
| F-02 (Agendas, Horários, Feriados, Lembretes, Mensagens, Nota fiscal, Equipe/convite, Clínica e as edições de Contato, Convênio e Local) | Alta | **Corrigido mas não validado**: usam o mesmo caminho e recebem a mesma correção pelo layout, mas não foram exercitados (gravariam dados ou enviariam convite) |
| F-03 | Alta | **Corrigido e validado** |
| F-04 | Média | **Corrigido e validado** (12.5) |
| F-05 | Média | **Corrigido e validado** (12.5) |
| A-02 | Média | **Corrigido e validado** nos 6 formulários testados e no Cadastrar paciente (12.5); nas demais telas, **corrigido mas não validado** |
| F-06, F-08, F-09, A-01, A-03 | Baixa | **Corrigido e validado** (12.6) |
| A-05 | Baixa | **Corrigido e validado** (12.6), menos o ícone com o logo da clínica: nenhuma clínica do seed tem logo, então só o caso "sem logo" foi visto |
| F-07 | Baixa | **Não reproduzido** (12.6) |
| Envio duplo (suspeita) | — | **Resolvido no redesign** (R5: envio único em todo o painel, `src/scripts/sendOnce.ts`) |
| U-01, U-02 | — | **Resolvidos no redesign** (R2 e a revisão da Agenda na largura única, 17/out) |
| U-03, U-04 | — | **Resolvidos no redesign** (R7: mesmas abas e mesmo padrão de indicadores) |
| U-06, U-11 | — | **Resolvidos no redesign** (R9: título é o nome da seção; Clínica salva por bloco) |
| U-07, U-09, U-10 | — | **Resolvidos no redesign** (R1, R4 e R5) |
| U-05 | — | **Fechado sem mudança** (cliente, 17/out/2026): "Voltar" quando há tela de origem, senão o nome da tela-mãe, o padrão aprovado |
| U-08 | — | **Corrigido em 17/out/2026** (cliente): telefone inválido com uma mensagem só, "Telefone inválido: informe DDD + número, ex.: (84) 98188-0777." (`INVALID_PHONE_MESSAGE`; nas notas, o mesmo modelo com "WhatsApp das notas" e "Outro número"); valor que não é número, "Informe o valor em reais, ex.: 150,00." |
| U-12 | — | **Aceito sem mudança** (cliente, 17/out/2026): `return_to` no Remarcar, Bloqueios e Série; unificar só se mexer nessas telas |
| A-04 (indício) | — | Pendente (fora do escopo) |

### 12.4 Limites desta revalidação

- **Reenvio depois de corrigir o campo: BLOQUEADO**, como na auditoria: gravaria cadastro ou
  pagamento. O caminho de sucesso só apaga o dado guardado (mesmo trecho de código do caminho de erro,
  exercitado ao recarregar), mas não foi observado no navegador.
- Só 1280px e só o Chromium; o CSP do build não foi exercitado no navegador (o script novo é
  processado pelo Astro como os demais do layout).
- Os valores enviados (inclusive CPF, no Pagamento) ficam na `sessionStorage` da aba só entre o envio
  e a carga da tela seguinte.

### 12.5 Segunda rodada: severidade Média (F-04, F-05, A-02)

> 14/10/2026, mesmo ambiente local. Logins `admin@exemplo-saude.local` e `suporte@recepclinic.local`.
> Banco: contagem das mesmas 17 tabelas igual antes e depois. Como na auditoria, a navegação do
> Suporte dentro da clínica grava o registro de acesso que o sistema mantém.

**O que mudou no código**

| Achado | Correção | Arquivos |
| --- | --- | --- |
| F-04 | Os `fieldset` da tela ganharam `min-w-0` (por padrão o navegador não deixa um `fieldset` encolher abaixo do conteúdo; o campo de arquivo, com 312px, esticava "Páginas públicas" até 392px). O campo do logo passou a ocupar a largura disponível | `src/pages/admin/configuracoes/index.astro` |
| F-05 | "Trocar" (e "Abrir uma clínica", nas telas do Sistema) saiu de dentro do nome cortado e foi para a linha de "RecepClinic", que quebra se faltar espaço; o bloco do nome tem largura mínima de 152px | `src/layouts/AdminLayout.astro` |
| A-02 | A mensagem de erro ganhou `role="alert"` (sucesso: `role="status"`) e pode receber foco. O aviso de erro das rotas `/api/admin/...` leva os nomes dos campos que falharam; a tela marca o campo com `aria-invalid="true"` e `aria-describedby` apontando para a mensagem e põe o foco nele (a marca sai ao digitar). Sem campo identificado (ou nas telas que enviam para a própria página, como Cadastrar paciente), o foco vai para a mensagem | `src/components/admin/FormMessage.astro`, `src/components/admin/FlashMessage.astro`, `src/lib/flash.ts`, `src/lib/data/formAction.ts`, `src/scripts/keepFormValues.ts`, teste em `src/lib/forms.test.ts` |

**Revalidação**

| Cenário | Antes | Depois | Evidência |
| --- | --- | --- | --- |
| F-04 · Configurações › Clínica | Página com 424px em 390px | Largura da página igual à da janela em 360, 390, 768 e 1280px; cores quebram linha; campo "Site" dentro da tela | [`CORR-F-04-depois-390.jpg`](evidencias/CORR-F-04-depois-390.jpg) |
| F-05 · Suporte dentro da clínica | "Trocar" fora da área visível (x=230, bloco de 140px) | "Trocar" visível e clicável (teste de clique no ponto central) em 390, 640, 768, 1024 e 1280px, sem sobrepor o menu; o clique leva a `/admin/escolher-clinica`; o nome "Clínica Exemplo Saúde" aparece inteiro | [`-1280`](evidencias/CORR-F-05-depois-1280.jpg), [`-768`](evidencias/CORR-F-05-depois-768.jpg), [`-390`](evidencias/CORR-F-05-depois-390.jpg) |
| F-05 · Suporte nas telas do Sistema | (não medido) | "Abrir uma clínica" visível e clicável nas mesmas larguras, sem sobrepor o menu | [`CORR-F-05-depois-sistema-768.jpg`](evidencias/CORR-F-05-depois-sistema-768.jpg) |
| A-02 · FORM-03, 04, 05, 07, 08, 12 | Foco no `body`; sem `aria-invalid`, `aria-describedby` nem `role="alert"` | Foco no campo que falhou (`phone`, `phone`, `price`, `amount`, `name`, `name`), com `aria-invalid="true"` e `aria-describedby="erro-do-formulario"`; mensagem com `role="alert"`; digitar no campo tira o `aria-invalid` | [`CORR-A-02-depois-FORM-03.jpg`](evidencias/CORR-A-02-depois-FORM-03.jpg) |
| A-02 · FORM-01 Cadastrar paciente | Foco no `body` | Foco na mensagem de erro (`role="alert"`) | — |

**Regressão:** tela sem erro não muda o foco; perfil Administrador sem o link "Trocar" e com o nome
inteiro em 390, 768 e 1280px; Marcar com "Sair" no cabeçalho (F-01); FORM-03 e FORM-07 de novo com
0 campos perdidos (F-02, F-03); `npm test` 474 de 474 (1 teste novo: campos no aviso de erro e filtro
de nomes estranhos); `astro check` 0 erros; `npm run build` concluído; console sem erros.

**Efeito colateral:** com o bloco do nome mais largo, o menu do Suporte em 768px passa de 3 para 4
linhas (cabeçalho de 137px). O peso do menu do Suporte já está registrado em U-07.

**Limites:** o leitor de tela não foi usado (verificados os atributos e o foco, não a fala); a
ligação campo↔mensagem depende do nome que a camada de dados dá ao erro, e nas telas não testadas
pode cair no foco da mensagem.

### 12.6 Terceira rodada: severidade Baixa (F-06 a F-09, A-01, A-03, A-05)

> 14/10/2026, mesmo ambiente local, login `admin@exemplo-saude.local` (e uma sessão sem login para as
> telas de acesso). Banco: contagem das mesmas 17 tabelas igual antes e depois.

**O que mudou no código**

| Achado | Correção | Arquivos |
| --- | --- | --- |
| F-06 | O link "Cadastrar paciente novo" do Marcar leva a busca no endereço de volta | `src/pages/admin/agenda/marcar.astro` |
| F-07 | Nenhuma: não reproduzido (abaixo) | — |
| F-08 | `capitalize` (maiúscula em cada palavra) trocado por maiúscula só na primeira letra (`first-letter:uppercase`) na data da Agenda (Dia) e, com o mesmo defeito, no mês da Agenda (Mês: "Outubro De 2026") e nos horários do Remarcar ("Seg 19/10 Às 08:00") | `src/pages/admin/agenda.astro`, `agenda/mes.astro`, `agenda/remarcar.astro` |
| F-09 | `/formulario/<inválido>` responde 404, como o `/agendar` | `src/pages/formulario/[token].astro` |
| A-01 | `aria-label` nos campos sem rótulo: "Data" (Agenda e Resumo do Dia), "Buscar paciente" e "Serviço" (Marcar), "Buscar por nome ou telefone" (Pacientes e Financeiro), "Plano de saúde" (cadastro e ficha), "Agenda" e "Filtrar por paciente ou responsável" (Métricas) e "Texto: <nome da mensagem>" nos 9 textos de Configurações › Mensagens (a auditoria contou 6) | `agenda.astro`, `resumo/DateNav.astro`, `agenda/marcar.astro`, `pacientes/index.astro`, `financeiro/index.astro`, `pacientes/novo.astro`, `pacientes/[id].astro`, `metricas.astro`, `configuracoes/mensagens.astro` |
| A-03 | Link "Pular para o conteúdo" no início do painel, visível só com o foco; o `main` recebe o foco | `src/layouts/AdminLayout.astro` |
| A-05 | Ícone da aba: o do painel no login, na recuperação de senha e no formulário de cadastro; nas páginas do paciente (agendar, preparo, orientações e a prévia), o **logo da clínica** e, sem logo, nenhum ícone (decisão do cliente, 14/10); a 404 sem ícone. No painel, a tag `mobile-web-app-capable` junto da `apple-…` (o Chrome pedia) | `AuthLayout.astro`, `PublicLayout.astro`, `AdminLayout.astro`, `404.astro`, `agendar/[token].astro`, `preparo/[id].astro`, `orientacoes/[id].astro`, `configuracoes/previa.astro` |

**Revalidação**

| Cenário | Resultado | Evidência |
| --- | --- | --- |
| F-06 · Agenda (23/10) › Marcar › busca "Ana" › Cadastrar paciente novo › "‹ Marcar" | PASSOU: volta a `/admin/agenda/marcar?date=2026-10-23&volta=…&busca=Ana`, com "Ana" no campo e o resultado na lista; o "Voltar" seguinte leva a `/admin/agenda?date=2026-10-23` | — |
| F-07 · Barra inferior em 320, 360 e 390px | NÃO REPRODUZIDO: sem a barra de ferramentas do Astro (só existe no `npm run dev`; a pílula preta cobre o centro da barra), "Resumo do Dia" aparece inteiro em duas linhas, dentro da barra | [`CORR-F-07-sem-toolbar-390.jpg`](evidencias/CORR-F-07-sem-toolbar-390.jpg), [`-320`](evidencias/CORR-F-07-sem-toolbar-320.jpg) |
| F-08 · Agenda (Dia), Mês, Remarcar | PASSOU: "Sexta-feira, 23 de outubro de 2026" e "Outubro de 2026"; no Remarcar, a regra vale para o rótulo do horário | [`CORR-F-08-depois-dia.jpg`](evidencias/CORR-F-08-depois-dia.jpg), [`-mes`](evidencias/CORR-F-08-depois-mes.jpg) |
| F-09 · `/formulario/<inválido>`, `/agendar/<inválido>`, `/admin/nao-existe` | PASSOU: 404 nos três ("Link inválido", "Link inválido", "Página não encontrada") | — |
| A-01 · Nova varredura nas 15 telas | PASSOU: nenhum campo sem rótulo acessível | — |
| A-03 · Agenda pelo teclado | PASSOU: o 1º Tab mostra "Pular para o conteúdo" no canto superior; Enter leva a `#conteudo` e o Tab seguinte já cai no conteúdo ("Semana") | [`CORR-A-03-depois.jpg`](evidencias/CORR-A-03-depois.jpg) |
| A-05 · Console no login, recuperar senha, `/agendar` e `/formulario` inválidos, 404, prévia e Agenda | PASSOU: sem 404 do ícone e sem o aviso do Chrome; ficam só os 404 das próprias páginas inexistentes | — |

**Regressão:** Marcar com "Sair" (F-01); Novo profissional mantém os campos, foco no WhatsApp e
mensagem com `role="alert"` (F-02, A-02); Pagamento mantém "Outra pessoa" e o nome, foco no valor
(F-03); Configurações › Clínica sem rolagem lateral em 390px (F-04); `npm test` 474 de 474;
`astro check` 0 erros; `npm run build` concluído.

**Limites:** o ícone com o logo da clínica não foi visto (nenhuma clínica do seed tem logo);
leitor de tela não usado.
