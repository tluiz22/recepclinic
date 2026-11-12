# Recepção digital integrada (status)
**Objetivo:** WhatsApp, portal e painel numa jornada única. **Plano completo:** `../../implementacao-recepcao-digital.md`.
- **Código (na `main`):** F1, F2a–F2d, F3, vários responsáveis (VR1–VR5, validado 11/nov) e F3f (bot enxuto E1–E8, 12/nov).
- **Ajustes da validação (12/nov, na `main` e no staging, validados pelo cliente em 12/nov):** turma remarca pelo portal; "não entendi" e menu numa mensagem só; descrição de Agendar conforme exame; marcação do paciente para o mesmo dia já entra confirmada (marcar ou remarcar para hoje); áudio e mídia pedem para escolher uma opção (sem pedir para escrever); boas-vindas do menu explicam o que cada opção faz (nome da clínica em negrito). Todos já foram enviados à `main` (push conferido em 12/nov) e vão ao staging com ela.
- **Métricas › Desempenho (12/nov, `18d68dfb`, no staging, validado pelo cliente):** retirado o bloco "Por serviço e local" (apresentação pouco clara) e o aviso "Ver por serviço" de "Precisa de atenção". As contas seguem em `performance.ts`.
- **Staging:** igual à `main` (com os ajustes acima). **Produção:** tem a VR; **não tem** o bot enxuto (a produção usa a VR sem a ligação).
- **F3f no staging: validada pelo cliente (12/nov); aguarda autorização dele para subir à produção.** Ainda falta: `rc_lembrete_v2` (Suporte cria em Configurações › WhatsApp e a Meta
  aprova; até lá vale `rc_lembrete_v1`); depois produção e limpeza do `/agendar` (`api/agendar`, `booking_links`).
- **Etapas que faltam (mostrar ao perguntarem o estado do roadmap):**
  1. ~~Produção da F3f e da F6~~ **feita em 12/nov (`1ebfc87d`)**.
  2. ~~F5b~~ **validada pelo cliente (12/nov)** (Meu dia, Conversas, Meu perfil).
  3. **F6 Métricas e recuperação** (concluída e validada, branch `metricas-f6` já juntada; **parte 1 feita em 12/nov, validada:** Desempenho › "De onde vêm as marcações" com Recepção, WhatsApp e Link do portal, e o detalhe do link (clínica, profissional, Instagram, site…) só com valor; migração `20270120130000_metricas_origem.sql` ainda não está no staging). **Parte 2 feita (12/nov), validada:** Métricas › Portal (aba só com Portal, clínica toda: entraram, confirmaram o celular, escolheram horário, marcações pelo portal e bloqueios; visitas guardadas só por 30 dias); migração `20270120140000_metricas_portal.sql`. **Parte 3 feita (12/nov), validada:** Sistema › Portal (só o Suporte): bloqueios ativos de todas as clínicas (celular, IP e sessão) com "Liberar" e confirmação; sem migração (usa `portal_release_block`); a recepção segue liberando o celular na ficha do paciente. **F6 completa e validada pelo cliente no banco local (12/nov).** **No staging desde 12/nov** (migrações `20270120130000` e `20270120140000` aplicadas, `main` em `3564a813`, CI verde). **Conferida e validada pelo cliente no staging (12/nov).** Falta: a produção (com as migrações antes do código) e a recaptura da captura `metricas` (fila em `capturas-pendentes.md`, só com autorização). Plano da F6: Métricas › Portal; Desempenho › "De onde vêm as marcações"; monitor do Suporte (o aviso a quem não terminou de marcar **saiu da F6**: cliente, 12/nov, sem aviso à recepção nem ao paciente) (com a tela para liberar o celular do paciente no portal). Antes: reunião com a clínica (RD6, horário por convênio, e perguntas do roteiro). Destrava o Biomedical.
  4. **Limpeza do `/agendar`** (`api/agendar`, `booking_links`), depois da F3f na produção.
  - Fora do escopo (pendente do cliente, 08/nov): F4 e vários números de WhatsApp. Plano: `../../implementacao-recepcao-digital.md` (seção 3, tabela de etapas).
- **Dependências:** Meta (modelo de lembrete); `PORTAL_BUTTON_ROOT` já definida na Vercel do staging.
- **Decisões:** I1–I11 (seção 6 do plano); D14 em `arquitetura.md`; VR em `../../planejamento-varios-responsaveis.md`.
- **Branch:** nenhuma aberta (`metricas-f6` juntada na `main` e no staging em 12/nov). revisto até: `64bb825f`.
- **Próxima ação:** F3f e F6 na produção desde 12/nov (`1ebfc87d`); falta a limpeza do `/agendar`.
  Clínica de teste: Exemplo Saúde, 12 profissionais (`scripts/clinica-exemplo-grande.mjs`).
- **F5b (Meu dia, 12/nov, decisões do cliente):** sem atalho do link; **sem a tabela "Por profissional"** (a informação já está no
  Relatório do dia); "Precisa de você" ganha a linha "Conferir data" (data de nascimento diferente no portal, abre a ficha).
  Sem migração. Branch `meu-dia-f5b` (juntada na `main`, sem push). **Feito e validado pelo cliente (12/nov):** Meu dia (com "Conferir data");
  Conversas (aguardando primeiro, botão "Aguardando" com contador, "Com quem ele já consulta" com o próximo horário livre, só com
  um paciente no contato); Meu perfil do profissional (link, copiar, QR e cartaz do próprio link, só com Portal); a barra do celular já existia.
  A recepção **não gera o link por enquanto** (cliente, 12/nov): o link da clínica fica só em Configurações › Portal (Administrador) e o do profissional no Meu perfil. 
