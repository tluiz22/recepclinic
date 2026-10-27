import type { APIRoute } from "astro";
import { createUserClient } from "../../../lib/data/clients";
import { DataError } from "../../../lib/data/errors";
import { runFormAction } from "../../../lib/data/formAction";
import { giveBackToBot } from "../../../lib/data/whatsapp/attention";
import { formText } from "../../../lib/forms";

// Atendimento humano (F8.5a): "Devolver ao bot", com confirmação na tela
// (cliente, 27/out/2026). Toda a equipe da clínica; o banco confere o papel.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const clinic = locals.clinic!;
  const page = "/admin/atendimento";
  const form = await request.formData().catch(() => null);

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
