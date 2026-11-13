import type { DbClient } from "../clients";
import { DataError, unwrap, Validation } from "../errors";
import { EMAIL_RE, normalizeEmail, resendInvitation, type EmailOutcome, type OnboardingDeps } from "../onboarding";
import { agendaOfProfessional } from "./agendas";
import { inviteMember, listTeam, removeMember, ROLE_LABELS, updateMember, type TeamMember } from "./team";

// Acesso ao painel pelo cadastro do profissional (cliente, 13/nov/2026): o e-mail e o convite
// ficam na aba "Acesso ao painel"; o que a pessoa vê e faz continua na Equipe. O convite é o
// mesmo da Equipe, com o papel Profissional, ligado ao cadastro e só com a própria agenda (D6).
// E-mail de quem já é da Equipe (ex.: a Administradora que também atende): com a confirmação,
// soma o papel Profissional e liga o cadastro ao login dela, sem convite novo.

export type ProfessionalAccess =
  | { state: "none" }
  | { state: "invited"; email: string; sentAt: Date | null; userId: string }
  | { state: "active"; email: string | null; userId: string; roles: string[]; onlyProfessional: boolean };

/** Situação do acesso: sem login, convite enviado (sem a senha criada) ou com acesso. */
export function accessOf(member: TeamMember | undefined): ProfessionalAccess {
  if (!member) return { state: "none" };
  if (member.invitation && !member.invitation.acceptedAt && member.email) {
    return { state: "invited", email: member.email, sentAt: member.invitation.lastSentAt, userId: member.userId };
  }
  return {
    state: "active",
    email: member.email,
    userId: member.userId,
    roles: member.roles.map((r) => ROLE_LABELS[r]),
    onlyProfessional: member.roles.length === 1 && member.roles[0] === "professional",
  };
}

export async function loadProfessionalAccess(db: DbClient, clinicId: string, professional: { id: string; userId: string | null }): Promise<ProfessionalAccess> {
  if (!professional.userId) return { state: "none" };
  return accessOf((await listTeam(db, clinicId)).find((m) => m.userId === professional.userId));
}

/** Ligação antiga a um login que saiu da Equipe: solta, para dar para convidar de novo. */
async function releaseStaleLink(db: DbClient, clinicId: string, professionalId: string, team: TeamMember[]): Promise<void> {
  const row = unwrap(await db.from("professionals").select("user_id").eq("clinic_id", clinicId).eq("id", professionalId).maybeSingle(), "Profissional");
  if (row?.user_id && !team.some((m) => m.userId === row.user_id)) {
    unwrap(await db.from("professionals").update({ user_id: null }).eq("clinic_id", clinicId).eq("id", professionalId), "Profissional");
  }
}

function checkEmail(email: string): string {
  const address = normalizeEmail(email ?? "");
  const v = new Validation();
  v.check(EMAIL_RE.test(address), "email", "E-mail inválido");
  v.throwIfInvalid("Acesso ao painel");
  return address;
}

export type InviteOutcome = { kind: "invited"; existingUser: boolean; email: EmailOutcome } | { kind: "member"; name: string; roles: string };

/**
 * Convida o profissional. Se o e-mail já for de alguém da Equipe, não convida: devolve quem é,
 * para a tela pedir a confirmação de ligar o cadastro ao login dessa pessoa.
 */
export async function inviteProfessional(
  db: DbClient,
  actorId: string,
  clinic: { id: string; name: string },
  professionalId: string,
  email: string,
  deps: OnboardingDeps,
): Promise<InviteOutcome> {
  const address = checkEmail(email);
  const team = await listTeam(db, clinic.id);
  const member = team.find((m) => m.email === address);
  if (member) {
    return { kind: "member", name: member.displayName ?? address, roles: member.roles.map((r) => ROLE_LABELS[r]).join(" e ") };
  }
  await releaseStaleLink(db, clinic.id, professionalId, team);
  const agenda = await agendaOfProfessional(db, clinic.id, professionalId);
  const result = await inviteMember(
    db,
    actorId,
    clinic,
    address,
    { roles: ["professional"], professionalId, agendaScope: "restricted", grantedAgendaIds: agenda ? [agenda.id] : [] },
    deps,
  );
  return { kind: "invited", existingUser: result.existingUser, email: result.email };
}

