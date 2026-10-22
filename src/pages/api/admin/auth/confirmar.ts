import type { APIRoute } from "astro";
import { isEmailLinkType, verifyEmailLink } from "../../../../lib/data/auth";
import { createUserClient } from "../../../../lib/data/clients";

// Link dos e-mails de convite e de recuperação de senha (F4.1).
// Abrir o link não gasta o código (cliente, 22/out/2026): leitores de e-mail,
// antivírus e a prévia do WhatsApp abrem o endereço sozinhos. O GET leva à
// tela com o botão (/admin/confirmar-link); o código só é conferido no POST,
// ao tocar no botão. Vencido ou já usado: tela própria, sem cair no login.

// Convite reenviado usa o link de recuperação, mas a tela é a de boas-vindas.
const origemOf = (type: string | null, origem: string | null | undefined) =>
  type === "invite" || origem === "convite" ? "convite" : "recuperacao";

export const GET: APIRoute = async ({ url, redirect }) => {
  const type = url.searchParams.get("type");
  const params = new URLSearchParams({
    token_hash: url.searchParams.get("token_hash") ?? "",
    type: type ?? "",
    origem: origemOf(type, url.searchParams.get("origem")),
  });
  return redirect(`/admin/confirmar-link?${params}`, 303);
};

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData().catch(() => null);
  const tokenHash = formData?.get("token_hash")?.toString() ?? "";
  const type = formData?.get("type")?.toString() ?? null;
  const origem = origemOf(type, formData?.get("origem")?.toString());
  if (!isEmailLinkType(type) || !(await verifyEmailLink(createUserClient(request, cookies), tokenHash, type))) {
    return redirect(`/admin/link-vencido?origem=${origem}`, 303);
  }
  return redirect(`/admin/nova-senha?origem=${origem}`, 303);
};
