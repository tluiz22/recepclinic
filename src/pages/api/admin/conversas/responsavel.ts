import type { APIRoute } from "astro";
import { isUuid } from "../../../../lib/clinicAccess";
import { createUserClient } from "../../../../lib/data/clients";
import { assignConversation } from "../../../../lib/data/centralSend";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { formOptionalText, formText } from "../../../../lib/forms";
import { safeReturnPath } from "../../../../lib/returnPath";

// Assumir e transferir (CN4a; decisão 5 e R2, cliente, 05/nov/2026): Administrador e Recepção. Transferir passa a
// conversa para alguém da equipe, inclusive um Profissional, sem motivo (Etapa 2). Se o responsável mudou desde que a
// tela abriu, nada muda e a tela avisa.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const clinic = locals.clinic!;
  const form = await request.formData().catch(() => null);
  const back = safeReturnPath(formOptionalText(form, "return_to"), "/admin/conversas");
  return runFormAction(
    context,
    async () => {
      if (!clinic.features.includes("central_attendance")) throw new DataError("not_enabled", "Conversas: sem a Central de atendimento");
      const phone = formText(form, "telefone");
      if (!/^\+\d{10,15}$/.test(phone)) throw new DataError("not_found", "Conversas: conversa não encontrada");
      const action = formText(form, "acao");
      const seen = formOptionalText(form, "responsavel_visto");
      const expected = isUuid(seen) ? seen : null;
      const to = action === "transferir" ? formOptionalText(form, "para") : null;
      if (action !== "assumir" && action !== "transferir") throw new DataError("invalid", "Conversas: ação desconhecida");
      if (action === "transferir" && !isUuid(to))
        throw new DataError("invalid", "Conversas: escolha para quem transferir", { para: "Escolha para quem transferir." });
      const db = createUserClient(request, cookies);
      const result = await assignConversation(db, clinic.clinicId, phone, {
        expected,
        to,
      });
      if (result.kind === "closed") throw new DataError("conflict", "Conversas: este atendimento já foi finalizado");
      if (result.kind === "changed")
        throw new DataError("conflict", `Conversas: ${result.name ?? "outra pessoa"} assumiu a conversa agora. Confira antes de mudar`);
      const name = result.name ?? "a pessoa escolhida";
      const message =
        result.kind === "same"
          ? action === "assumir"
            ? "A conversa já estava com você."
            : `A conversa já estava com ${name}.`
          : action === "assumir"
            ? "Você assumiu a conversa."
            : `Conversa transferida para ${name}.`;
      return { redirectTo: back, message };
    },
    back,
  );
};
