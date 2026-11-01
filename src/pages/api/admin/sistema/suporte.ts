import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { setSupportWhatsapp } from "../../../../lib/data/platformSettings";

// Grava o WhatsApp do suporte (cliente, 01/nov/2026). Só o Suporte (o middleware
// confere; o banco confere de novo).
export const POST: APIRoute = async ({ request, cookies, locals, redirect }) => {
  const formData = await request.formData().catch(() => null);
  const db = createUserClient(request, cookies);
  const ok = await setSupportWhatsapp(db, formData?.get("support_whatsapp")?.toString() ?? "", locals.userId!);
  return redirect(ok ? "/admin/sistema/suporte?salvo=1" : "/admin/sistema/suporte?erro=telefone", 303);
};
