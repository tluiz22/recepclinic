import type { APIRoute } from "astro";
import { confirmCardRegistrationNow, syncContractNow } from "../../../../../lib/data/billingAsaasDeps";
import { getBillingAccount, listBillingCharges, listBillingContracts } from "../../../../../lib/data/billing";
import { createUserClient } from "../../../../../lib/data/clients";
import { requestIp } from "../../../../../lib/requestIp";

// Passo Cartão (ou Pagamento, no Pix) da Assinatura (F12.2i): a tela confere
// aqui, enquanto a clínica está na página do Asaas em outra aba. No cartão,
// confere o pagamento da implantação (ou o Checkout) e liga o cartão à
// assinatura; no Pix, atualiza as cobranças e vê se a implantação foi paga.
// Responde { status: "ok" | "pending" | "failed", next } (next: para onde ir).
export const GET: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const clinic = locals.clinic!;
  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (!clinic.roles.includes("admin")) return json({ status: "failed", message: "Só o Administrador da clínica." }, 403);
  const db = createUserClient(request, cookies);
  const page = "/admin/configuracoes/assinatura";
  const contract = (await listBillingContracts(db, clinic.clinicId)).find((c) => c.status === "active" && c.billingMode === "asaas");
  if (!contract) return json({ status: "failed", message: "Não há assinatura ativa." }, 404);
  const account = await getBillingAccount(db, clinic.clinicId);
  const next = account && !account.whatsappOptIn && !account.whatsappPromptDismissedAt ? page : `${page}?pronto=1`;

  if (contract.paymentMethod === "credit_card") {
    const result = await confirmCardRegistrationNow(contract.id, requestIp(context));
    if (result.status === "registered") return json({ status: "ok", next });
    if (result.status === "failed") return json({ status: "failed", message: "Não deu para confirmar o cartão agora. Tente de novo em instantes." });
    return json({ status: "pending" });
  }
  await syncContractNow(contract.id);
  const charges = await listBillingCharges(db, clinic.clinicId);
  const setupOpen = charges.some((c) => c.kind === "setup" && (c.status === "pending" || c.status === "overdue"));
  return json(setupOpen ? { status: "pending" } : { status: "ok", next });
};
