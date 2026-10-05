import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";

// Sair. O cookie da última clínica fica: no próximo login, abre a mesma (F3.2).
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  await createUserClient(request, cookies).auth.signOut();
  return redirect("/admin/login", 303);
};
