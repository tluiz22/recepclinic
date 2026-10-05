import type { APIRoute } from "astro";
import { requestPasswordReset } from "../../../../lib/data/auth";
import { createUserClient } from "../../../../lib/data/clients";

// "Esqueci minha senha" (F4.1): sempre a mesma resposta, exista ou não o e-mail.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData().catch(() => null);
  await requestPasswordReset(createUserClient(request, cookies), formData?.get("email")?.toString() ?? "");
  return redirect("/admin/esqueci-senha?enviado=1", 303);
};
