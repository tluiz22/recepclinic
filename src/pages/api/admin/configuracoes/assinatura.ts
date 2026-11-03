import type { APIRoute } from "astro";
import { recurringConsentText } from "../../../../lib/billingRenewal";
import { acceptBillingContract, dismissBillingWhatsappPrompt, getBillingAccount, listBillingContracts, saveBillingContacts, setBillingWhatsappOptIn } from "../../../../lib/data/billing";
import { syncContractNow } from "../../../../lib/data/billingAsaasDeps";
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
// IP de quem aceitou: o 1º do x-forwarded-for (Vercel), senão o da conexão.
function requestIp(context: { request: Request; clientAddress?: string }): string | null {
  const forwarded = context.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  // O Astro lança erro quando o adaptador não informa o endereço.
  try {
    return context.clientAddress ?? null;
  } catch {
    return null;
  }
}

export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  const page = "/admin/configuracoes/assinatura";
  const done = `${page}?pronto=1`;

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
          const account = await getBillingAccount(db, clinic.clinicId);
          const whatsappNext = !!account && !account.whatsappOptIn && !account.whatsappPromptDismissedAt;
          return { redirectTo: whatsappNext ? page : done, message };
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
