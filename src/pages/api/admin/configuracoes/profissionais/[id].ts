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
import { formOptionalText, formText } from "../../../../../lib/forms";

// Profissional (F4.3): criar (`novo`), salvar, desativar e reativar. O login
// ligado ao profissional fica como está (é definido na equipe, F4.4). O
// WhatsApp é obrigatório; quem recebe o resumo do dia é marcado em
// Configurações › Lembretes (cliente, 09/out/2026).
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
        rqe: formOptionalText(form, "rqe"),
        phone: formOptionalText(form, "phone"),
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
