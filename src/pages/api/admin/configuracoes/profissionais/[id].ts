import type { APIRoute } from "astro";
import { createUserClient } from "../../../../../lib/data/clients";
import {
  createProfessional,
  listProfessionals,
  setProfessionalActive,
  updateProfessional,
  type ProfessionalInput,
} from "../../../../../lib/data/config/professionals";
import { DataError } from "../../../../../lib/data/errors";
import { logError } from "../../../../../lib/log";
import { listInsurancePlans, listProfessionalPlans, setProfessionalCoverage } from "../../../../../lib/data/config/insurance";
import { removeProfilePhoto, uploadProfilePhoto } from "../../../../../lib/data/config/profilePhotos";
import { setProfessionalBotInfo } from "../../../../../lib/data/config/professionalBotInfo";
import { runFormAction } from "../../../../../lib/data/formAction";
import { agendaOfProfessional, updateAgendaAttendance } from "../../../../../lib/data/config/agendas";
import { attendanceFromForm } from "../../../../../lib/attendanceForm";
import { allFilterOn } from "../../../../../lib/returnPath";
import { professionalPage, tabOfAction } from "../../../../../lib/professionalTabs";
import { ownSettingsOnly } from "../../../../../lib/clinicAccess";
import { onboardingDeps } from "../../../../../lib/data/onboardingDeps";
import {
  changeInviteEmail,
  inviteProfessional,
  linkProfessionalToMember,
  removeProfessionalAccess,
  resendProfessionalInvite,
  type InviteOutcome,
} from "../../../../../lib/data/config/professionalAccess";
import { formAll, formOptionalText, formText } from "../../../../../lib/forms";

