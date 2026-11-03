# Roteiro de validação do faturamento (F12.2b a F12.2h), no local

Branch `faturamento`. Senha de todos: `recepclinic-local`. Painel: http://localhost:4321/admin/login ·
e-mails: http://127.0.0.1:54324 (Mailpit). Asaas: sandbox (`.env`, chave com `\$`; ver o plano).

| Papel | Usuário |
|---|---|
| Suporte | `suporte@recepclinic.local` |
| Administrador (Odonto Exemplo) | `admin@odonto-exemplo.local` |
| Recepção (Odonto Exemplo) | `recepcao@odonto-exemplo.local` |
| Administrador (Clínica Exemplo Saúde) | `admin@exemplo-saude.local` |

Rotinas na mão (no Terminal, na raiz do projeto):
`S=$(grep '^CRON_SECRET' .env | cut -d= -f2- | tr -d "\"'")` e
`curl -H "Authorization: Bearer $S" http://localhost:4321/api/cron/<rotina>` com `conciliacao-asaas`,
`faturamento-eventos` ou `avisos-cobranca`.

## 1. Contrato e nota fiscal (F12.2c, F12.2d)
1. Suporte › Clínicas › Odonto Exemplo › Faturamento: rascunho (automático, cartão), ativar.
2. Com o Módulo financeiro liberado na Matriz, o texto tem "Emissão de nota fiscal" e o selo "Com emissão de nota
   fiscal"; sem ele, nenhuma menção a nota.
3. Com contrato aceito, liberar ou desligar o Módulo financeiro: aparece um rascunho "Criado pelo sistema…".
4. Texto: 2. Prazo e renovação automática, 4. Forma de pagamento, Reajuste (IPCA), Arrependimento, Cancelamento.

## 2. Passo a passo da Assinatura (F12.2e)
1. Admin Odonto › Configurações › Assinatura: passos Contrato → WhatsApp → Pronto; resumo amarelo da renovação;
   "Abrir o contrato completo"; duas caixas desmarcadas, as duas obrigatórias.
2. Aceitar e continuar: passo 2 (WhatsApp) com "Agora não, só e-mail" e "Autorizar e concluir"; depois, "Pronto".
3. Asaas sandbox: cliente, assinatura e implantação criados; Cobranças: "Informar o cartão e pagar".

## 3. Cartão (F12.2e, F12.2g)
1. "Informar o cartão e pagar": cartão de teste 5162 3062 1937 8829, validade futura, CVV 318.
2. "Atualizar do Asaas" (Suporte) ou a `conciliacao-asaas`: a implantação paga; as próximas mostram
   "Cobrança automática no cartão".
3. "Trocar o cartão" → Checkout do Asaas → outro cartão de teste → volta com "Cartão trocado"; a mensalidade em aberto
   passa para a assinatura nova (Suporte: trilha "Cartão trocado").

## 4. Suspensão (F12.3, F12.3b)
Aba Suspensão da clínica (Suporte): suspender (administrativo), conferir as telas (Admin só Assinatura; Recepção em
`/admin/clinica-suspensa`; `/agendar` indisponível) e liberar.

## 5. Cancelamento (F12.2f)
1. Admin › Assinatura › Contrato › "Cancelar a assinatura": resumo, motivo (Outro pede comentário), confirmação.
2. Até 7 dias do aceite: "arrependimento" (estorno no Asaas; clínica suspensa na hora). Depois: acesso até a véspera do
   próximo vencimento (para testar, peça para eu mudar a data do aceite no banco local).
3. E-mail "Assinatura cancelada" no Mailpit; Suporte: cartão "Assinatura cancelada" na aba Faturamento e selo
   "Cancelou a assinatura" na lista.

## 6. Reajuste IPCA (F12.2h)
Aparece na aba Faturamento 45 dias antes do aniversário (para ver, peça para eu mudar o início do contrato no banco).

## 7. Avisos (F12.7)
`avisos-cobranca`; textos em `billingNoticeEmail` e `billingCancelEmail` (`src/lib/email.ts`): **revisar**.
