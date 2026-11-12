# Recepção digital integrada (status)
**Objetivo:** WhatsApp, portal e painel numa jornada única. **Plano completo:** `../../implementacao-recepcao-digital.md`.
- **Código (na `main`):** F1, F2a–F2d, F3, vários responsáveis (VR1–VR5, validado 11/nov) e F3f (bot enxuto E1–E8, 12/nov).
- **Ajustes da validação (12/nov, na `main` e no staging, validados pelo cliente em 12/nov):** turma remarca pelo portal; "não entendi" e menu numa mensagem só; descrição de Agendar conforme exame; marcação do paciente para o mesmo dia já entra confirmada (marcar ou remarcar para hoje); áudio e mídia pedem para escolher uma opção (sem pedir para escrever); boas-vindas do menu explicam o que cada opção faz (nome da clínica em negrito). Todos já foram enviados à `main` (push conferido em 12/nov) e vão ao staging com ela.
- **Staging:** igual à `main` (com os ajustes acima). **Produção:** tem a VR; **não tem** o bot enxuto (a produção usa a VR sem a ligação).
- **Falta:** validar a F3f no staging (E6 e E7 só lá); `rc_lembrete_v2` (Suporte cria em Configurações › WhatsApp e a Meta
  aprova; até lá vale `rc_lembrete_v1`); depois produção e limpeza do `/agendar` (`api/agendar`, `booking_links`).
- **Dependências:** Meta (modelo de lembrete); `PORTAL_BUTTON_ROOT` já definida na Vercel do staging.
- **Decisões:** I1–I11 (seção 6 do plano); D14 em `arquitetura.md`; VR em `../../planejamento-varios-responsaveis.md`.
- **Branch:** nenhuma aberta (`bot-enxuto` juntada). revisto até: `bddd483d`.
- **Próxima ação:** roteiro de validação da F3f (menu e links do bot, portal com Profissionais e valores, Confirmação ao
  paciente em Lembretes). Clínica de teste: Exemplo Saúde, 12 profissionais (`scripts/clinica-exemplo-grande.mjs`).
- **F5b (Meu dia, 12/nov, decisões do cliente):** sem atalho do link; **sem a tabela "Por profissional"** (a informação já está no
  Relatório do dia); "Precisa de você" ganha a linha "Conferir data" (data de nascimento diferente no portal, abre a ficha).
  Sem migração. Branch `meu-dia-f5b`. **Feito na branch (12/nov), aguardando validação do cliente:** Meu dia (com "Conferir data");
  Conversas (aguardando primeiro, botão "Aguardando" com contador, "Com quem ele já consulta" com o próximo horário livre, só com
  um paciente no contato); Meu perfil do profissional (link, copiar, QR e cartaz do próprio link, só com Portal); a barra do celular já existia.
  A recepção **não gera o link por enquanto** (cliente, 12/nov): o link da clínica fica só em Configurações › Portal (Administrador) e o do profissional no Meu perfil. Falta: o cliente validar.
