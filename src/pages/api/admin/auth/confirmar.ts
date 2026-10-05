import type { APIRoute } from "astro";
import { isEmailLinkType, verifyEmailLink } from "../../../../lib/data/auth";
import { createUserClient } from "../../../../lib/data/clients";

// Link dos e-mails de convite e de recuperação de senha (F4.1): confere no
// servidor, abre a sessão e leva à tela de escolher a senha.
export const GET: APIRoute = async ({ request, cookies, url, redirect }) => {
  const tokenHash = url.searchParams.get("token_hash") ?? "";
  const type = url.searchParams.get("type");
  if (!isEmailLinkType(type) || !(await verifyEmailLink(createUserClient(request, cookies), tokenHash, type))) {
    return redirect("/admin/login?error=link_invalido", 303);
  }
  return redirect(`/admin/nova-senha?origem=${type === "invite" ? "convite" : "recuperacao"}`, 303);
};
