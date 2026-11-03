import type { APIRoute } from "astro";
import { finishCardChangeNow } from "../../../../../lib/data/billingAsaasDeps";
import { listBillingContracts } from "../../../../../lib/data/billing";
import { createUserClient } from "../../../../../lib/data/clients";
import { setFlash } from "../../../../../lib/flash";

// Volta do Checkout do Asaas na troca de cartão (F12.2g). Concluído, a
// assinatura nova entra no contrato; cancelado ou ainda sem a assinatura nova,
// o pedido fica para a conciliação diária (que o descarta depois de 1 dia).
export const GET: APIRoute = async ({ request, cookies, locals, redirect, url }) => {
  const clinic = locals.clinic!;
  const page = "/admin/configuracoes/assinatura";
  const db = createUserClient(request, cookies);
  const contract = (await listBillingContracts(db, clinic.clinicId)).find((c) => c.status === "active" && c.paymentMethod === "credit_card");
  if (!contract || url.searchParams.get("resultado") !== "ok") {
    setFlash(cookies, { tone: "error", text: "Troca de cartão não concluída: o cartão continua o mesmo." });
    return redirect(page, 303);
  }
  const result = await finishCardChangeNow(contract.id);
  setFlash(
    cookies,
    result.status === "changed"
      ? { tone: "success", text: "Cartão trocado: as próximas mensalidades vão para o cartão novo." }
      : result.status === "pending"
        ? { tone: "success", text: "Recebemos o cartão novo; a troca termina em instantes. Confira mais tarde em Cobranças." }
        : { tone: "error", text: "A troca de cartão não foi concluída. Tente de novo ou fale com o Suporte do RecepClinic." },
  );
  return redirect(page, 303);
};
