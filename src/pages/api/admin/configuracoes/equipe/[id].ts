import type { APIRoute } from "astro";
import type { ClinicRole } from "../../../../../lib/clinicAccess";
import type { AgendaScope } from "../../../../../lib/data/config/agendas";
import { inviteMember, listTeam, removeMember, updateMember, type MemberAccessInput } from "../../../../../lib/data/config/team";
import { createUserClient } from "../../../../../lib/data/clients";
import { DataError } from "../../../../../lib/data/errors";
import { removeProfilePhoto, uploadProfilePhoto } from "../../../../../lib/data/config/profilePhotos";
import { runFormAction } from "../../../../../lib/data/formAction";
import { professionalReturn } from "../../../../../lib/professionalTabs";
import { resendInvitation } from "../../../../../lib/data/onboarding";
import { onboardingDeps } from "../../../../../lib/data/onboardingDeps";
import { formAll, formChecked, formOptionalText, formText } from "../../../../../lib/forms";

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
  // Aberto do cadastro do profissional: a volta segue na tela da pessoa.
  const volta = professionalReturn(url.searchParams.get("volta"));
  const page = (target: string) => `${list}/${target}${volta ? `?volta=${encodeURIComponent(volta)}` : ""}`;
  const notSent = (reason: string) => ` Mas o e-mail não saiu (${reason}).`;
  const access = (): MemberAccessInput => ({
    displayName: formOptionalText(form, "display_name"),
    roles: formAll(form, "role") as ClinicRole[],
    professionalId: formOptionalText(form, "professional_id"),
    agendaScope: formText(form, "agenda_scope") as AgendaScope,
    grantedAgendaIds: formAll(form, "agenda_id"),
    // Só com o item "Convênios" ligado o campo aparece; sem ele, fica como está.
    canManageInsurance: clinic.features.includes("insurance") ? formChecked(form, "can_manage_insurance") : undefined,
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
        case "foto":
        case "remover_foto": {
          // Foto (cliente, 08/nov/2026).
          const owner = { kind: "member" as const, id };
          if (formText(form, "acao") === "remover_foto") {
            await removeProfilePhoto(db, clinic.clinicId, owner);
            return { redirectTo: page(id), message: "Foto removida." };
          }
          const file = form?.get("photo");
          if (!(file instanceof File) || file.size === 0) throw new DataError("invalid", "Foto: escolha o arquivo", { photo: "Escolha o arquivo da foto." });
          await uploadProfilePhoto(db, clinic.clinicId, owner, file);
          return { redirectTo: page(id), message: "Foto salva." };
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
