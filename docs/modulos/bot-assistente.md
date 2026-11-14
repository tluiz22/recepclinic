# Bot e assistente (ficha)
Reúne: evolução do assistente (EA), Base de Conhecimento (BC), catálogo da BC, implantação segura do WhatsApp (IS).
Detalhe (só por `grep`): `../arquivo/modulos/` — `evolucao-assistente.md`, `base-de-conhecimento.md` (decisões na
seção 9), `base-de-conhecimento-catalogo.md`, `implantacao-segura.md`. Jornada do bot: `.claude/rules/bot-jornada.md`.
**Estado (segundo os documentos):** EA na produção desde 02/nov (`c9418ac`); BC na produção, em uso na clínica piloto
e ligada por padrão com o Bot de WhatsApp (correção do cliente, 02/nov); IS1–IS5 na produção desde 03/nov
(`ebad937`); validado (14/nov: implantado conta como validado). Correção do bot E1–E5 na produção desde 13/nov. Bot enxuto (F3f): ver `../iniciativas/recepcao-digital/status.md`.

## Decisões que valem
- EA: um só assistente/reconhecedor/base. Entrada por texto livre ou menu; recepção tenta resolver antes de transferir,
  sem barreira; taxa de resolução sem intervenção humana em Métricas › Agendamento digital.
- BC: lista fechada de tipos de resposta; entradas nascem como rascunho e só respondem depois de aprovadas, ativadas e
  publicadas pelo Suporte, na clínica com "Perguntas frequentes no bot" ligado.
- IS: pré-requisitos da implantação, mensagem de teste, checklist e problemas conhecidos; verificação da empresa na
  sessão de conexão (seção 5b, 09/nov).
