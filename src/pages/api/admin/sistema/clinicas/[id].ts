import type { APIRoute } from "astro";
import { isUuid } from "../../../../../lib/clinicAccess";
import { authorizeAgendaImport, requestAgendaImport, returnAgendaImport, undoAgendaImport } from "../../../../../lib/data/agendaImport";
import {
  activateBillingContract,
  discardBillingContractDraft,
  listBillingContracts,
  saveBillingAccount,
  saveBillingContractDraft,
  sendBillingContractNotice,
  type ContractNoticeResult,
} from "../../../../../lib/data/billing";
import { createUserClient } from "../../../../../lib/data/clients";
import { DataError } from "../../../../../lib/data/errors";
import { runFormAction } from "../../../../../lib/data/formAction";
import { createInfoRequest, markInfoRequestReviewed, resendInvitation, setClinicStatus } from "../../../../../lib/data/onboarding";
import { releaseClinicSuspension, suspendClinic } from "../../../../../lib/data/suspension";
import { onboardingDeps } from "../../../../../lib/data/onboardingDeps";
import { isFeatureKey } from "../../../../../lib/features";
import { applyCancellationNow, syncContractNow } from "../../../../../lib/data/billingAsaasDeps";
import { smtpSender } from "../../../../../lib/email";
import { platformEnv } from "../../../../../lib/env";
import { formChecked, formOptionalText, formText } from "../../../../../lib/forms";
import { clinicPlan, PLAN_LABELS } from "../../../../../lib/plans";

