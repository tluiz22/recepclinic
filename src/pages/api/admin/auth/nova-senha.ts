import type { APIRoute } from "astro";
import { setNewPassword } from "../../../../lib/data/auth";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { markMyInvitationsAccepted } from "../../../../lib/data/onboarding";

// Grava a senha escolhida depois do convite ou da recuperação (F4.1).
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData().catch(() => null);
  const origem = formData?.get("origem")?.toString() === "convite" ? "convite" : "recuperacao";
  const db = createUserClient(request, cookies);
  try {
    await setNewPassword(
      db,
      formData?.get("password")?.toString() ?? "",
      formData?.get("confirmation")?.toString() ?? "",
    );
  } catch (error) {
    if (!(error instanceof DataError)) throw error;
    return redirect(`/admin/nova-senha?origem=${origem}&erro=${error.fields.password}`, 303);
  }
  await markMyInvitationsAccepted(db);
  return redirect("/admin/dashboard?aviso=senha_definida", 303);
};
