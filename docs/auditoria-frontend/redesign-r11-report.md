# Relatório de testes de interface: R11 (páginas do paciente)

## 1. Resumo da execução

- **Data:** 2026-10-17
- **Executado por:** Claude (skill `playwright-ui-form-best-practices`), a pedido do cliente
- **Resultado geral:** 3 falhas Baixas (1 da R11 e 2 anteriores a ela), nenhuma Alta ou Média,
  **as 3 corrigidas e retestadas em 17/out** a pedido do cliente (seção 10); 2 suspeitas de
  usabilidade; 1 ponto não verificado
- **Síntese:** as páginas do paciente funcionam com a marca nova. No `/agendar`, a faixa de dias
  troca os horários sem recarregar (a URL acompanha e, sem JavaScript, o link abre a página no
  dia); o escolhido aparece na barra fixa do celular e no "Seu atendimento" do computador; o
  envio é único ("Confirmando…", os dois botões travados, 1 só POST). Os avisos do link
  (expirado, cancelado, já usado) têm o "Falar com a clínica no WhatsApp" e o link inválido não
  tem; a confirmação em linhas, o remarcar, a turma com vagas, o preparo, as orientações, a 404
  neutra e o `/formulario` na marca RecepClinic estão como aprovado. No `/formulario`, o erro do
  envio guarda tudo o que foi digitado. As falhas: o horário escolhido fica com contraste abaixo
  de 4,5:1 em várias cores, inclusive no verde padrão (QA-01, da R11); o título da aba diz
  "Atendimento marcado" no aviso de cancelado e de link já usado (QA-02, anterior); e, no
  `/formulario`, o nome da clínica apagado volta preenchido junto com o erro "Informe ao menos o
  nome da clínica" (FORM-04, anterior).

| Status | Quantidade |
| --- | --- |
| PASSOU | 21 |
| FALHOU | 3 |
| BLOQUEADO | 0 |
| NÃO APLICÁVEL | 0 |
| **Total executado** | 24 |

## 2. Ambiente

- **URL base:** `http://localhost:4321` (servidor `npm run dev` já no ar)
- **Ambiente:** local, banco do seed (Supabase local). Mudanças **temporárias** no banco para ver
  os estados, todas desfeitas e conferidas no fim: links 1 a 4 do `/agendar` (vencido, usado com
  atendimento remarcado, confirmado de exame, cancelado e usado sem atendimento), cor da Clínica
  Exemplo Saúde (`#FACC15` por alguns minutos, de volta a `#0F766E`), um texto fictício de
  orientações (apagado) e o pedido do `/formulario` (preenchido, enviado e restaurado da cópia:
  `sent`, respostas vazias). Nenhum atendimento criado; nenhum WhatsApp nem e-mail enviado (o
  "Confirmar" só foi enviado no link 4, que volta com "duplicado" antes de gravar). Os testes
  deixaram eventos do funil do bot no banco local (página aberta, troca de dia, confirmação que
  falhou), como faria um paciente.
- **Navegador e viewport:** Chromium (MCP Playwright), 390×844 e 1280×900; `/agendar` também
  sem JavaScript
- **Versão/commit da aplicação:** `7141966` mais a R11 sem commit (árvore de trabalho)
- **Usuários de teste:** links do seed (sem login); Administrador da Clínica Exemplo Saúde só para
  abrir a prévia de Configurações (login do seed, sem senha neste relatório)

## 3. Escopo

- **Incluído:** `/agendar` (marcar com mais de um profissional, remarcar, turma de exame, link
  vencido, usado, cancelado, inválido, duplicado), `/preparo`, `/orientacoes`, `/formulario` da
  clínica, a 404 e a prévia de Configurações › Clínica.
- **Fora do escopo:** confirmar um horário de verdade (cria o atendimento e manda o WhatsApp da
  clínica); "horário tomado" e "retorno já usado" (pedem duas sessões disputando o horário ou um
  retorno no seed).

## 4. Ferramentas utilizadas

