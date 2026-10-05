import type { APIRoute } from "astro";
import { setNewPassword } from "../../../../lib/data/auth";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";

// Grava a senha escolhida depois do convite ou da recuperação (F4.1).
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData().catch(() => null);
  const origem = formData?.get("origem")?.toString() === "convite" ? "convite" : "recuperacao";
  try {
    await setNewPassword(
      createUserClient(request, cookies),
      formData?.get("password")?.toString() ?? "",
      formData?.get("confirmation")?.toString() ?? "",
    );
  } catch (error) {
    if (!(error instanceof DataError)) throw error;
    return redirect(`/admin/nova-senha?origem=${origem}&erro=${error.fields.password}`, 303);
  }
  return redirect("/admin/dashboard?aviso=senha_definida", 303);
};
