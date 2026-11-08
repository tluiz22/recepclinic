# Implementação: recepção digital integrada (Etapa 3)

> **Estado atual (retomar daqui), 08/nov/2026.** Plano da implementação escrito (este arquivo), **aguardando a
> validação do cliente** e as decisões da seção 6 (uma por vez). Nenhum código mudou. Base:
> [`proposta-recepcao-digital-integrada.md`](proposta-recepcao-digital-integrada.md) (regras, RD1 a RD14, design) e
> [`especificacao-telas-portal-e-recepcao.md`](especificacao-telas-portal-e-recepcao.md) (telas P1 a P13, PP, R1 a R8).

Marcas: **[Código]** conferido no repositório; **[Cliente]** decisão do cliente; **[Pendência]** depende de terceiro
(Meta, Cloudflare, advogado, DNS); **[Hipótese]** a conferir no início da etapa.

## 1. Escopo

Entra: F1 (fundação), F2 (portal + segurança, em três etapas), F3 (bot e links → portal), F5 (painel da recepção,
em duas etapas) e F6 (métricas e recuperação). **Fora:** F4, vários números de WhatsApp (cliente, 08/nov: pendente).
Tudo atrás do item **Portal de agendamento** da Matriz (D11): com o item desligado, a clínica não vê diferença.

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

| Etapa | O que entrega | Telas | Banco | Depende de |
|---|---|---|---|---|
| **F1 Fundação** | Base de dados e regras únicas, sem tela pública | Cadastro do profissional: "Atende particular" (só convênio) e observação por convênio | Item da Matriz `portal`; `professionals.accepts_private`, `portal_slug` (automático e fixo, `-2` se repetido), `show_in_portal`; observação em `professional_insurance_plans`; `clinics.portal_slug` (Suporte); prazos da clínica (reserva 3 a 10 min, padrão 5; antecedência para cancelar/remarcar, padrão 24 h); `booking_channel` ganha `portal`; `appointments.access_origin` e sessão; fila `notification_outbox` (chave única atendimento + tipo); funções únicas do motor (especialidades com profissional ativo, profissionais da especialidade, aceita o plano, horários livres) usadas pelo bot, pela Marcar e pelo portal | — |
| **F2a Portal: escolher** | Paciente navega e escolhe o horário (ainda sem marcar) | P1, P2, P3 (cartão até 5, lista com 6+), P5, P6, PP (link do profissional), P11, P13; computador (1280) e celular (390) | Funil anônimo por sessão (eventos); fotos públicas por URL assinada curta | F1, endereço do portal (seção 6) |
| **F2b Identificação e segurança** | Telefone comprovado e proteção contra abuso | P7 (celular + código; P8 com "Usar outro número" no caminho do link) | Sessão do portal (cookie `HttpOnly`); código de 6 dígitos (10 min, 5 tentativas, 3 por hora); limites por IP/sessão/telefone em contador no Postgres; bloqueio progressivo 15 min → 1 h → 24 h; `slot_holds` + `reserve_slot` (lock por agenda) | F2a, template de autenticação aprovado na Meta, chaves do Turnstile |
| **F2c Marcar** | Consulta marcada pelo portal, confirmação pela fila | P8, P8b (duplicado por nome + data, as três respostas), P9 (contador da reserva), P10 (.ics); R2 (origem no atendimento); R4 (quadro "Data de nascimento a conferir") | `confirm_portal_booking` (mesmo lock + trava de sobreposição); limites do bot valem no portal; fila envia a confirmação | F2b |
| **F3 Bot e links → portal** | WhatsApp e links levam ao portal | P12 Minhas consultas (remarcar, cancelar, antecedência); R7 Configurações › Portal, Meu perfil do profissional com o link, "Copiar link para…" (`?de=`), janela do QR (Baixar, Imprimir cartaz) | Token `/s/{token}` com finalidade (`agendar`, `remarcar`, `cancelar`, `minhas_consultas`); bot: "Agendar" manda o link com o item ligado; "Ver no portal" nas informações; "Veio do portal" na Central (P11) | F2c |
| **F5a Agenda da clínica grande** | 18 agendas sem 18 telas | R3 Agenda em colunas (até 7 sem rolagem; 8+ com Especialidade/Profissional e barra de rolagem), atendimento aberto na coluna à direita, Próximos horários livres; celular com uma agenda por vez | Consulta de horários de várias agendas de uma vez (meta < 2 s com 18 no staging) | F1 (reserva do portal tracejada depois da F2b) |
| **F5b Meu dia, Conversas e celular** | Recepção trabalha num lugar só | R5 Meu dia (atalho do link, "Precisa de você", tabela por profissional; profissional com o próprio link); R1 Conversas (aguardando primeiro, botão "Aguardando" com contador, painel do paciente com "Com quem ele já consulta"); R8 barra embaixo no celular | Sem tabela nova [Hipótese] | F2c, F3 |
| **F6 Métricas e recuperação** | Medir e recuperar | Métricas › Portal (funil, Entrada, bloqueios); Desempenho › "De onde vêm as marcações"; monitor do Suporte | Agregado diário do funil (eventos brutos 90 dias); aviso de abandono em 15 min (janela de 24 h, uma vez por sessão) | F2c, F3 |

Ordem proposta: F1 → F2a → F2b → F2c → F3 → F5a → F5b → F6 (a da proposta, com a F2 em três). A F5a só depende da F1
e pode ser antecipada se a demonstração para a clínica de 18 pedir.

## 4. Pendências fora do código (pedir cedo)

| O quê | Quem | Quando precisa |
|---|---|---|
| Endereço `agendar.recepclinic.com.br` (produção) e o equivalente do staging: DNS + domínio na Vercel | Cliente (DNS) e Claude (configuração) | Início da F2a |
| Template de autenticação na Meta (código com "Copiar código"), por conta | Claude envia; Meta aprova | Antes da F2b |
| Conta e chaves do Cloudflare Turnstile (staging e produção) | Cliente | Antes da F2b |
| Termo, política e menores (LGPD) revisados | Advogado | Antes da produção |
| Preço do item "Portal" no contrato | Cliente | Antes de vender |
| RD6 (horário por convênio) e perguntas do roteiro | Reunião com a clínica | Antes da F6 |

## 5. Riscos e cuidados

- **Portal público sem segurança não vai para a produção:** F2a pode ir ao staging sozinha (não marca nada); a
  produção recebe o portal só depois da F2c, com o item desligado nas clínicas até o cliente ligar.
- **Migrações aditivas** e testes de banco de "clínica com o item desligado igual a antes" em cada etapa.
- **Desempenho da grade** com 18 agendas: medir no staging antes de fechar a F5a.
- **Duas confirmações:** a fila com chave única substitui o envio dentro do pedido (FE segue mostrando falhas).

## 6. Decisões para o cliente (uma por vez)

| # | Pergunta | Recomendação |
|---|---|---|
| I1 | A F1 prepara o banco para vários números (conexão em cada conversa)? | Não: fica tudo na F4, quando ela for planejada |
| I2 | Endereço do portal no staging | A definir na pergunta |
| I3 | Branches, staging e validação | A definir na pergunta |
| I4 | O .ics (agenda do celular) leva o nome do médico? | A definir na pergunta |
| I5 | Ordem das etapas (seção 3) | A definir na pergunta |

A decidir na F3 (proposta, seção 17): se a antecedência da RD10 vale também para cancelar pelo WhatsApp.