- MCP Playwright (exploração, com `browser_run_code` para ler valores efetivos, foco, atributos
  ARIA, cores calculadas, larguras e status HTTP; contexto sem JavaScript). Contraste calculado
  também com `clinicColorStyle` (`src/lib/brandColor.ts`) para 10 cores. O projeto não tem
  `@playwright/test`; não foram criadas specs.

## 5. Cenários executados

| ID | Cenário | Critério | Tipo | Status | Severidade |
| --- | --- | --- | --- | --- | --- |
| NAV-01 | Confirmação do exame → "Ver o preparo do exame" → voltar do navegador | Retorno | Obrigatório | PASSOU | — |
| NAV-02 | Faixa: dia 22/10 → "Próximos dias" → "Dias anteriores" | Retorno/estado | Obrigatório | PASSOU | — |
| NAV-03 | Configurações › Clínica → "Ver como fica ›" (nova aba) | Destino | Obrigatório | PASSOU | — |
| FORM-01 | `/agendar`: "Confirmar" sem horário | Validação | Obrigatório | PASSOU | — |
| FORM-02 | `/agendar`: paciente que já tem consulta (duplicado) | Preservação/mensagem | Obrigatório | PASSOU | — |
| FORM-03 | `/formulario`: e-mail da equipe incompleto | Preservação | Obrigatório | PASSOU | — |
| FORM-04 | `/formulario`: nome da clínica em branco + "Enviar ao Suporte" | Preservação/erro no campo | Obrigatório | FALHOU | Baixa |
| FORM-05 | `/formulario`: corrigir só o nome e enviar de novo | Reenvio | Obrigatório | PASSOU | — |
| QA-01 | Contraste do horário escolhido (cor da clínica sobre o fundo claro) | Acessibilidade | Adicional | FALHOU | Baixa |
| QA-02 | Título da aba nos avisos do link usado | Consistência | Adicional | FALHOU | Baixa |
| QA-03 | Trocar o dia sem recarregar (URL, dia marcado, resumo zerado) | Adicional | Adicional | PASSOU | — |
| QA-04 | Escolhido na barra fixa (celular) e no "Seu atendimento" (computador) | Adicional | Adicional | PASSOU | — |
| QA-05 | Envio único no `/agendar` | Duplo envio | Adicional | PASSOU | — |
| QA-06 | Envio único no `/formulario` | Duplo envio | Adicional | PASSOU | — |
| QA-07 | Avisos do link: expirado, cancelado, já usado, inválido | Adicional | Adicional | PASSOU | — |
| QA-08 | Confirmação em linhas: confirmado (exame), remarcado | Adicional | Adicional | PASSOU | — |
| QA-09 | Turma de espirometria em cartões com as vagas | Adicional | Adicional | PASSOU | — |
| QA-10 | Remarcar: "Atendimento atual" e "Confirmar remarcação" | Adicional | Adicional | PASSOU | — |
| QA-11 | Preparo e orientações (17px, título, sem dado de paciente; "não encontrado" com 404) | Adicional | Adicional | PASSOU | — |
| QA-12 | Cor padrão `#0B7A62`, Source Sans 3, ícone da aba; cor clara com texto escuro | Adicional | Adicional | PASSOU | — |
| QA-13 | 404 no cinza neutro, mesmo texto | Adicional | Adicional | PASSOU | — |
| QA-14 | `/agendar` sem JavaScript | Adicional | Adicional | PASSOU | — |
| QA-15 | Teclado e larguras (ordem de tabulação; 390px sem rolagem lateral em todas) | Adicional | Adicional | PASSOU | — |
| QA-16 | `/formulario`: 8 seções numeradas, "+ Outro local", nomes acessíveis, barra fixa, link inválido | Adicional | Adicional | PASSOU | — |

### 5.1 Aprovados

- **NAV-01:** do "Atendimento confirmado!" (link 3, exame), "Ver o preparo do exame" abre
  `/preparo/bf13…` ("Preparo: Espirometria"); o voltar do navegador volta ao `/agendar/…03` com
  "Atendimento confirmado!". As páginas do paciente não têm "Voltar" na própria página (abrem
  pelo WhatsApp).