/** Liga o cadastro ao login de quem já é da Equipe (somando o papel Profissional e a agenda dele). */
export async function linkProfessionalToMember(db: DbClient, actorId: string, clinicId: string, professionalId: string, email: string): Promise<string> {
  const address = checkEmail(email);
  const team = await listTeam(db, clinicId);
  const member = team.find((m) => m.email === address);
  if (!member) throw new DataError("not_found", "Acesso ao painel: esta pessoa não está mais na Equipe", { email: "Esta pessoa não está mais na Equipe." });
  if (member.professionalId && member.professionalId !== professionalId) {
    throw new DataError("invalid", "Acesso ao painel: login já ligado a outro profissional", { email: "Este login já está ligado a outro cadastro de profissional." });
  }
  await releaseStaleLink(db, clinicId, professionalId, team);
  const agenda = await agendaOfProfessional(db, clinicId, professionalId);
  await updateMember(db, actorId, clinicId, member.userId, {
    displayName: member.displayName,
    roles: [...new Set([...member.roles, "professional" as const])],
    professionalId,
    agendaScope: member.agendaScope,
    grantedAgendaIds: member.agendaScope === "restricted" && agenda ? [...new Set([...member.grantedAgendaIds, agenda.id])] : member.grantedAgendaIds,
  });
  return member.displayName ?? address;
}

async function linkedMember(db: DbClient, clinicId: string, professionalId: string): Promise<TeamMember> {
  const member = (await listTeam(db, clinicId)).find((m) => m.professionalId === professionalId);
  if (!member) throw new DataError("not_found", "Acesso ao painel: o profissional não tem acesso");
  return member;
}

export async function resendProfessionalInvite(db: DbClient, clinic: { id: string; name: string }, professionalId: string, deps: OnboardingDeps): Promise<EmailOutcome> {
  const member = await linkedMember(db, clinic.id, professionalId);
  if (!member.invitation) throw new DataError("not_found", "Convite: não encontrado");
  return resendInvitation(db, clinic, member.invitation.id, deps);
}

/** Trocar o e-mail do convite ainda não aceito: cancela o antigo e convida o novo (e-mail conferido antes). */
export async function changeInviteEmail(
  db: DbClient,
  actorId: string,
  clinic: { id: string; name: string },
  professionalId: string,
  email: string,
  deps: OnboardingDeps,
): Promise<InviteOutcome> {
  const address = checkEmail(email);
  const team = await listTeam(db, clinic.id);
  const current = team.find((m) => m.professionalId === professionalId);
  if (!current || accessOf(current).state !== "invited") {
    throw new DataError("invalid", "Acesso ao painel: sem convite pendente", { email: "Não há convite pendente para trocar." });
  }
  if (current.email === address) throw new DataError("invalid", "Acesso ao painel: mesmo e-mail", { email: "É o mesmo e-mail do convite. Use Reenviar convite." });
  if (team.some((m) => m.email === address)) {
    throw new DataError("invalid", "Acesso ao painel: e-mail já da Equipe", { email: "Este e-mail já é de alguém da Equipe. Cancele o convite e convide de novo para ligar ao login dessa pessoa." });
  }
  await removeProfessionalAccess(db, actorId, clinic.id, professionalId);
  return inviteProfessional(db, actorId, clinic, professionalId, address, deps);
}

/**
 * Tira o acesso (ou cancela o convite): a pessoa sai da Equipe e o cadastro fica sem login.
 * Só para quem é apenas Profissional; quem também é Administrador ou Recepção muda pela Equipe.
 */
export async function removeProfessionalAccess(db: DbClient, actorId: string, clinicId: string, professionalId: string): Promise<void> {
  const member = await linkedMember(db, clinicId, professionalId);
  if (!(member.roles.length === 1 && member.roles[0] === "professional")) {
    throw new DataError("invalid", "Acesso ao painel: pessoa com outros papéis", {
      access: "Esta pessoa também tem outros papéis na clínica. Mude pela Equipe.",
    });
  }
  await removeMember(db, actorId, clinicId, member.userId);
  unwrap(await db.from("professionals").update({ user_id: null }).eq("clinic_id", clinicId).eq("id", professionalId), "Profissional");
}
