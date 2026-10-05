import type { APIRoute } from "astro";
import { isUuid } from "../../../../../lib/clinicAccess";
import { createUserClient } from "../../../../../lib/data/clients";
import { DataError } from "../../../../../lib/data/errors";
import { runFormAction } from "../../../../../lib/data/formAction";
import { createInfoRequest, markInfoRequestReviewed, resendInvitation } from "../../../../../lib/data/onboarding";
import { onboardingDeps } from "../../../../../lib/data/onboardingDeps";
import { formText } from "../../../../../lib/forms";

// Ações do Suporte numa clínica (F4.4a): reenviar convite, pedir as
// informações por e-mail e marcar as respostas como revisadas.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params, url } = context;
  const clinicId = params.id!;
  const form = await request.formData().catch(() => null);
  const page = `/admin/sistema/clinicas/${clinicId}`;
  const db = createUserClient(request, cookies);

  return runFormAction(
    context,
    async () => {
      if (!isUuid(clinicId)) throw new DataError("not_found", "Clínica: não encontrada");
      const [{ data: clinic }, { data: settings }] = await Promise.all([
        db.from("clinics").select("id, name").eq("id", clinicId).maybeSingle(),
        db.from("clinic_settings").select("timezone").eq("clinic_id", clinicId).maybeSingle(),
      ]);
      if (!clinic || !settings) throw new DataError("not_found", "Clínica: não encontrada");
      const notSent = (reason: string) => ` Mas o e-mail não saiu (${reason}).`;

      switch (formText(form, "acao")) {
        case "reenviar_convite": {
          const email = await resendInvitation(db, clinic, formText(form, "invitation_id"), onboardingDeps(url));
          return { redirectTo: page, message: `Convite reenviado.${email.sent ? "" : notSent(email.reason)}` };
        }
        case "pedir_informacoes": {
          const result = await createInfoRequest(
            db,
            locals.userId!,
            { id: clinic.id, name: clinic.name, timezone: settings.timezone },
            formText(form, "email"),
            onboardingDeps(url),
          );
          const message = result.email.sent
            ? "Pedido de informações criado. E-mail enviado."
            : `Pedido de informações criado, mas o e-mail não saiu (${result.email.reason}). Envie este link ao Administrador (ele não aparece de novo): ${result.link}`;
          return { redirectTo: page, message };
        }
        case "marcar_revisado":
          await markInfoRequestReviewed(db, locals.userId!, formText(form, "request_id"));
          return { redirectTo: page, message: "Respostas marcadas como revisadas." };
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    page,
  );
};
