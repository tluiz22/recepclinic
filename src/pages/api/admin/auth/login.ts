import type { APIRoute } from "astro";
import { signIn } from "../../../../lib/data/auth";
import { createUserClient } from "../../../../lib/data/clients";

// Entrar no painel (F4.1). A clínica é escolhida depois, pelo middleware.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData().catch(() => null);
  const email = formData?.get("email")?.toString() ?? "";
  const password = formData?.get("password")?.toString() ?? "";
  const ok = await signIn(createUserClient(request, cookies), email, password);
  return redirect(ok ? "/admin/dashboard" : "/admin/login?error=1", 303);
};
