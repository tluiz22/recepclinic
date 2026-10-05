import type { APIRoute } from "astro";
import { createUserClient } from "../../../../../lib/data/clients";
import {
  createProfessional,
  listProfessionals,
  setProfessionalActive,
  updateProfessional,
  type ProfessionalInput,
} from "../../../../../lib/data/config/professionals";
import { DataError } from "../../../../../lib/data/errors";
import { runFormAction } from "../../../../../lib/data/formAction";
import { formChecked, formOptionalText, formText } from "../../../../../lib/forms";

// Profissional (F4.3): criar (`novo`), salvar, desativar e reativar. O login
// ligado ao profissional fica como está (é definido na equipe, F4.4). A opção
// do resumo do dia só vem com o item liberado.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  const page = (target: string) => `/admin/configuracoes/profissionais/${target}`;
  const acao = formText(form, "acao");

  return runFormAction(
    context,
    async () => {
      if (acao === "desativar" || acao === "reativar") {
        await setProfessionalActive(db, clinic.clinicId, id, acao === "reativar");
        return { redirectTo: page(id), message: acao === "reativar" ? "Profissional reativado." : "Profissional desativado." };
      }
      const current = id === "novo" ? null : (await listProfessionals(db, clinic.clinicId, { includeInactive: true })).find((p) => p.id === id);
      if (id !== "novo" && !current) throw new DataError("not_found", "Profissional: não encontrado");
      const input: ProfessionalInput = {
        userId: current?.userId ?? null,
        displayName: formText(form, "display_name"),
        profession: formText(form, "profession"),
        specialty: formOptionalText(form, "specialty"),
        council: formOptionalText(form, "council"),
        councilNumber: formOptionalText(form, "council_number"),
        councilState: formOptionalText(form, "council_state"),
        phone: formOptionalText(form, "phone"),
        ...(clinic.features.includes("daily_summary") ? { receivesDailySummary: formChecked(form, "receives_daily_summary") } : {}),
      };
      if (!current) {
        const created = await createProfessional(db, clinic.clinicId, input);
        return { redirectTo: page(created.id), message: "Profissional cadastrado." };
      }
      await updateProfessional(db, clinic.clinicId, id, input);
      return { redirectTo: page(id), message: "Profissional salvo." };
    },
    page(id),
  );
};
