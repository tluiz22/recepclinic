import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { addAvailabilityWindows, removeAvailabilityWindow, setAvailabilityWindowActive } from "../../../../lib/data/config/availability";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { formAll, formOptionalInt, formOptionalText, formText } from "../../../../lib/forms";

// Horários (F4.4b): adicionar o mesmo horário em vários dias, desativar,
// reativar e remover. Volta para a agenda que estava na tela.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const clinicId = locals.clinic!.clinicId;
  const db = createUserClient(request, cookies);
  const agendaId = formText(form, "agenda_id");
  const page = `/admin/configuracoes/horarios?agenda=${encodeURIComponent(agendaId)}`;
  const windowId = formText(form, "window_id");

  return runFormAction(
    context,
    async () => {
      switch (formText(form, "acao")) {
        case "adicionar": {
          const serviceId = formOptionalText(form, "service_id");
          const weekdays = formAll(form, "weekday").map(Number);
          const created = await addAvailabilityWindows(
            db,
            clinicId,
            {
              agendaId,
              locationId: formText(form, "location_id"),
              serviceId,
              startTime: formText(form, "start_time"),
              endTime: formText(form, "end_time"),
              capacity: serviceId ? formOptionalInt(form, "capacity") : null,
            },
            weekdays,
          );
          return { redirectTo: page, message: created.length > 1 ? `${created.length} horários adicionados.` : "Horário adicionado." };
        }
        case "desativar":
        case "reativar": {
          const active = formText(form, "acao") === "reativar";
          await setAvailabilityWindowActive(db, clinicId, windowId, active);
          return { redirectTo: page, message: active ? "Horário reativado." : "Horário desativado." };
        }
        case "remover":
          await removeAvailabilityWindow(db, clinicId, windowId);
          return { redirectTo: page, message: "Horário removido." };
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    page,
  );
};