// Profissional (F4.3): criar (`novo`), salvar, desativar e reativar. O login
// ligado ao profissional fica como está (é definido na equipe, F4.4). O
// WhatsApp é obrigatório; quem recebe o resumo do dia é marcado em
// Configurações › Lembretes (cliente, 09/out/2026). Especialidades (ME, 07/nov/2026):
// as marcadas, com a principal (campo `principal`) na frente.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  // Cadastro aberto da lista em "Todos": volta com o filtro (teste da R9, NAV-06).
  const all = allFilterOn(new URL(request.url));
  const acao = formText(form, "acao");
  // Cadastro em abas (cliente, 13/nov/2026): salvo, volta à aba da parte em leitura; com erro, com ela aberta.
  const { tab, edit } = tabOfAction(acao);
  const page = (target: string) => professionalPage(target, tab, null, all);
  // E-mail de quem já é da Equipe: volta à aba Acesso pedindo a confirmação de ligar ao login.
  const confirmLink = (target: string, email: string) => `${professionalPage(target, "acesso", null, all)}&ligar=${encodeURIComponent(email)}`;
  const clinicRef = { id: clinic.clinicId, name: clinic.clinicName };
  const notSent = (reason: string) => ` Mas o e-mail não saiu (${reason}).`;
  const invited = (target: string, email: string, outcome: InviteOutcome) =>
    outcome.kind === "member"
      ? { redirectTo: confirmLink(target, email), message: `Este e-mail já é de alguém da Equipe (${outcome.name === email.trim().toLowerCase() ? "" : `${outcome.name}, `}${outcome.roles}). Confirme abaixo.` }
      : {
          redirectTo: professionalPage(target, "acesso", null, all),
          message: outcome.email.sent
            ? outcome.existingUser ? "Acesso liberado: a pessoa já tinha login e foi avisada por e-mail." : "Convite enviado."
            : `${outcome.existingUser ? "Acesso liberado." : "Convite criado."}${notSent(outcome.email.reason)}`,
        };

  return runFormAction(
    context,
    async () => {
      if (acao === "foto" || acao === "remover_foto") {
        // Foto (cliente, 08/nov/2026).
        const owner = { kind: "professional" as const, id };
        if (acao === "remover_foto") {
          await removeProfilePhoto(db, clinic.clinicId, owner);
          return { redirectTo: page(id), message: "Foto removida." };
        }
        const file = form?.get("photo");
        if (!(file instanceof File) || file.size === 0) throw new DataError("invalid", "Foto: escolha o arquivo", { photo: "Escolha o arquivo da foto." });
        await uploadProfilePhoto(db, clinic.clinicId, owner, file);
        return { redirectTo: page(id), message: "Foto salva." };
      }
      if (acao === "atendimento") {
        // Perfil, prazo e idade limite do profissional (cliente, 08/nov/2026): na agenda dele.
        const agenda = await agendaOfProfessional(db, clinic.clinicId, id);
        if (!agenda) throw new DataError("invalid", "Atendimento: profissional sem agenda", { profile: "Crie a agenda do profissional antes." });
        await updateAgendaAttendance(db, clinic.clinicId, agenda.id, attendanceFromForm(form));
        return { redirectTo: page(id), message: "Atendimento salvo." };
      }
      if (acao === "bot_info") {
        await setProfessionalBotInfo(db, clinic.clinicId, id, {
          paymentInfo: formOptionalText(form, "payment_info"),
          insuranceInfo: formOptionalText(form, "insurance_info"),
          notes: formOptionalText(form, "notes"),
        });
        return { redirectTo: page(id), message: "Informações do bot salvas." };
      }
      if (acao === "convenios") {
        // Particular e convênios (MC; F1 da recepção digital): particular sim/não, os planos ativos marcados e a
        // observação de cada um; a ligação a planos desativados fica, com a observação dela.
        const [active, current] = await Promise.all([listInsurancePlans(db, clinic.clinicId), listProfessionalPlans(db, clinic.clinicId, id)]);
        const activeIds = new Set(active.map((p) => p.id));
        const marked = formAll(form, "plan_id").filter((pid) => activeIds.has(pid));
        const acceptsPrivate = form?.get("accepts_private") === "1";
        await setProfessionalCoverage(db, clinic.clinicId, id, {
          acceptsPrivate,
          plans: marked.map((pid) => ({ planId: pid, note: formOptionalText(form, `note_${pid}`) })),
          keepPlanIds: current.filter((pid) => !activeIds.has(pid)),
        });
        const message = !marked.length ? "Salvo: só particular." : acceptsPrivate ? "Salvo: particular e convênios." : "Salvo: só convênios.";
        return { redirectTo: page(id), message };
      }
      if (tab === "acesso") {
        // Acesso ao painel (cliente, 13/nov/2026): só o Administrador, pela aba do cadastro.
        if (ownSettingsOnly(clinic)) throw new DataError("forbidden", "Acesso ao painel: só o Administrador");
        const actorId = locals.userId!;
        const deps = onboardingDeps(new URL(request.url));
        switch (acao) {
          case "convidar":
            return invited(id, formText(form, "email"), await inviteProfessional(db, actorId, clinicRef, id, formText(form, "email"), deps));
          case "trocar_email":
            return invited(id, formText(form, "email"), await changeInviteEmail(db, actorId, clinicRef, id, formText(form, "email"), deps));
          case "ligar_login": {
            const name = await linkProfessionalToMember(db, actorId, clinic.clinicId, id, formText(form, "email"));
            return { redirectTo: page(id), message: `Cadastro ligado ao login de ${name}.` };
          }
          case "reenviar": {
            const email = await resendProfessionalInvite(db, clinicRef, id, deps);
            return { redirectTo: page(id), message: `Convite reenviado.${email.sent ? "" : notSent(email.reason)}` };
          }
          default:
            await removeProfessionalAccess(db, actorId, clinic.clinicId, id);
            return { redirectTo: page(id), message: acao === "cancelar_convite" ? "Convite cancelado." : "Acesso retirado." };
        }
      }
      if (acao === "desativar" || acao === "reativar") {
        await setProfessionalActive(db, clinic.clinicId, id, acao === "reativar");
        return { redirectTo: page(id), message: acao === "reativar" ? "Profissional reativado." : "Profissional desativado." };
      }
      const current = id === "novo" ? null : (await listProfessionals(db, clinic.clinicId, { includeInactive: true })).find((p) => p.id === id);
      if (id !== "novo" && !current) throw new DataError("not_found", "Profissional: não encontrado");
      const input: ProfessionalInput = {
        userId: current?.userId ?? null,
        displayName: formText(form, "display_name"),
        profession: formText(form, "profession"),
        specialtyIds: withPrincipalFirst(formAll(form, "specialties"), formOptionalText(form, "principal")),
        council: formOptionalText(form, "council"),
        councilNumber: formOptionalText(form, "council_number"),
        councilState: formOptionalText(form, "council_state"),
        rqe: formOptionalText(form, "rqe"),
        phone: formOptionalText(form, "phone"),
      };
      if (!current) {
        const created = await createProfessional(db, clinic.clinicId, input);
        // E-mail opcional no cadastro (cliente, 13/nov/2026): preenchido, o convite já sai.
        const email = formOptionalText(form, "email");
        if (email && !ownSettingsOnly(clinic)) {
          try {
            const outcome = await inviteProfessional(db, locals.userId!, clinicRef, created.id, email, onboardingDeps(new URL(request.url)));
            const next = invited(created.id, email, outcome);
            return { ...next, message: `Profissional cadastrado. ${next.message}` };
          } catch (error) {
            if (!(error instanceof DataError)) logError("convite do profissional", error);
            const field = error instanceof DataError && error.code === "invalid" ? Object.values(error.fields)[0] : undefined;
            const reason = field ?? "tente de novo pela aba Acesso ao painel.";
            return { redirectTo: professionalPage(created.id, "acesso", null, all), message: `Profissional cadastrado, mas o convite não saiu: ${reason}`, tone: "error" as const };
          }
        }
        return { redirectTo: page(created.id), message: "Profissional cadastrado." };
      }
      await updateProfessional(db, clinic.clinicId, id, input);
      return { redirectTo: page(id), message: "Profissional salvo." };
    },
    id === "novo" ? professionalPage("novo", "perfil", null, all) : professionalPage(id, tab, edit, all),
  );
};

/** A principal vai na frente; sem ela (ou desmarcada), vale a ordem da lista. */
function withPrincipalFirst(ids: string[], principal: string | null): string[] {
  return principal && ids.includes(principal) ? [principal, ...ids.filter((id) => id !== principal)] : ids;
}
