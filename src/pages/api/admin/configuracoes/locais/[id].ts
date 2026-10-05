import type { APIRoute } from "astro";
import { createUserClient } from "../../../../../lib/data/clients";
import { createLocation, listLocations, setLocationActive, updateLocation, type LocationType } from "../../../../../lib/data/config/locations";
import { DataError } from "../../../../../lib/data/errors";
import { runFormAction } from "../../../../../lib/data/formAction";
import { formOptionalText, formText } from "../../../../../lib/forms";

// Local (F4.3): criar (`novo`), salvar, desativar e reativar. O tipo
// (consultório ou domiciliar) não muda depois de criado.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinicId = locals.clinic!.clinicId;
  const db = createUserClient(request, cookies);
  const page = (target: string) => `/admin/configuracoes/locais/${target}`;
  const acao = formText(form, "acao");

  return runFormAction(
    context,
    async () => {
      if (acao === "desativar" || acao === "reativar") {
        await setLocationActive(db, clinicId, id, acao === "reativar");
        return { redirectTo: page(id), message: acao === "reativar" ? "Local reativado." : "Local desativado." };
      }
      const current = id === "novo" ? null : (await listLocations(db, clinicId, { includeInactive: true })).find((l) => l.id === id);
      if (id !== "novo" && !current) throw new DataError("not_found", "Local: não encontrado");
      const type = (current?.type ?? formText(form, "type")) as LocationType;
      const input = { name: formText(form, "name"), type, address: type === "home_visit" ? null : formOptionalText(form, "address") };
      if (!current) {
        const created = await createLocation(db, clinicId, input);
        return { redirectTo: page(created.id), message: "Local cadastrado." };
      }
      await updateLocation(db, clinicId, id, input);
      return { redirectTo: page(id), message: "Local salvo." };
    },
    page(id),
  );
};