- **NAV-02:** 19/10 → 22/10 (`?date=2026-10-22&start=2026-10-19`, 22/10 com `aria-current`);
  "Próximos dias" → 05/11 (`start=2026-11-05`, dias 05/11, 09/11, 10/11); "Dias anteriores" →
  volta à primeira faixa (19/10 a 03/11), com o 19/10 escolhido. A página não recarrega (um
  marcador posto na página continuou lá).
- **NAV-03:** abre `/admin/configuracoes/previa` em outra aba, com a faixa "Prévia: é assim que o
  paciente vê…", o topo na cor da clínica (`#0F766E`) e o rodapé.
- **FORM-01:** o navegador barra o envio ("Selecione uma das opções.") e põe o foco no primeiro
  horário; a URL não muda.
- **FORM-02:** link 4 → horário → "Confirmar": volta com
  `?date=2026-10-19&error=duplicate`, aviso "Paciente já tem um atendimento marcado. Para mudar,
  fale com a clínica pelo WhatsApp." (`role=alert`), no mesmo dia 19/10. O horário escolhido não
  volta marcado; nesse erro, nenhum horário daria certo, então não pesa.
- **FORM-03:** todos os campos preenchidos com "Teste QA"; e-mail `recepcao.qa@` →
  "Salvar e continuar depois": o navegador barra ("Insira uma parte depois de "@"…"), o foco vai
  para o e-mail e nada se perde. O mesmo vale para o "Salvar e continuar depois": com um e-mail
  pela metade, não dá para salvar o rascunho até corrigir.
- **FORM-05:** só o nome trocado para "Clínica Teste QA 01" → "Enviar ao Suporte": "Recebemos as
  informações. Obrigado!" e "Recebemos as informações em 17/10/2026 às 17:29…", sem o formulário.
- **QA-03 e QA-04:** escolher 14:40 mostra "Seg, 19/10 às 14:40" na barra e no resumo; trocar o
  dia volta para "Escolha um horário" e nenhum horário fica marcado; o campo `date` acompanha. No
  celular só a barra fixa aparece; no computador, só o "Seu atendimento" (com 15:30: "Seg, 19/10
  às 15:30").
- **QA-05:** com a resposta atrasada de propósito: "Confirmando…" no botão tocado, os dois botões
  desabilitados e `aria-busy`; um segundo clique não gera outro POST (1 no total).
- **QA-06:** "Enviar ao Suporte" → "Enviando…", os dois botões desabilitados.
- **QA-07:** expirado (relógio, tom de alerta), cancelado e já usado com "Falar com a clínica no
  WhatsApp" (`https://wa.me/558433330001`, nova aba); link inválido (UUID que não existe e texto
  qualquer) com 404, título "Link inválido | RecepClinic", sem o botão e sem o topo da clínica.
- **QA-08:** "Atendimento confirmado!" com Quando, Exame, Paciente, Com quem e Onde (com o
  endereço) e o botão "Ver o preparo do exame" na cor da clínica; "Atendimento remarcado!" com
  Serviço. `role=status`.
- **QA-09:** 8 cartões ("Quarta-feira, 21/10 às 07:00 · 2 vagas" em âmbar, os outros "4 vagas");
  escolher mostra "Qua, 21/10 às 07:00".
- **QA-10:** link 2: "Remarcar", "Consulta pediátrica", "Dra. Helena Costa", "Atendimento atual
  19/10/2026 às 08h00" e os dois botões "Confirmar remarcação".
- **QA-11:** preparo com o texto em 17px e entrelinha 27,2px, título "Espirometria"; orientações
  (texto fictício temporário) com negrito e itálico do WhatsApp, largura de leitura (672px), sem
  dado de paciente. "Orientações não encontradas" (clínica sem texto, id que não é UUID) e
  "Preparo não encontrado" com 404; sem o botão do WhatsApp porque a clínica não tem conexão ou
  não é conhecida.
- **QA-12:** Odonto Exemplo (sem cor) com `--clinic: #0B7A62`; letra "Source Sans 3 Variable";
  ícone da aba `data:,` (sem logo). Com `#FACC15`: texto do topo, do dia e do botão em quase preto
  (11,66:1); "Agendar" em `#8A700C` sobre o fundo (4,56:1).
