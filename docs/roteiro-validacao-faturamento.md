# Roteiro de validação do faturamento (F12.2b a F12.2h), no local

**Validado pelo cliente no staging (07/nov/2026), partes 1 a 9.**

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
4. Texto: 2. Prazo e renovação automática, 4. Mensagens do WhatsApp (cobrança da Meta, direto da clínica e fora da mensalidade), 5. Forma de pagamento, Reajuste (IPCA), Arrependimento, Cancelamento.

## 2. Passo a passo da Assinatura (F12.2e)
1. Admin Odonto › Configurações › Assinatura: passos Contrato → WhatsApp → Pronto; resumo amarelo da renovação;
   "Abrir o contrato completo"; duas caixas desmarcadas, as duas obrigatórias.
2. Aceitar e continuar: passo 2 (WhatsApp) com "Agora não, só e-mail" e "Autorizar e concluir"; depois, "Pronto".
3. Asaas sandbox: cliente, assinatura e implantação criados; Cobranças: "Informar o cartão e pagar".

## 3. Passo Cartão (F12.2i) e troca de cartão (F12.2g)
1. Logo depois do aceite: Contrato aceito → **Cartão** → WhatsApp → Pronto (o WhatsApp aparece sempre; já respondido,
   com o visto: "WhatsApp autorizado" ou "WhatsApp: só e-mail"). "Cobrado agora: Implantação"; "Depois, no
   mesmo cartão: R$ … todo dia …". Em Cobranças, a mensalidade em aberto diz "Aguarda o cartão (passo Cartão, acima)".
2. "Informar o cartão no Asaas" abre o Asaas em outra aba (a da implantação); esta aba vira "Confirmando o pagamento no
   Asaas…". Pague com o cartão de teste 5162 3062 1937 8829, validade futura, CVV 318 (dados do titular: os da
   clínica). Volte à aba: em até 5 s ela segue sozinha (ou "Já paguei, conferir agora") para o WhatsApp ou o Pronto.
   O Pronto diz "Cartão final 8829 cadastrado"; em Cobranças, implantação Paga e a mensalidade "Cobrança automática no
   cartão". Suporte › Faturamento: "Cartão: Final 8829…"; trilha "Cartão cadastrado na assinatura".
   Fechou a aba antes de voltar (implantação paga, cartão ainda não ligado): ao abrir a Assinatura, a tela já confere
   e segue sozinha. No local, a volta do Checkout do Asaas abre em `127.0.0.1` (o Asaas recusa `localhost`) e pede
   login: use a aba do RecepClinic, que confere sozinha.
3. Sem pagar: feche a aba do Asaas e recarregue a Assinatura (sem `?passo=`): passo laranja "Cartão (pendente)" e
   "Falta informar o cartão"; não há como pular. Suporte: selo "Sem cartão" na lista de clínicas e na aba Faturamento.
4. Contrato sem implantação (Suporte: implantação 0 numa versão nova): "Cobrado agora: Nada: o cartão só fica
   cadastrado"; abre o Checkout do Asaas; volta com "Cartão cadastrado"; nada é cobrado antes do vencimento.
5. "Trocar o cartão" → Checkout do Asaas → outro cartão de teste → volta com "Cartão trocado" e o final novo.
6. Pix (contrato no Pix com implantação): passo **Pagamento** com "Pagar com Pix" e "Pagar depois" (segue para o
   WhatsApp; a cobrança fica em Cobranças).

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

## 8. Fim do contrato (cliente, 07/nov/2026)
Depois do cancelamento, a aba Suspensão não tem "Liberar" para o fim do contrato. A clínica só volta com o contrato
novo: Suporte ativa um contrato; o Administrador aceita e cadastra o cartão (ou paga a implantação, no Pix). Manual ou
Pix sem implantação: volta no aceite. A trilha mostra "Reativação automática: …".

## 9. Endereço do pagador (cliente, 07/nov/2026)
Suporte › Faturamento e Admin › Assinatura: quadro "Endereço do pagador"; o CEP preenche rua, bairro, cidade e UF.
Contrato no cartão **sem implantação**, sem endereço: o passo Cartão pede o endereço antes do botão; com o endereço,
"Informar o cartão no Asaas" abre o Checkout. "Trocar o cartão" também usa o endereço.

