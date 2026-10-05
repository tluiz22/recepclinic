import type { APIRoute } from "astro";
import type { ClinicRole } from "../../../../../lib/clinicAccess";
import type { AgendaScope } from "../../../../../lib/data/config/agendas";
import { inviteMember, listTeam, removeMember, updateMember, type MemberAccessInput } from "../../../../../lib/data/config/team";
import { createUserClient } from "../../../../../lib/data/clients";
import { DataError } from "../../../../../lib/data/errors";
import { runFormAction } from "../../../../../lib/data/formAction";
import { resendInvitation } from "../../../../../lib/data/onboarding";
import { onboardingDeps } from "../../../../../lib/data/onboardingDeps";
import { formAll, formOptionalText, formText } from "../../../../../lib/forms";

// Equipe (F4.4b): convidar (`novo`), salvar papéis, profissional e acesso às
// agendas, reenviar o convite e remover da clínica.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params, url } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const actorId = locals.userId!;
  const db = createUserClient(request, cookies);
  const list = "/admin/configuracoes/equipe";
  const page = (target: string) => `${list}/${target}`;
  const notSent = (reason: string) => ` Mas o e-mail não saiu (${reason}).`;
  const access = (): MemberAccessInput => ({
    displayName: formOptionalText(form, "display_name"),
    roles: formAll(form, "role") as ClinicRole[],
    professionalId: formOptionalText(form, "professional_id"),
    agendaScope: formText(form, "agenda_scope") as AgendaScope,
    grantedAgendaIds: formAll(form, "agenda_id"),
  });

  return runFormAction(
    context,
    async () => {
      switch (formText(form, "acao")) {
        case "convidar": {
          const result = await inviteMember(
            db,
            actorId,
            { id: clinic.clinicId, name: clinic.clinicName },
            formText(form, "email"),
            access(),
            onboardingDeps(url),
          );
          const what = result.existingUser ? "Pessoa incluída (já tinha login) e avisada por e-mail." : "Convite enviado.";
          return { redirectTo: page(result.userId), message: result.email.sent ? what : `${result.existingUser ? "Pessoa incluída." : "Convite criado."}${notSent(result.email.reason)}` };
        }
        case "salvar":
          await updateMember(db, actorId, clinic.clinicId, id, access());
          return { redirectTo: page(id), message: "Salvo." };
        case "reenviar": {
          const member = (await listTeam(db, clinic.clinicId)).find((m) => m.userId === id);
          if (!member?.invitation) throw new DataError("not_found", "Convite: não encontrado");
          const email = await resendInvitation(db, { id: clinic.clinicId, name: clinic.clinicName }, member.invitation.id, onboardingDeps(url));
          return { redirectTo: page(id), message: `Convite reenviado.${email.sent ? "" : notSent(email.reason)}` };
        }
        case "remover":
          await removeMember(db, actorId, clinic.clinicId, id);
          return { redirectTo: list, message: "Pessoa removida da equipe." };
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    page(id),
  );
};