- **QA-13:** "ERRO 404 · Página não encontrada" com o texto de sempre, em cinza, 404.
- **QA-14:** sem JavaScript, o dia e as setas abrem a página no dia certo, os botões ficam
  habilitados e o envio sem horário é barrado pelo navegador (o resumo fica "Escolha um horário",
  porque é o script que o preenche).
- **QA-15:** Tab passa pelos 7 dias, "Próximos dias", o grupo de horários (setas do teclado entre
  eles), "Confirmar" e o rodapé. Sem rolagem lateral em 390px em todas as páginas.
- **QA-16:** seções 1 a 8 numeradas; "+ Outro local" cria o "Local 2" e põe o foco no nome; campos
  com 46px; cada campo tem nome acessível ("Tipo", "UF", "Papel"…); a barra com "Salvar e
  continuar depois" e "Enviar ao Suporte" fica presa embaixo; botão no verde `#0B7A62`. Link
  inválido: 404 e "Confira o endereço do e-mail ou peça um novo link ao Suporte RecepClinic."
- Console: só os 404 esperados dos links inválidos; nenhum 5xx.

### 5.2 Falhas

Ver a seção 6.

### 5.3 Bloqueios

- Nenhum.

### 5.4 Não aplicáveis

- Nenhum.

## 6. Achados

### 6.1 Defeitos confirmados

#### QA-01 · Horário escolhido com contraste abaixo de 4,5:1

- **Severidade:** Baixa (da R11)
- **Página ou fluxo:** `/agendar` (horário e sessão da turma escolhidos)
- **URL:** `/agendar/0a0e0000-0000-4000-8000-000000000001`
- **Critério avaliado:** qualidade adicional, contraste do texto (WCAG AA, 4,5:1 para texto de
  17px semibold)
- **Pré-condições:** clínica com uma cor em que `--clinic-ink` fica perto de 4,5:1 sobre o branco
- **Passos executados:**
  1. Abrir o link 1 e tocar num horário.
  2. Medir a cor do texto (`--clinic-ink`) sobre o fundo do horário escolhido (`--clinic-tint`).
- **Resultado esperado:** pelo menos 4,5:1, como o `inkOnWhite` garante sobre o branco.
- **Resultado observado:** o `--clinic-tint` é a cor misturada com 86% de branco, um pouco mais
  escuro que o branco, e o contraste cai: verde padrão `#0B7A62` 4,34:1; `#22C55E` 4,14:1;
  `#FACC15` 4,00:1 (medido na página); `#F97316` 3,90:1; `#DC2626` 3,89:1. Ficam acima:
  `#0F766E` (a cor do seed) 4,50:1, `#0369A1` 4,83:1, `#7C3AED` 4,61:1, cores escuras.
- **Impacto:** o horário escolhido fica um pouco menos legível para quem enxerga pouco; a borda de
  2px continua mostrando qual é o escolhido.
- **Evidência:** `evidencias/r11-cor-amarela-1280.png`; cálculo com `clinicColorStyle` para 10 cores.
- **Recomendação:** escurecer o `--clinic-ink` até 4,5:1 sobre o `--clinic-tint` (e não só sobre o
  branco), ou clarear o fundo do escolhido.

#### QA-02 · Título da aba "Atendimento marcado" no aviso de cancelado e de link já usado

- **Severidade:** Baixa (anterior à R11)
- **Página ou fluxo:** `/agendar` com o link usado
- **Critério avaliado:** qualidade adicional, consistência do título
- **Passos executados:**
  1. Abrir um link usado cujo atendimento foi cancelado (ou usado sem atendimento).
