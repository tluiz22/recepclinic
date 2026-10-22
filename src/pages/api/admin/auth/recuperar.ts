import type { APIRoute } from "astro";
import { requestPasswordReset } from "../../../../lib/data/auth";
import { createUserClient } from "../../../../lib/data/clients";

// "Esqueci minha senha" (F4.1) e "Receber um novo link" da tela de link
// vencido: sempre a mesma resposta, exista ou não o e-mail.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData().catch(() => null);
  await requestPasswordReset(createUserClient(request, cookies), formData?.get("email")?.toString() ?? "");
  const back = formData?.get("volta")?.toString() === "link-vencido" ? "/admin/link-vencido" : "/admin/esqueci-senha";
  return redirect(`${back}?enviado=1`, 303);
};
