import type { APIRoute } from "astro";
import { createUserClient } from "../../../lib/data/clients";
import { DataError } from "../../../lib/data/errors";
import { runFormAction } from "../../../lib/data/formAction";
import { giveBackToBot } from "../../../lib/data/whatsapp/attention";
import { formOptionalText, formText } from "../../../lib/forms";
import { safeReturnPath } from "../../../lib/returnPath";

// Atendimento humano (F8.5a): "Devolver ao bot", com confirmação na tela
// (cliente, 27/out/2026). Toda a equipe da clínica; o banco confere o papel. Da ficha do paciente ou do
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
      if (formText(form, "acao") !== "devolver") throw new DataError("invalid", "Atendimento humano: ação desconhecida");
      const phone = formText(form, "telefone");
      if (!/^\+\d{10,15}$/.test(phone)) throw new DataError("not_found", "Atendimento humano: conversa não encontrada");
      const returned = await giveBackToBot(createUserClient(request, cookies), clinic.clinicId, phone);
      return {
        redirectTo: page,
        message: returned ? "Conversa devolvida ao bot." : "Essa conversa já tinha voltado ao bot.",
      };
    },
    page,
  );
};
