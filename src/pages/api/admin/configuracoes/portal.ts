import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { setPortalLeadHours, setShowInPortal } from "../../../../lib/data/config/portal";
import { runFormAction } from "../../../../lib/data/formAction";
import { DataError } from "../../../../lib/data/errors";
import { formInt, formText } from "../../../../lib/forms";

// Configurações › Portal (F3d; R7): a antecedência para remarcar e cancelar pelo portal (RD10) e "Mostrar no portal"
// de cada profissional. Só o Administrador (área de Configurações); o banco confere de novo.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const db = createUserClient(request, cookies);
  const clinicId = locals.clinic!.clinicId;
  const page = "/admin/configuracoes/portal";
  const action = formText(form, "acao");

  return runFormAction(
    context,
    async () => {
      if (action === "antecedencia") {
        const hours = formInt(form, "lead_hours");
        await setPortalLeadHours(db, clinicId, hours);
        return { redirectTo: page, message: `Antecedência salva: ${hours} ${hours === 1 ? "hora" : "horas"}.` };
      }
      if (action !== "mostrar" && action !== "ocultar") throw new DataError("invalid", "Portal: ação desconhecida");
      const id = formText(form, "profissional");
      const show = action === "mostrar";
      const name = await setShowInPortal(db, clinicId, id, show);
      return { redirectTo: `${page}#profissional-${id}`, message: show ? `${name} aparece no portal.` : `${name} saiu do portal.` };
    },
    page,
  );
};
