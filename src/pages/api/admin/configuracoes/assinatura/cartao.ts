import type { APIRoute } from "astro";
import { confirmCardRegistrationNow, finishCardChangeNow } from "../../../../../lib/data/billingAsaasDeps";
import { getBillingAccount, listBillingContracts } from "../../../../../lib/data/billing";
import { createUserClient } from "../../../../../lib/data/clients";
import { setFlash } from "../../../../../lib/flash";
import { requestIp } from "../../../../../lib/requestIp";

// Volta do Checkout do Asaas (aba aberta por "Informar o cartão no Asaas" ou
// "Trocar o cartão"). F12.2g, troca: concluído, a assinatura nova entra no
// contrato; cancelado ou ainda sem a assinatura nova, o pedido fica para a
// conciliação diária (que o descarta depois de 1 dia). F12.2i, cadastro (sem
// implantação): o cartão fica ligado à assinatura e a tela segue o passo a passo. Pix → cartão (cliente,
// 07/nov/2026): a troca termina como a do cartão e a forma do contrato vira cartão.
export const GET: APIRoute = async (context) => {
  const { request, cookies, locals, redirect, url } = context;
  const clinic = locals.clinic!;
  const page = "/admin/configuracoes/assinatura";
  const db = createUserClient(request, cookies);
  // Cliente, 07/nov/2026: no Pix → cartão, o contrato segue no Pix até a troca terminar.
  const contract = (await listBillingContracts(db, clinic.clinicId)).find(
    (c) => c.status === "active" && (c.paymentMethod === "credit_card" || (c.paymentMethod === "pix" && c.cardCheckoutOpen)),
  );
  const switching = contract?.paymentMethod === "pix";
  const registering = !!contract && !switching && !contract.cardRegisteredAt;
  if (!contract || url.searchParams.get("resultado") !== "ok") {
    setFlash(cookies, {
      tone: "error",
      text: switching
        ? "O cartão não foi informado: a forma de pagamento continua Pix."
        : registering
          ? "O cartão não foi informado. Tente de novo em \"Informar o cartão no Asaas\"."
          : "Troca de cartão não concluída: o cartão continua o mesmo.",
    });
    return redirect(page, 303);
  }
  if (registering) {
    const result = await confirmCardRegistrationNow(contract.id, requestIp(context));
    if (result.status === "registered") {
      const account = await getBillingAccount(db, clinic.clinicId);
      setFlash(cookies, { tone: "success", text: "Cartão cadastrado: as mensalidades serão cobradas nele." });
      return redirect(account && !account.whatsappOptIn && !account.whatsappPromptDismissedAt ? page : `${page}?pronto=1`, 303);
    }
    setFlash(cookies, result.status === "failed" ? { tone: "error", text: "Não deu para confirmar o cartão agora. Tente de novo em instantes." } : { tone: "success", text: "Recebemos o cartão; a confirmação termina em instantes." });
    return redirect(page, 303);
  }
  const result = await finishCardChangeNow(contract.id);
  setFlash(
    cookies,
    result.status === "changed"
      ? { tone: "success", text: switching ? "Forma de pagamento mudada para cartão: as próximas mensalidades são cobradas nele." : "Cartão trocado: as próximas mensalidades vão para o cartão novo." }
      : result.status === "pending"
        ? { tone: "success", text: switching ? "Recebemos o cartão; a mudança para o cartão termina em instantes. Até lá, segue em Pix." : "Recebemos o cartão novo; a troca termina em instantes. Confira mais tarde em Cobranças." }
        : { tone: "error", text: "A troca de cartão não foi concluída. Tente de novo ou fale com o Suporte do RecepClinic." },
  );
  return redirect(page, 303);
};
