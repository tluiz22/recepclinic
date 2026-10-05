import type { APIRoute } from "astro";
import { createUserClient } from "../../../../../lib/data/clients";
import {
  createInsurancePlan,
  listPlanExclusions,
  setInsurancePlanActive,
  setPlanExclusions,
  updateInsurancePlan,
} from "../../../../../lib/data/config/insurance";
import { listProfessionals } from "../../../../../lib/data/config/professionals";
import { runFormAction } from "../../../../../lib/data/formAction";
import { formAll, formOptionalText, formText } from "../../../../../lib/forms";

// Plano de saúde (F4.4b): criar (`novo`), salvar, desativar e reativar. Os
// profissionais ativos desmarcados viram exceção; as exceções de
// profissionais desativados ficam como estão.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinicId = locals.clinic!.clinicId;
  const db = createUserClient(request, cookies);
  const page = (target: string) => `/admin/configuracoes/convenios/${target}`;
  const acao = formText(form, "acao");
  let createdId: string | null = null;

  return runFormAction(
    context,
    async () => {
      if (acao === "desativar" || acao === "reativar") {
        await setInsurancePlanActive(db, clinicId, id, acao === "reativar");
        return { redirectTo: page(id), message: acao === "reativar" ? "Plano reativado." : "Plano desativado." };
      }
      const input = {
        name: formText(form, "name"),
        alternativeNames: formText(form, "alternative_names").split(/\r?\n/),
        ansCode: formOptionalText(form, "ans_code"),
      };
      const planId = id === "novo" ? (createdId = (await createInsurancePlan(db, clinicId, input)).id) : (await updateInsurancePlan(db, clinicId, id, input)).id;

      const accepts = formAll(form, "accepts");
      const [active, current] = await Promise.all([listProfessionals(db, clinicId), listPlanExclusions(db, clinicId, planId)]);
      const activeIds = new Set(active.map((p) => p.id));
      const excluded = [...active.filter((p) => !accepts.includes(p.id)).map((p) => p.id), ...current.filter((pid) => !activeIds.has(pid))];
      await setPlanExclusions(db, clinicId, planId, excluded);
      return { redirectTo: page(planId), message: id === "novo" ? "Plano cadastrado." : "Plano salvo." };
    },
    () => page(createdId ?? id),
  );
};
