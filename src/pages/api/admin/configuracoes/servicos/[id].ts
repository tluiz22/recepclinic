import type { APIRoute } from "astro";
import { createUserClient } from "../../../../../lib/data/clients";
import {
  createService,
  getService,
  setServiceActive,
  setServiceAgendas,
  setServiceLocations,
  updateService,
  type SchedulingMode,
  type ServiceCategory,
} from "../../../../../lib/data/config/services";
import { listLocations } from "../../../../../lib/data/config/locations";
import { runFormAction } from "../../../../../lib/data/formAction";
import { formAll, formChecked, formInt, formMoneyCents, formOptionalInt, formOptionalMoneyCents, formText } from "../../../../../lib/forms";

// Serviço (F4.3, D4c): criar (`novo`), salvar (dados, agendas e locais com
// preço próprio), desativar e reativar. A categoria não muda depois de criado;
// os campos de outra categoria são ignorados.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  let id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinicId = locals.clinic!.clinicId;
  const db = createUserClient(request, cookies);
  const page = () => `/admin/configuracoes/servicos/${id}`;
  const acao = formText(form, "acao");

  return runFormAction(
    context,
    async () => {
      if (acao === "desativar" || acao === "reativar") {
        await setServiceActive(db, clinicId, id, acao === "reativar");
        return { redirectTo: page(), message: acao === "reativar" ? "Serviço reativado." : "Serviço desativado." };
      }
      const category = (id === "novo" ? formText(form, "category") : (await getService(db, clinicId, id)).category) as ServiceCategory;
      const input = {
        name: formText(form, "name"),
        durationMinutes: formInt(form, "duration_minutes"),
        priceCents: formMoneyCents(form, "price"),
        returnDeadlineDays: category === "return_visit" ? formOptionalInt(form, "return_deadline_days") : null,
        preparationInstructions: category === "exam" ? formText(form, "preparation_instructions") || null : null,
        schedulingMode: (category === "exam" && formText(form, "scheduling_mode") === "group" ? "group" : "individual") as SchedulingMode,
      };
      const isNew = id === "novo";
      if (isNew) id = (await createService(db, clinicId, { ...input, category })).id;
      else await updateService(db, clinicId, id, input);

      // Depois de criado, um erro aqui volta para a tela do serviço (já existe).
      await setServiceAgendas(db, clinicId, id, formAll(form, "agenda_id"));
      const locations = formAll(form, "location_id").map((locationId) => ({
        locationId,
        priceCents: formChecked(form, `own_price_${locationId}`) ? formOptionalMoneyCents(form, `price_${locationId}`) : null,
      }));
      // Sem o item "Atendimento domiciliar" (D11), os locais domiciliares não
      // aparecem na tela e as ligações já gravadas ficam como estão.
      const keep = locals.clinic!.features.includes("home_visit")
        ? []
        : (await listLocations(db, clinicId, { includeInactive: true })).filter((l) => l.type === "home_visit").map((l) => l.id);
      await setServiceLocations(db, clinicId, id, locations, { keep });
      return { redirectTo: page(), message: isNew ? "Serviço cadastrado." : "Serviço salvo." };
    },
    page,
  );
};
