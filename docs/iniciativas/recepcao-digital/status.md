# Recepção digital integrada (status)
**Objetivo:** WhatsApp, portal e painel numa jornada única. **Plano completo:** `../../implementacao-recepcao-digital.md`.
- **Código (na `main`):** F1, F2a–F2d, F3, vários responsáveis (VR1–VR5, validado 11/nov) e F3f (bot enxuto E1–E8, 12/nov).
- **Ajustes da validação (12/nov, na `main` e no staging, validados pelo cliente em 12/nov):** turma remarca pelo portal; "não entendi" e menu numa mensagem só; descrição de Agendar conforme exame; marcação do paciente para o mesmo dia já entra confirmada (marcar ou remarcar para hoje); áudio e mídia pedem para escolher uma opção (sem pedir para escrever); boas-vindas do menu explicam o que cada opção faz (nome da clínica em negrito). Os 2 primeiros grupos já estão no staging; os últimos (3 commits) estão só locais, a publicar.
- **Staging:** igual à `main` (com os ajustes acima). **Produção:** tem a VR; **não tem** o bot enxuto (a produção usa a VR sem a ligação).
- **Falta:** validar a F3f no staging (E6 e E7 só lá); `rc_lembrete_v2` (Suporte cria em Configurações › WhatsApp e a Meta
  aprova; até lá vale `rc_lembrete_v1`); depois produção e limpeza do `/agendar` (`api/agendar`, `booking_links`).
- **Dependências:** Meta (modelo de lembrete); `PORTAL_BUTTON_ROOT` já definida na Vercel do staging.
- **Decisões:** I1–I11 (seção 6 do plano); D14 em `arquitetura.md`; VR em `../../planejamento-varios-responsaveis.md`.
- **Branch:** nenhuma aberta (`bot-enxuto` juntada). revisto até: `bddd483d`.
- **Próxima ação:** roteiro de validação da F3f (menu e links do bot, portal com Profissionais e valores, Confirmação ao
  paciente em Lembretes). Clínica de teste: Exemplo Saúde, 12 profissionais (`scripts/clinica-exemplo-grande.mjs`).
