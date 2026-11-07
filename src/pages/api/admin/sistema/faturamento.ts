import type { APIRoute } from "astro";
import { setDefaultInvoicePrice } from "../../../../lib/data/billing";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { formText } from "../../../../lib/forms";

// Parâmetros do faturamento do SaaS (só o Suporte): preço padrão por nota
// fiscal (F12.2), em Vendas › Planos.
export const POST: APIRoute = async (context) => {
  const { request, cookies } = context;
  const form = await request.formData().catch(() => null);
  const db = createUserClient(request, cookies);
  const page = "/admin/sistema/vendas?tab=planos";

  return runFormAction(
    context,
    async () => {
      switch (formText(form, "acao")) {
        case "preco_nota":
          await setDefaultInvoicePrice(db, formText(form, "default_invoice_price"));
          return { redirectTo: page, message: "Preço padrão por nota salvo. Vale para os próximos contratos." };
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    page,
  );
};
