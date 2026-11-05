import type { APIRoute } from "astro";
import { recurringConsentText } from "../../../../lib/billingRenewal";
import { paymentStep } from "../../../../lib/billingSteps";
import {
  acceptBillingContract,
  cancelBillingSubscription,
  dismissBillingPaymentStep,
  dismissBillingWhatsappPrompt,
  getBillingAccount,
  listBillingCharges,
  listBillingContracts,
  saveBillingContacts,
  setBillingWhatsappOptIn,
} from "../../../../lib/data/billing";
import { applyCancellationNow, startCardChangeNow, startCardRegistrationNow, syncContractNow } from "../../../../lib/data/billingAsaasDeps";
import { requestIp } from "../../../../lib/requestIp";
import { formatCalendarDate, todayIn } from "../../../../lib/clinicTime";
import { billingCancelEmail, smtpSender } from "../../../../lib/email";
import { platformEnv } from "../../../../lib/env";
import { logError } from "../../../../lib/log";
import { formatCentsBRL } from "../../../../lib/money";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { formChecked, formOptionalText, formText } from "../../../../lib/forms";

// Configurações › Assinatura (F12.1): contatos financeiros (Administrador e
// Suporte) e a autorização do WhatsApp financeiro (só o Administrador da
// clínica; o banco confere de novo e registra na trilha). F12.2b: aceite do
// contrato (só o Administrador), com o IP que o servidor recebeu. F12.4: no
// aceite, a cobrança nasce no Asaas. F12.2e: o aceite leva a autorização da
// cobrança mensal (2ª caixa; a frase guardada é a da forma de pagamento do
// contrato); o passo do WhatsApp tem "Agora não" e "Salvar e autorizar";
// terminado o passo a passo, a tela mostra o aviso "Pronto" (?pronto=1).
// F12.2f: cancelamento pelo Administrador (motivo; ajusta o Asaas e manda a
// confirmação ao e-mail financeiro; falhas não desfazem o cancelamento).
// F12.2g: "Trocar o cartão" abre o Checkout do Asaas (volta em .../cartao).
// F12.2i: depois do aceite, o passo Cartão (ou Pagamento, no Pix): "Informar o
// cartão no Asaas" abre a página do Asaas em outra aba (a tela confere em
// .../pagamento); no Pix, "Pagar depois".
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  const page = "/admin/configuracoes/assinatura";
  const done = `${page}?pronto=1`;
  // Depois do pagamento: o WhatsApp (se ainda não respondido) ou o Pronto.
  const afterPayment = async () => {
    const account = await getBillingAccount(db, clinic.clinicId);
    return account && !account.whatsappOptIn && !account.whatsappPromptDismissedAt ? page : done;
  };

  return runFormAction(
    context,
    async () => {
      switch (formText(form, "acao")) {
        case "contatos":
          await saveBillingContacts(db, clinic.clinicId, { financeEmail: formText(form, "finance_email"), financePhone: formOptionalText(form, "finance_phone") });
          return { redirectTo: page, message: "Contatos financeiros salvos." };
        case "whatsapp_autorizar":
          if (!formChecked(form, "aceite")) throw new DataError("invalid", "WhatsApp financeiro: marque a autorização", { aceite: "Marque a autorização." });
          await setBillingWhatsappOptIn(db, clinic.clinicId, true);
          return { redirectTo: formText(form, "origem") === "passo" ? done : page, message: "WhatsApp financeiro autorizado." };
        case "whatsapp_telefone_autorizar": {
          if (!formChecked(form, "aceite")) throw new DataError("invalid", "WhatsApp financeiro: marque a autorização", { aceite: "Marque a autorização." });
          const account = await getBillingAccount(db, clinic.clinicId);
          if (!account) throw new DataError("not_found", "Conta de cobrança: não encontrada");
          await saveBillingContacts(db, clinic.clinicId, { financeEmail: account.financeEmail, financePhone: formOptionalText(form, "finance_phone") });
          await setBillingWhatsappOptIn(db, clinic.clinicId, true);
          return { redirectTo: done, message: "Telefone salvo e WhatsApp financeiro autorizado." };
        }
        case "whatsapp_agora_nao":
          await dismissBillingWhatsappPrompt(db, clinic.clinicId);
          return { redirectTo: done, message: "Os avisos de cobrança vão só por e-mail." };
        case "contrato_aceitar":
          if (!formChecked(form, "aceite")) throw new DataError("invalid", "Aceite do contrato: marque o aceite", { aceite: "Marque o aceite." });
          if (!formChecked(form, "recorrencia")) {
            throw new DataError("invalid", "Aceite do contrato: marque a autorização da cobrança mensal", { recorrencia: "Marque a autorização da cobrança mensal." });
          }
        {
          const contractId = formText(form, "contract_id");
          const contract = (await listBillingContracts(db, clinic.clinicId)).find((c) => c.id === contractId);
          if (!contract) throw new DataError("not_found", "Contrato: não encontrado");
          await acceptBillingContract(db, clinic.clinicId, contractId, formText(form, "terms_version"), requestIp(context), recurringConsentText(contract.paymentMethod));
          // F12.4 (item 29): aceito, a cobrança nasce no Asaas na hora (modo automático).
          const sync = await syncContractNow(contractId);
          const message =
            sync.status === "synced"
              ? "Contrato aceito. As cobranças estão em Cobranças, nesta tela."
              : sync.status === "failed"
                ? "Contrato aceito. As cobranças ainda não foram geradas; o Suporte do RecepClinic vai cuidar disso."
                : "Contrato aceito.";
          // F12.2i: o passo do pagamento vem logo depois do aceite.
          const [contracts, charges] = await Promise.all([listBillingContracts(db, clinic.clinicId), listBillingCharges(db, clinic.clinicId)]);
          const acceptedContract = contracts.find((c) => c.id === contractId) ?? null;
          const openSetup = charges.some((c) => c.kind === "setup" && (c.status === "pending" || c.status === "overdue"));
          if (paymentStep(acceptedContract, openSetup)) return { redirectTo: `${page}?passo=pagamento`, message: "Contrato aceito." };
          return { redirectTo: await afterPayment(), message };
        }
        case "cartao_informar": {
          // F12.2i: a página do Asaas (implantação ou Checkout) abre em outra aba.
          if (!clinic.roles.includes("admin")) throw new DataError("forbidden", "Cartão: só o Administrador da clínica");
          const contract = (await listBillingContracts(db, clinic.clinicId)).find((c) => c.status === "active" && c.paymentMethod === "credit_card");
          if (!contract) throw new DataError("not_found", "Cartão: não há assinatura no cartão");
          const back = new URL("/api/admin/configuracoes/assinatura/cartao", request.url).toString();
          const started = await startCardRegistrationNow(contract.id, {
            actorId: locals.userId ?? null,
            successUrl: `${back}?resultado=ok`,
            cancelUrl: `${back}?resultado=cancelado`,
          });
          return { redirectTo: started.link, message: "Informe o cartão na página do Asaas." };
        }
        case "pagamento_depois": {
          // F12.2i: Pix, a implantação fica em Cobranças até o vencimento.
          const contract = (await listBillingContracts(db, clinic.clinicId)).find((c) => c.status === "active" && c.paymentMethod === "pix");
          if (!contract) throw new DataError("not_found", "Pagamento: não há assinatura no Pix");
          await dismissBillingPaymentStep(db, clinic.clinicId, contract.id);
          return { redirectTo: await afterPayment(), message: "A cobrança da implantação está em Cobranças, para pagar até o vencimento." };
        }
        case "cancelar": {
          if (!formChecked(form, "confirmo")) throw new DataError("invalid", "Cancelamento: confirme o cancelamento", { confirmo: "Marque a confirmação." });
          const result = await cancelBillingSubscription(db, clinic.clinicId, { reason: formText(form, "motivo"), comment: formOptionalText(form, "comentario") });
          await applyCancellationNow(result.contractId);
          const [account, contracts] = await Promise.all([getBillingAccount(db, clinic.clinicId), listBillingContracts(db, clinic.clinicId)]);
          const contract = contracts.find((c) => c.id === result.contractId);
          const date = (value: string) => formatCalendarDate(value, "dd/MM/yyyy");
          if (account) {
            await smtpSender(platformEnv().email)(
              billingCancelEmail(account.financeEmail, {
                clinicName: clinic.clinicName,
                kind: result.kind,
                canceledOn: date(todayIn(clinic.timezone)),
                accessUntil: date(result.accessUntil),
                nextDue: date(result.nextDue),
                amount: contract ? formatCentsBRL(contract.monthlyCents) : "",
                panelLink: new URL(page, request.url).toString(),
              }),
            ).catch((error) => logError("faturamento: e-mail do cancelamento", error, { clinica: clinic.clinicId }));
          }
          return {
            redirectTo: page,
            message:
              result.kind === "withdrawal"
                ? "Assinatura cancelada no prazo de arrependimento: o que foi pago será devolvido e o acesso terminou."
                : `Assinatura cancelada. A clínica usa o RecepClinic até ${date(result.accessUntil)}.`,
          };
        }
        case "cartao_trocar": {
          // F12.2g: o cartão novo é informado no Checkout do Asaas (o RecepClinic não vê o cartão).
          if (!clinic.roles.includes("admin")) throw new DataError("forbidden", "Troca de cartão: só o Administrador da clínica");
          const contract = (await listBillingContracts(db, clinic.clinicId)).find((c) => c.status === "active" && c.paymentMethod === "credit_card");
          if (!contract) throw new DataError("not_found", "Troca de cartão: não há assinatura no cartão");
          const back = new URL("/api/admin/configuracoes/assinatura/cartao", request.url);
          const link = await startCardChangeNow(contract.id, {
            actorId: locals.userId ?? null,
            successUrl: `${back.toString()}?resultado=ok`,
            cancelUrl: `${back.toString()}?resultado=cancelado`,
          });
          return { redirectTo: link, message: "Informe o novo cartão na página do Asaas." };
        }
        case "whatsapp_retirar":
          await setBillingWhatsappOptIn(db, clinic.clinicId, false);
          return { redirectTo: page, message: "Autorização do WhatsApp retirada: os avisos vão só por e-mail." };
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    page,
  );
};
