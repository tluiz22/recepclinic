import type { APIRoute } from "astro";
import { createUserClient } from "../../../../../lib/data/clients";
import {
  createNotificationRecipient,
  listNotificationRecipients,
  setNotificationRecipientActive,
  updateNotificationRecipient,
} from "../../../../../lib/data/config/notificationRecipients";
import { DataError } from "../../../../../lib/data/errors";
import { runFormAction } from "../../../../../lib/data/formAction";
import { formChecked, formText } from "../../../../../lib/forms";

// Contato do resumo do dia (F4.4b): criar (`novo`), salvar, desativar e
// reativar. Sem o item de exames, a opção de exames fica como está.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  const page = (target: string) => `/admin/configuracoes/contatos/${target}`;
  const acao = formText(form, "acao");

  return runFormAction(
    context,
    async () => {
      if (acao === "desativar" || acao === "reativar") {
        await setNotificationRecipientActive(db, clinic.clinicId, id, acao === "reativar");
        return { redirectTo: page(id), message: acao === "reativar" ? "Contato reativado." : "Contato desativado." };
      }
      const current = id === "novo" ? null : (await listNotificationRecipients(db, clinic.clinicId, { includeInactive: true })).find((r) => r.id === id);
      if (id !== "novo" && !current) throw new DataError("not_found", "Contato: não encontrado");
      const input = {
        label: formText(form, "label"),
        phone: formText(form, "phone"),
        receivesConsultations: formChecked(form, "receives_consultations"),
        receivesExams: clinic.features.includes("exams") ? formChecked(form, "receives_exams") : (current?.receivesExams ?? false),
      };
      if (!current) {
        await createNotificationRecipient(db, clinic.clinicId, input);
        return { redirectTo: "/admin/configuracoes/lembretes", message: "Contato cadastrado." };
      }
      await updateNotificationRecipient(db, clinic.clinicId, id, input);
      return { redirectTo: "/admin/configuracoes/lembretes", message: "Contato salvo." };
    },
    page(id),
  );
};
