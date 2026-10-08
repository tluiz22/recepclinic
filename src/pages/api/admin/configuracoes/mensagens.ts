import type { APIRoute } from "astro";
import { createClinicServiceClient } from "../../../../lib/data/clinicService";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { TEMPLATE_KEYS, type TemplateKey } from "../../../../lib/data/whatsapp/connection";
import {
  approveAndSendProposal,
  botMessageDef,
  clearGuidance,
  declineProposal,
  proposeTemplate,
  resetBotMessage,
  resetTemplateToDefault,
  saveBotMessage,
  saveGuidance,
  withdrawProposal,
  type BotMessageKey,
} from "../../../../lib/data/whatsapp/customMessages";
import { formText } from "../../../../lib/forms";

// Configurações › Mensagens (F6.6; validação de 08/out/2026): o Administrador
// da clínica escreve as orientações gerais (sempre), edita a conversa do bot
// (item "Mensagens do bot") e propõe os avisos (item "Mensagens da Meta"); o
// Suporte aprova e envia à Meta (com a credencial da clínica, que lê o token)
// ou recusa com o motivo. O banco confere o papel e o item (RLS).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const grupo = formText(form, "grupo") === "meta" ? "meta" : "bot";
  const back = `/admin/configuracoes/mensagens${grupo === "meta" ? "?grupo=meta" : ""}`;
  const acao = formText(form, "acao");
  const db = createUserClient(request, cookies);
  const actorId = locals.userId ?? null;
  const templateKey = () => {
    const key = formText(form, "key");
    if (!(TEMPLATE_KEYS as readonly string[]).includes(key)) throw new DataError("invalid", "Mensagem desconhecida", { key: "Mensagem desconhecida." });
    return key as TemplateKey;
  };
  const botKey = () => {
    const key = formText(form, "key");
    if (!botMessageDef(key)) throw new DataError("invalid", "Mensagem desconhecida", { key: "Mensagem desconhecida." });
    return key as BotMessageKey;
  };
  const admin = () => {
    if (!clinic.roles.includes("admin")) throw new DataError("forbidden", "Só o Administrador da clínica altera as mensagens");
  };
  const editor = (feature: "custom_messages" | "custom_templates") => {
    if (!clinic.features.includes(feature)) {
      throw new DataError("not_enabled", feature === "custom_messages" ? "Mensagens do bot não liberadas" : "Mensagens da Meta não liberadas");
    }
    admin();
  };
  const support = () => {
    if (!clinic.isPlatformStaff) throw new DataError("forbidden", "Só o Suporte revisa as propostas");
  };

  return runFormAction(
    context,
    async () => {
      switch (acao) {
        case "orientacoes_salvar":
          admin();
          await saveGuidance(db, clinic.clinicId, formText(form, "text"), actorId);
          return { redirectTo: back, message: "Orientações gerais salvas." };
        case "orientacoes_apagar":
          admin();
          await clearGuidance(db, clinic.clinicId);
          return { redirectTo: back, message: "Orientações gerais apagadas." };
        case "conversa_salvar":
          editor("custom_messages");
          await saveBotMessage(db, clinic.clinicId, botKey(), formText(form, "text"), actorId);
          return { redirectTo: back, message: "Mensagem salva: já vale no bot." };
        case "conversa_padrao":
          editor("custom_messages");
          await resetBotMessage(db, clinic.clinicId, botKey());
          return { redirectTo: back, message: "Voltou ao texto padrão." };
        case "template_propor":
          editor("custom_templates");
          await proposeTemplate(db, clinic.clinicId, templateKey(), formText(form, "text"), actorId);
          return { redirectTo: back, message: "Proposta enviada para a revisão do Suporte. O texto atual continua até a aprovação da Meta." };
        case "template_retirar":
          editor("custom_templates");
          await withdrawProposal(db, clinic.clinicId, templateKey());
          return { redirectTo: back, message: "Proposta retirada." };
        case "template_padrao":
          editor("custom_templates");
          await resetTemplateToDefault(db, clinic.clinicId, templateKey());
          return { redirectTo: back, message: "Voltou ao texto padrão." };
        case "suporte_aprovar": {
          support();
          const problem = await approveAndSendProposal(createClinicServiceClient(clinic.clinicId), clinic.clinicId, formText(form, "id"));
          if (problem) throw new DataError("invalid", `Proposta: a Meta não aceitou (${problem})`, { id: `A Meta não aceitou: ${problem}` });
          return { redirectTo: back, message: "Proposta enviada à Meta. Aprovada, passa a ser usada sozinha." };
        }
        case "suporte_recusar":
          support();
          await declineProposal(db, clinic.clinicId, formText(form, "id"), formText(form, "note"));
          return { redirectTo: back, message: "Proposta recusada; a clínica vê o motivo." };
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    back,
  );
};
