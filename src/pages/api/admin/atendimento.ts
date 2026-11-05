import type { APIRoute } from "astro";
import { createUserClient } from "../../../lib/data/clients";
import { DataError } from "../../../lib/data/errors";
import { runFormAction } from "../../../lib/data/formAction";
import { finishAttendance } from "../../../lib/data/whatsapp/attention";
import { formOptionalText, formText } from "../../../lib/forms";
import { safeReturnPath } from "../../../lib/returnPath";

// Atendimento humano (F8.5a; CA, cliente, 04/nov/2026): "Finalizar atendimento" (era "Devolver ao bot"; o bot volta
// sem mandar nada), com confirmação na tela. Toda a equipe da clínica; o banco confere o papel. Da ficha do paciente ou do
// responsável (C26), volta para a ficha (`return_to`).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const clinic = locals.clinic!;
  const form = await request.formData().catch(() => null);
  const page = safeReturnPath(formOptionalText(form, "return_to"), "/admin/atendimento");

  return runFormAction(
    context,
    async () => {
      if (!clinic.features.includes("whatsapp_bot")) throw new DataError("forbidden", "Atendimento humano: sem o bot");
      const action = formText(form, "acao");
      // "devolver": formulário aberto antes da troca do nome.
      if (action !== "finalizar" && action !== "devolver") throw new DataError("invalid", "Atendimento humano: ação desconhecida");
      const phone = formText(form, "telefone");
      if (!/^\+\d{10,15}$/.test(phone)) throw new DataError("not_found", "Atendimento humano: conversa não encontrada");
      const db = createUserClient(request, cookies);
      // Hora da situação que a tela mostrou: se o paciente escreveu depois, não finaliza sem a recepção ver.
      const seen = formOptionalText(form, "situacao_em");
      const seenStatusAt = seen && !Number.isNaN(Date.parse(seen)) ? new Date(seen) : null;
      const result = await finishAttendance(db, clinic.clinicId, phone, { seenStatusAt });
      if (result === "patient_wrote") throw new DataError("conflict", "O paciente escreveu de novo. Confira a conversa no WhatsApp antes de finalizar.");
      return {
        redirectTo: page,
        message: result === "finished" ? "Atendimento finalizado. O bot volta a responder na próxima mensagem do paciente." : "Esse atendimento já tinha sido finalizado.",
      };
    },
    page,
  );
};
