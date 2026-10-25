import type { APIRoute } from "astro";
import { isUuid } from "../../../../../lib/clinicAccess";
import { authorizeAgendaImport, requestAgendaImport, returnAgendaImport, undoAgendaImport } from "../../../../../lib/data/agendaImport";
import { createUserClient } from "../../../../../lib/data/clients";
import { DataError } from "../../../../../lib/data/errors";
import { runFormAction } from "../../../../../lib/data/formAction";
import { createInfoRequest, markInfoRequestReviewed, resendInvitation, setClinicStatus } from "../../../../../lib/data/onboarding";
import { onboardingDeps } from "../../../../../lib/data/onboardingDeps";
import { formText } from "../../../../../lib/forms";

// Ações do Suporte numa clínica (F4.4a): reenviar convite, pedir as
// informações por e-mail e marcar as respostas como revisadas; pedir a agenda
// atual para a importação ou mandar um link novo (F10.1a) e devolver a agenda
// enviada à clínica, com comentário (F10.1b); autorizar a carga (F10.1c) e
// desfazer a carga (F10.1d); ativar a clínica em implantação ou voltar para
// a implantação (F8.2b).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params, url } = context;
  const clinicId = params.id!;
  const form = await request.formData().catch(() => null);
  const page = `/admin/sistema/clinicas/${clinicId}`;
  // Erro ao devolver: volta à conferência, com o comentário marcado.
  const failureTo = ["devolver_agenda", "autorizar_carga", "desfazer_carga"].includes(formText(form, "acao")) ? `${page}/agenda-atual` : page;
  const db = createUserClient(request, cookies);

  return runFormAction(
    context,
    async () => {
      if (!isUuid(clinicId)) throw new DataError("not_found", "Clínica: não encontrada");
      const [{ data: clinic }, { data: settings }] = await Promise.all([
        db.from("clinics").select("id, name").eq("id", clinicId).maybeSingle(),
        db.from("clinic_settings").select("timezone").eq("clinic_id", clinicId).maybeSingle(),
      ]);
      if (!clinic || !settings) throw new DataError("not_found", "Clínica: não encontrada");
      const notSent = (reason: string) => ` Mas o e-mail não saiu (${reason}).`;

      switch (formText(form, "acao")) {
        case "reenviar_convite": {
          const email = await resendInvitation(db, clinic, formText(form, "invitation_id"), onboardingDeps(url));
          return { redirectTo: page, message: `Convite reenviado.${email.sent ? "" : notSent(email.reason)}` };
        }
        case "pedir_informacoes": {
          const result = await createInfoRequest(
            db,
            locals.userId!,
            { id: clinic.id, name: clinic.name, timezone: settings.timezone },
            formText(form, "email"),
            onboardingDeps(url),
          );
          const message = result.email.sent
            ? "Pedido de informações criado. E-mail enviado."
            : `Pedido de informações criado, mas o e-mail não saiu (${result.email.reason}). Envie este link ao Administrador (ele não aparece de novo): ${result.link}`;
          return { redirectTo: page, message };
        }
        case "pedir_agenda": {
          const result = await requestAgendaImport(
            db,
            locals.userId!,
            { id: clinic.id, name: clinic.name, timezone: settings.timezone },
            formText(form, "email"),
            onboardingDeps(url),
          );
          const what = result.renewed ? "Link novo da agenda atual criado (o anterior parou de funcionar)." : "Pedido da agenda atual criado.";
          const message = result.email.sent
            ? `${what} E-mail enviado.`
            : `${what} Mas o e-mail não saiu (${result.email.reason}). Envie este link à clínica (ele não aparece de novo): ${result.link}`;
          return { redirectTo: page, message };
        }
        case "devolver_agenda": {
          const result = await returnAgendaImport(
            db,
            locals.userId!,
            { id: clinic.id, name: clinic.name, timezone: settings.timezone },
            formText(form, "request_id"),
            formText(form, "comentario"),
            onboardingDeps(url),
          );
          const message = result.email.sent
            ? "Agenda atual devolvida à clínica, com o comentário. E-mail enviado com um link novo."
            : `Agenda atual devolvida, mas o e-mail não saiu (${result.email.reason}). Envie este link à clínica (ele não aparece de novo): ${result.link}`;
          return { redirectTo: page, message };
        }
        case "autorizar_carga": {
          const loaded = await authorizeAgendaImport(db, clinicId, formText(form, "request_id"));
          const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
          const reactivated = loaded.reactivated ? `; ${n(loaded.reactivated, "cadastro inativo voltou", "cadastros inativos voltaram")} a ficar ${loaded.reactivated === 1 ? "ativo" : "ativos"}` : "";
          return {
            redirectTo: page,
            message: `Agenda atual carregada: ${n(loaded.appointments, "consulta", "consultas")}, ${n(loaded.patients, "paciente novo", "pacientes novos")} e ${n(loaded.contacts, "contato novo", "contatos novos")}${reactivated}. Nenhum aviso de marcação foi enviado.`,
          };
        }
        case "desfazer_carga": {
          const undone = await undoAgendaImport(db, clinicId, formText(form, "request_id"), true);
          const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
          const kept = undone.appointmentsKept.length + undone.patientsKept.length + undone.contactsKept.length;
          return {
            redirectTo: page,
            message: `Carga desfeita: ${n(undone.appointmentsRemoved, "consulta removida", "consultas removidas")}, ${n(undone.patientsRemoved, "paciente", "pacientes")} e ${n(undone.contactsRemoved, "contato", "contatos")}.${kept ? ` Ficou: ${n(undone.appointmentsKept.length, "consulta já mexida", "consultas já mexidas")} e ${n(undone.patientsKept.length + undone.contactsKept.length, "cadastro em uso", "cadastros em uso")}, como a prévia mostrou.` : ""}`,
          };
        }
        case "ativar_clinica":
          await setClinicStatus(db, clinicId, "active");
          return { redirectTo: page, message: `${clinic.name} ativada: o bot, os avisos e os envios automáticos pelo WhatsApp passam a sair para os pacientes.` };
        case "voltar_implantacao":
          await setClinicStatus(db, clinicId, "onboarding");
          return { redirectTo: page, message: `${clinic.name} voltou para "Em implantação": nada sai para os pacientes pelo WhatsApp até ativar de novo.` };
        case "marcar_revisado":
          await markInfoRequestReviewed(db, locals.userId!, formText(form, "request_id"));
          return { redirectTo: page, message: "Respostas marcadas como revisadas." };
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    failureTo,
  );
};
