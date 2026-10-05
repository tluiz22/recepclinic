import type { APIRoute } from "astro";
import { createUserClient } from "../../../../../lib/data/clients";
import { runFormAction } from "../../../../../lib/data/formAction";
import { createClinicWithAdmin, type ClinicProfileValue } from "../../../../../lib/data/onboarding";
import { onboardingDeps } from "../../../../../lib/data/onboardingDeps";
import { formText } from "../../../../../lib/forms";

// Nova clínica (F4.4a): criada com o login do Suporte (fica no registro); o
// primeiro Administrador é convidado na hora.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, url } = context;
  const form = await request.formData().catch(() => null);
  return runFormAction(
    context,
    async () => {
      const result = await createClinicWithAdmin(
        createUserClient(request, cookies),
        locals.userId!,
        {
          name: formText(form, "name"),
          profile: formText(form, "profile") as ClinicProfileValue,
          timezone: formText(form, "timezone"),
          adminEmail: formText(form, "admin_email"),
        },
        onboardingDeps(url),
      );
      const who = result.existingUser ? "O Administrador já tinha login e foi incluído" : "Convite enviado ao Administrador";
      const message = result.email.sent
        ? `Clínica criada. ${who}.`
        : `Clínica criada, mas o e-mail não saiu (${result.email.reason}). Use "Reenviar convite" quando o envio estiver ok.`;
      return { redirectTo: `/admin/sistema/clinicas/${result.clinicId}`, message };
    },
    "/admin/sistema/clinicas/nova",
  );
};
