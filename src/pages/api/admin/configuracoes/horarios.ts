import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import {
  addAvailabilityWindows,
  removeAvailabilityWindow,
  setAvailabilityWindowActive,
  updateAvailabilityWindow,
  type LocationAdded,
} from "../../../../lib/data/config/availability";
import { DataError, Validation } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { formAll, formOptionalInt, formText } from "../../../../lib/forms";

// Horários (F4.4b): adicionar o mesmo horário em vários dias, editar (cliente,
// 21/out/2026), desativar, reativar e remover. Volta para a agenda que estava na tela.
// Local e serviço são escolha obrigatória, sem valor padrão (cliente, 21/out/2026):
// "Qualquer serviço desta agenda" vem como `todos`.
const ANY_SERVICE = "todos";

/** O local marcado no serviço pelo horário (C5; cliente, 28/out/2026). */
const locationText = (added: LocationAdded) => (added ? ` ${added.location} foi marcado nos locais de ${added.service}.` : "");

export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const clinicId = locals.clinic!.clinicId;
  const db = createUserClient(request, cookies);
  const agendaId = formText(form, "agenda_id");
  const acao = formText(form, "acao");
  const windowId = formText(form, "window_id");
  // Volta com "Mostrar desativados" como estava (redesign 3B, 19/out/2026).
  const page = `/admin/configuracoes/horarios?agenda=${encodeURIComponent(agendaId)}${formText(form, "todos") === "1" ? "&todos=1" : ""}`;
  // Erro ao editar: volta com o formulário de edição aberto.
  const failure = acao === "editar" ? `${page}&editar=${encodeURIComponent(windowId)}#novo-horario` : page;

  /** Local, serviço, horário e vagas do formulário; local e serviço precisam ser escolhidos. */
  const windowFields = () => {
    const locationId = formText(form, "location_id");
    const service = formText(form, "service_id");
    const v = new Validation();
    v.check(!!locationId, "locationId", "Escolha o local.");
    v.check(!!service, "serviceId", "Escolha o serviço.");
    v.throwIfInvalid("Horário de atendimento");
    const serviceId = service === ANY_SERVICE ? null : service;
    return {
      locationId,
      serviceId,
      startTime: formText(form, "start_time"),
      endTime: formText(form, "end_time"),
      capacity: serviceId ? formOptionalInt(form, "capacity") : null,
    };
  };

  return runFormAction(
    context,
    async () => {
      switch (acao) {
        case "adicionar": {
          const weekdays = formAll(form, "weekday").map(Number);
          const created = await addAvailabilityWindows(db, clinicId, { agendaId, ...windowFields() }, weekdays);
          const saved = created.windows.length > 1 ? `${created.windows.length} horários adicionados.` : "Horário adicionado.";
          return { redirectTo: page, message: `${saved}${locationText(created.locationAdded)}` };
        }
        case "editar": {
          const weekday = formText(form, "weekday");
          if (!weekday) throw new DataError("invalid", "Horário de atendimento: escolha o dia", { weekday: "Escolha o dia da semana." });
          const saved = await updateAvailabilityWindow(db, clinicId, windowId, { ...windowFields(), weekday: Number(weekday) });
          return { redirectTo: page, message: `Horário salvo.${locationText(saved.locationAdded)}` };
        }
        case "desativar":
        case "reativar": {
          const active = acao === "reativar";
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
    failure,
  );
};
