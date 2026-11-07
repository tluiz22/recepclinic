import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { setCentralEnabled } from "../../../../lib/data/central";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { formText } from "../../../../lib/forms";

// Ligar e desligar a Central de atendimento (CU4; telas L1 e "Desligar", cliente, 05/nov/2026): só o Administrador
// da clínica, depois de ver o custo da Meta; ligar exige o item liberado pelo Suporte e o "Li e estou de acordo".
// O banco confere o papel e o item de novo e registra cada troca.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const back = "/admin/configuracoes/whatsapp#central";
  return runFormAction(
    context,
    async () => {
      if (!clinic.roles.includes("admin")) throw new DataError("forbidden", "Central de atendimento: só o Administrador da clínica liga ou desliga");
      const action = formText(form, "acao");
      if (action !== "ligar" && action !== "desligar") throw new DataError("invalid", "Central de atendimento: ação desconhecida");
      const enable = action === "ligar";
      if (enable && formText(form, "aceite") !== "1") {
        throw new DataError("invalid", "Central de atendimento", { aceite: "Marque \"Li e estou de acordo\" para ligar." });
      }
      await setCentralEnabled(createUserClient(request, cookies), clinic.clinicId, enable);
      return {
        redirectTo: back,
        message: enable
          ? "Central de atendimento ligada: a partir de agora as conversas ficam guardadas."
          : "Central de atendimento desligada: as mensagens novas deixam de ser guardadas. O assistente segue funcionando.",
      };
    },
    back,
  );
};