// Ações do Suporte numa clínica (F4.4a): reenviar convite, pedir as
// informações por e-mail e marcar as respostas como revisadas; pedir a agenda
// atual para a importação ou mandar um link novo (F10.1a) e devolver a agenda
// enviada à clínica, com comentário (F10.1b); autorizar a carga (F10.1c) e
// desfazer a carga (F10.1d); ativar a clínica em implantação ou voltar para
// a implantação (F8.2b); cadastrar ou alterar a conta de cobrança (F12.1,
// aba Faturamento); rascunho, ativação e descarte do contrato (F12.2); aviso
// por e-mail da nova versão com aceite tácito, na ativação ou de novo (F12.2b);
// suspender por um motivo e liberar um motivo (F12.3); sincronizar o contrato
// vigente com o Asaas (F12.4).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params, url } = context;
  const clinicId = params.id!;
  const form = await request.formData().catch(() => null);
  const page = `/admin/sistema/clinicas/${clinicId}`;
  // Erro ao devolver: volta à conferência, com o comentário marcado.
  const billingPage = `${page}?tab=faturamento`;
  const suspensionPage = `${page}?tab=suspensao`;
  const acao = formText(form, "acao");
  const failureTo = ["devolver_agenda", "autorizar_carga", "desfazer_carga"].includes(acao) ? `${page}/agenda-atual` : acao === "suspender" || acao === "liberar_suspensao" ? suspensionPage : acao === "conta_cobranca" || acao.startsWith("contrato_") || acao.startsWith("asaas_") ? billingPage : page;
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
      // Aviso da nova versão ao e-mail financeiro (F12.2b); a falha fica na trilha.
      const sendNotice = (contract: Parameters<typeof sendBillingContractNotice>[2]) =>
        sendBillingContractNotice(db, clinic, contract, { sendEmail: smtpSender(platformEnv().email), link: new URL("/admin/configuracoes/assinatura", url).toString() });
      const noticeMessage = (notice: ContractNoticeResult) =>
        notice.sent ? `Novos termos enviados para ${notice.to}.` : `Mas o e-mail dos novos termos não saiu (${notice.reason}): reenvie pela aba ou avise a clínica.`;
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
        case "conta_cobranca":
          await saveBillingAccount(db, clinicId, {
            payerName: formText(form, "payer_name"),
            payerDocument: formText(form, "payer_document"),
            financeEmail: formText(form, "finance_email"),
            financePhone: formOptionalText(form, "finance_phone"),
          });
          return { redirectTo: billingPage, message: "Conta de cobrança salva." };
        case "contrato_rascunho": {
          // Retrato do plano de referência (informativo), pela matriz de hoje.
          const { data: access } = await db.from("clinics").select("max_professionals, clinic_features ( feature_key )").eq("id", clinicId).maybeSingle();
          const features = (access?.clinic_features ?? []).map((grant) => grant.feature_key).filter(isFeatureKey);
          const reference = clinicPlan(features, access?.max_professionals ?? 1);
          await saveBillingContractDraft(
            db,
            clinicId,
            {
              billingMode: formText(form, "billing_mode"),
              monthly: formText(form, "monthly"),
              setup: formText(form, "setup"),
              paymentMethod: formOptionalText(form, "payment_method"),
              firstDueDate: formText(form, "first_due_date"),
              startsOn: formText(form, "starts_on"),
              invoicePrice: formOptionalText(form, "invoice_price"),
              allowanceKind: formOptionalText(form, "allowance_kind"),
              allowance: formOptionalText(form, "allowance"),
              notes: formOptionalText(form, "notes"),
            },
            {
              kind: reference.kind,
              label: PLAN_LABELS[reference.kind],
              tableMonthlyCents: reference.kind === "none" ? undefined : reference.monthlyCents,
              professionals: access?.max_professionals ?? 1,
            },
            // Nota fiscal só no contrato da clínica com a emissão liberada (cliente, 30/out/2026).
            { invoicing: features.includes("finance") },
          );
          return { redirectTo: billingPage, message: "Rascunho do contrato salvo. Confira e ative." };
        }
        case "contrato_ativar": {
          const contract = await activateBillingContract(db, clinicId);
          if (contract.acceptance !== "tacit") return { redirectTo: billingPage, message: "Contrato ativado. Falta o Administrador da clínica aceitar, em Configurações › Assinatura." };
          const notice = await sendNotice(contract);
          return { redirectTo: billingPage, message: `Nova versão ativada. ${noticeMessage(notice)}` };
        }
        case "contrato_reenviar_aviso": {
          const contract = (await listBillingContracts(db, clinicId)).find((c) => c.status === "active" && c.acceptance === "tacit");
          if (!contract) throw new DataError("not_found", "Contrato: não há nova versão para avisar");
          return { redirectTo: billingPage, message: noticeMessage(await sendNotice(contract)) };
        }
        case "contrato_descartar":
          await discardBillingContractDraft(db, clinicId);
          return { redirectTo: billingPage, message: "Rascunho do contrato descartado." };
        case "asaas_cancelamento": {
          // F12.2f: refaz o ajuste do cancelamento no Asaas (a conciliação diária também refaz).
          const contract = (await listBillingContracts(db, clinicId)).find((c) => c.id === formText(form, "contract_id") && c.cancel);
          if (!contract) throw new DataError("not_found", "Contrato cancelado: não encontrado");
          const result = await applyCancellationNow(contract.id);
          return {
            redirectTo: billingPage,
            message: result.status === "synced" ? "Cancelamento aplicado no Asaas." : result.status === "failed" ? `Asaas recusou: ${result.reason}` : `Nada a fazer: ${result.reason}.`,
          };
        }
        case "asaas_sincronizar": {
          const contract = (await listBillingContracts(db, clinicId)).find((c) => c.status === "active");
          if (!contract) throw new DataError("not_found", "Asaas: não há contrato vigente");
          const sync = await syncContractNow(contract.id);
          if (sync.status === "failed") throw new DataError("unexpected", `Asaas: ${sync.reason}`);
          return { redirectTo: billingPage, message: sync.status === "synced" ? "Cobranças atualizadas do Asaas." : `Nada a fazer no Asaas: ${sync.reason}.` };
        }
        case "suspender":
          await suspendClinic(db, clinicId, {
            reason: formText(form, "suspension_reason"),
            note: formText(form, "suspension_note"),
            noAppConfirmed: formChecked(form, "no_app_confirmed"),
          });
          return { redirectTo: suspensionPage, message: "Clínica suspensa." };
        case "liberar_suspensao":
          await releaseClinicSuspension(db, formText(form, "suspension_id"), formText(form, "release_note"));
          return { redirectTo: suspensionPage, message: "Motivo liberado." };
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
