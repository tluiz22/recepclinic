import type { APIRoute } from "astro";
import { isUuid } from "../../../../lib/clinicAccess";
import { DEFAULT_TIMEZONE, todayIn } from "../../../../lib/clinicTime";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { createMetaPriceVersion, deleteMetaPriceVersion } from "../../../../lib/data/metaPricing";
import { formText } from "../../../../lib/forms";

// Preços da Meta (CU2, tela P1, cliente, 05/nov/2026): cadastrar uma vigência e apagar uma futura. Só o Suporte (o
// banco confere: vigência do mês atual em diante; apagar só a que ainda não começou).
export const POST: APIRoute = async (context) => {
  const { request, cookies } = context;
  const form = await request.formData().catch(() => null);
  const page = "/admin/sistema/precos-meta";
  return runFormAction(
    context,
    async () => {
      const db = createUserClient(request, cookies);
      switch (formText(form, "acao")) {
        case "salvar":
          await createMetaPriceVersion(
            db,
            {
              validFrom: formText(form, "vigencia"),
              utilityBrl: formText(form, "utilidade"),
              authenticationBrl: formText(form, "autenticacao"),
              serviceBrl: formText(form, "servico"),
              freeServicePerMonth: formText(form, "gratis"),
              usdBrl: formText(form, "cambio"),
              source: formText(form, "fonte"),
            },
            todayIn(DEFAULT_TIMEZONE),
          );
          return { redirectTo: page, message: "Vigência cadastrada." };
        case "excluir": {
          const id = formText(form, "id");
          if (!isUuid(id)) throw new DataError("not_found", "Vigência futura: não encontrada");
          await deleteMetaPriceVersion(db, id);
          return { redirectTo: page, message: "Vigência futura apagada." };
        }
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    page,
  );
};
