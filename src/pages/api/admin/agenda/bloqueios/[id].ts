import { safeReturnPath } from "../../../../../lib/returnPath";
import type { APIRoute } from "astro";
import { isUuid } from "../../../../../lib/clinicAccess";
import { toInstant } from "../../../../../lib/clinicTime";
import { createUserClient } from "../../../../../lib/data/clients";
import { removeBlock, updateBlock } from "../../../../../lib/data/agenda/blocks";
import { DataError } from "../../../../../lib/data/errors";
import { runFormAction } from "../../../../../lib/data/formAction";
import { formOptionalText, formText } from "../../../../../lib/forms";

// Bloqueio (F4.6): salvar período e motivo, ou remover. "23:59" no fim vale
// até o fim do dia.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  const returnTo = formOptionalText(form, "return_to");
  const back = safeReturnPath(returnTo, "/admin/agenda/bloqueios");

  return runFormAction(
    context,
    async () => {
      if (!isUuid(id)) throw new DataError("not_found", "Bloqueio: não encontrado");
      if (formText(form, "acao") === "remover") {
        await removeBlock(db, clinic.clinicId, id, locals.userId ?? null);
        return { redirectTo: back, message: "Bloqueio removido." };
      }
      const endTime = formText(form, "end_time");
      const endsAt =
        endTime === "23:59"
          ? new Date(toInstant(formText(form, "end_date"), "23:59", clinic.timezone).getTime() + 60_000)
          : toInstant(formText(form, "end_date"), endTime, clinic.timezone);
      await updateBlock(db, clinic.clinicId, id, {
        startsAt: toInstant(formText(form, "start_date"), formText(form, "start_time"), clinic.timezone),
        endsAt,
        reason: formText(form, "reason"),
        actorId: locals.userId ?? null,
      });
      return { redirectTo: "/admin/agenda/bloqueios", message: "Bloqueio salvo." };
    },
    `/admin/agenda/bloqueios/${id}`,
  );
};
