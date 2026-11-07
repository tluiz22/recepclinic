import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { setConversationClassification, type ConversationClassification } from "../../../../lib/data/whatsapp/conversations";
import { formOptionalText, formText } from "../../../../lib/forms";
import { safeReturnPath } from "../../../../lib/returnPath";

// Conversas que não são atendimento (NA4 e NA5; cliente, 06/nov/2026, decisões 2, 3 e 5): marcar o número como Pessoal
// ou Administrativo/outros, ou devolver para atendimento. Pela tela Conversas (menu ⋯) e pela Atendimento (clínica sem a
// Central), sempre com confirmação na tela. Só Administrador e Recepção (o banco confere de novo).
const MESSAGES: Record<ConversationClassification, string> = {
  personal: "Conversa marcada como Pessoal: o bot não responde mais este número.",
  administrative: "Conversa marcada como Administrativo/outros: o bot não responde mais este número.",
  patient: "A conversa voltou para atendimento: o bot responde a próxima mensagem.",
};

export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const clinic = locals.clinic!;
  const form = await request.formData().catch(() => null);
  const back = safeReturnPath(formOptionalText(form, "return_to"), "/admin/conversas");
  const done = safeReturnPath(formOptionalText(form, "depois"), back);
  return runFormAction(
    context,
    async () => {
      if (!clinic.roles.some((role) => role === "admin" || role === "reception")) {
        throw new DataError("forbidden", "Conversas: só o Administrador e a Recepção marcam a conversa");
      }
      const phone = formText(form, "telefone");
      if (!/^\+\d{10,15}$/.test(phone)) throw new DataError("not_found", "Conversas: conversa não encontrada");
      const value = formText(form, "classificacao");
      if (value !== "personal" && value !== "administrative" && value !== "patient") throw new DataError("invalid", "Conversas: escolha como marcar a conversa");
      const changed = await setConversationClassification(createUserClient(request, cookies), clinic.clinicId, phone, value);
      return { redirectTo: done, message: changed ? MESSAGES[value] : "A conversa já estava assim." };
    },
    back,
  );
};
