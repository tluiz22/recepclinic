import type { APIRoute } from "astro";
import { isUuid } from "../../../../../lib/clinicAccess";
import { createUserClient } from "../../../../../lib/data/clients";
import { invoiceXmlUrl } from "../../../../../lib/data/nfse";
import { setFlash } from "../../../../../lib/flash";

// XML da nota fiscal (F11.4): link temporário (2 minutos) do bucket privado,
// só para quem lê o financeiro da clínica (RLS da nota e do Storage).
export const GET: APIRoute = async ({ request, cookies, locals, params, redirect }) => {
  const id = params.id!;
  const db = createUserClient(request, cookies);
  try {
    if (!isUuid(id)) throw new Error("id");
    return redirect(await invoiceXmlUrl(db, locals.clinic!.clinicId, id), 302);
  } catch {
    setFlash(cookies, { tone: "error", text: "XML da nota não encontrado." });
    return redirect("/admin/financeiro", 303);
  }
};