- **Resultado esperado:** a aba com o mesmo título da página ("Atendimento cancelado", "Link já
  usado"; e "Atendimento remarcado" no remarcar).
- **Resultado observado:** a aba diz "Atendimento marcado | Clínica Exemplo Saúde" nos três casos.
- **Impacto:** pequeno; a aba (e o leitor de tela, que lê o título) diz "marcado" num atendimento
  cancelado.
- **Evidência:** `evidencias/r11-link-cancelado-390.png`, `evidencias/r11-link-usado-390.png`,
  `evidencias/r11-remarcado-390.png`; `pageTitle` em `src/pages/agendar/[token].astro`, igual no
  commit `7141966`.
- **Recomendação:** o título do estado "used" seguir o título do aviso ou da confirmação.

#### FORM-04 · Nome da clínica apagado volta preenchido junto com o erro

- **Severidade:** Baixa (anterior à R11)
- **Página ou fluxo:** `/formulario/recepclinic-local-formulario`
- **Critério avaliado:** preservação dos campos e erro ligado ao campo
- **Pré-condições:** formulário com todos os campos preenchidos ("Teste QA")
- **Passos executados:**
  1. Apagar "Nome da clínica" e tocar em "Enviar ao Suporte".
- **Resultado esperado:** o nome em branco, marcado com o erro, e o foco nele.
- **Resultado observado:** todos os outros campos voltam como estavam (o servidor salva o
  rascunho antes do erro), mas o "Nome da clínica" volta com "Clínica Exemplo Saúde" (o nome
  cadastrado), enquanto o aviso no topo diz "Informe ao menos o nome da clínica antes de enviar.";
  o campo fica sem `aria-invalid` e o foco fica na página. Tocar em "Enviar" de novo envia com o
  nome cadastrado.
- **Campos perdidos:** nenhum; o campo inválido volta com outro valor.
- **Impacto:** o aviso parece não fazer sentido (o nome está lá); a pessoa pode enviar sem perceber.
- **Evidência:** `evidencias/r11-formulario-erro-nome-390.png`; `value={answers?.clinic.name ||
  clinicName}`, igual no commit `7141966`.
- **Recomendação:** depois do erro, mostrar o nome vazio com a marca de erro e o foco (o nome
  cadastrado só como valor inicial de um formulário nunca salvo), ou tirar o erro e usar o nome
  cadastrado quando o campo estiver vazio.

### 6.2 Suspeitas

#### S-01 · Faixa de dias no celular: 4 dias à vista e a seta pula 7

- Em 390px, a faixa mostra os dias 19, 20, 22 e parte do 26/10; os 27, 29/10 e 03/11 só aparecem
  arrastando a faixa para o lado. A seta "›" vai para a página seguinte (05/11), pulando esses três
  dias. Quem não arrastar pode achar que não há horário entre 26/10 e 05/11. É o mesmo desenho do
  Marcar do painel (R4, aprovado). **Para confirmar:** decisão do cliente (por exemplo, menos dias
  por página no celular, ou a seta rolar a faixa antes de trocar de página).
  Evidência: `evidencias/r11-agendar-390.png`.

#### S-02 · Dia sem horário pedido no endereço vira o seguinte sem aviso

- `/agendar/…01?date=2026-10-21` (quarta, sem horário) abre no 22/10 sem dizer nada; no Marcar do
  painel há o aviso (`unavailable` do `buildDayStrip`). Só acontece com endereço montado à mão ou
  quando, depois de um erro, o dia deixou de ter horário. **Para confirmar:** se vale mostrar o
  mesmo aviso do painel.

### 6.3 Pontos não verificados

| Item | Motivo |
| --- | --- |
| Confirmar um horário de verdade (link 1 a 3) e a mensagem "horário tomado"/"retorno já usado" | Grava o atendimento e manda o WhatsApp da clínica; a tela de confirmação foi vista com o link marcado como usado no banco |

## 7. Limitações

- A confirmação de verdade não foi feita; os estados "usado", "cancelado" e "vencido" foram
  simulados mudando os links do seed (desfeito).
- A barra de ferramentas do Astro (só no `npm run dev`) cobre a barra fixa do `/formulario` no
  celular; foi removida da página durante o teste. Não existe no staging.
- Sem leitor de tela; acessibilidade vista pelos nomes acessíveis, `aria-*`, foco e contraste.
- Um iPhone de verdade não foi usado (barra fixa com a área segura do iPhone não conferida).

## 8. Evidências

- **Local:** `docs/auditoria-frontend/evidencias/` (prefixo `r11-`)
- **Arquivos:** `r11-agendar-390.png`, `r11-agendar-390-inteira.png`, `r11-agendar-1280.png`,
  `r11-agendar-sem-js-390.png`, `r11-agendar-duplicado-1280.png`, `r11-remarcar-1280.png`,
  `r11-turma-1280.png`, `r11-confirmado-exame-390.png`, `r11-confirmado-exame-1280.png`,
  `r11-remarcado-390.png`, `r11-link-expirado-390.png`, `r11-link-cancelado-390.png`,
  `r11-link-usado-390.png`, `r11-link-invalido-390.png`, `r11-link-invalido2-390.png`,
  `r11-preparo-390.png`, `r11-preparo-nao-encontrado-390.png`, `r11-orientacoes-390.png`,
  `r11-orientacoes-1280.png`, `r11-orientacoes-nao-encontrada-390.png`, `r11-404-390.png`,
  `r11-cor-amarela-1280.png`, `r11-formulario-390.png`, `r11-formulario-1280.png`,
  `r11-formulario-erro-nome-390.png`, `r11-formulario-enviado-390.png`,
  `r11-formulario-invalido-1280.png`, `r11-previa-390.png`
- **Dados sensíveis:** só dados do seed e fictícios ("Teste QA"); nenhuma senha, token ou cookie
  registrado.

## 9. Recomendações

1. QA-01: contraste do horário escolhido calculado sobre o fundo claro (da R11; afeta a cor padrão).
2. FORM-04: o nome da clínica em branco continua em branco, com a marca de erro e o foco.
3. QA-02: título da aba igual ao do aviso.
4. S-01 e S-02: decidir com o cliente.

## 10. Correções (17/out, a pedido do cliente) e reteste

| ID | Correção | Reteste |
| --- | --- | --- |
| QA-01 | `tintFor` em `src/lib/brandColor.ts`: o fundo do horário escolhido começa na mistura de 86% de branco e clareia até o texto (`--clinic-ink`) ter 4,5:1 sobre ele. A cor da clínica e o `--clinic-ink` não mudam. Teste novo em `brandColor.test.ts` com 8 cores. | **PASSOU**: verde padrão `#0B7A62` com o fundo `#E7F2EF` (4,62:1); `#F97316` com `#FEFCFA` (4,61:1); `#DC2626` 4,54:1; `#FACC15` 4,53:1; `#22C55E` 4,51:1. Nas cores quentes o fundo fica quase branco e o escolhido se vê pela borda de 2px e pelo texto na cor. |
| QA-02 | O título da aba do estado "usado" segue a página: "Atendimento confirmado", "Atendimento remarcado", "Atendimento cancelado" ou "Link já usado". | **PASSOU**: links 2, 3 e 4 (cancelado e usado sem atendimento) com o título da aba igual ao da página. |
| FORM-04 | O erro do envio aponta o campo `clinic_name` (a rota passa os campos do erro no aviso); a página marca o campo (`aria-invalid`, borda vermelha, `aria-describedby` no aviso) e põe o foco nele. O nome cadastrado só preenche o formulário nunca salvo; depois, vale o salvo, mesmo em branco. | **PASSOU**: nome apagado + "Enviar ao Suporte" → aviso "Informe ao menos o nome da clínica antes de enviar.", nome em branco com borda vermelha e foco, os outros campos mantidos; ao digitar, a marca sai; "Salvar e continuar depois" guarda o nome novo. Formulário nunca salvo continua abrindo com "Clínica Exemplo Saúde". |

Os links do seed, a cor da clínica (`#0F766E`) e o pedido do formulário (`sent`, respostas vazias)
foram restaurados depois do reteste e conferidos no banco. `astro check` sem erros, `npm test`
(509) e os testes de banco `novas-clinicas` e `marca-da-clinica` (13).
Evidências: `evidencias/r11-corr-cor-laranja-1280.png`, `evidencias/r11-corr-cor-verde-1280.png`,
`evidencias/r11-corr-formulario-erro-nome-390.png`.
