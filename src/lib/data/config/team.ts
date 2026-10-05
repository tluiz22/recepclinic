import type { ClinicRole } from "../../clinicAccess";
import type { DbClient } from "../clients";
import { DataError, unwrap, unwrapOne, Validation } from "../errors";
import { EMAIL_RE, inviteToClinic, listInvitations, normalizeEmail, type EmailOutcome, type OnboardingDeps } from "../onboarding";
import { setMemberAgendaAccess, type AgendaScope } from "./agendas";

// Equipe da clínica (F4.4b, D6): quem entra no painel, com quais papéis, a
// quais agendas tem acesso e a qual cadastro de profissional o login está
// ligado. Só o Administrador (e o Suporte) gerencia; o banco confere (RLS) e
// nunca deixa a clínica sem Administrador.
//
// Decisão do cliente (05/out/2026): quem tem o papel Profissional precisa
// estar ligado a um cadastro de profissional (é o que mostra a ele a própria
// agenda). Um cadastro, um login.

export const ROLE_LABELS: Record<ClinicRole, string> = {
  admin: "Administrador",
  professional: "Profissional",
  reception: "Recepção",
};

export const ROLES: ClinicRole[] = ["admin", "professional", "reception"];

export type TeamMember = {
  userId: string;
  email: string | null;
  roles: ClinicRole[];
  agendaScope: AgendaScope;
  /** Agendas liberadas uma a uma (valem só no acesso restrito). */
  grantedAgendaIds: string[];
  /** Cadastro de profissional ligado ao login. */
  professionalId: string | null;
  joinedAt: Date;
  /** Convite pelo painel (quem entrou antes dos convites não tem). */
  invitation: { id: string; lastSentAt: Date | null; acceptedAt: Date | null } | null;
};

export type MemberAccessInput = {
  roles: ClinicRole[];
  professionalId: string | null;
  agendaScope: AgendaScope;
  grantedAgendaIds: string[];
};

/** Confere e arruma papéis, ligação ao profissional e acesso às agendas. */
export function validateMemberAccess(input: MemberAccessInput): MemberAccessInput {
  const v = new Validation();
  const roles = ROLES.filter((role) => input.roles.includes(role));
  const isProfessional = roles.includes("professional");
  v.check(roles.length > 0, "roles", "Escolha ao menos um papel");
  v.check(!isProfessional || !!input.professionalId, "professionalId", "Escolha o cadastro de profissional desta pessoa");
  v.check(input.agendaScope === "all" || input.agendaScope === "restricted", "agendaScope", "Escolha o acesso às agendas");
  v.throwIfInvalid("Equipe");
  return {
    roles,
    professionalId: isProfessional ? input.professionalId : null,
    agendaScope: input.agendaScope,
    grantedAgendaIds: input.agendaScope === "all" ? [] : [...new Set(input.grantedAgendaIds)],
  };
}

export async function listTeam(db: DbClient, clinicId: string): Promise<TeamMember[]> {
  const [members, emails, invitations, professionals, grants] = await Promise.all([
    db
      .from("clinic_members")
      .select("user_id, roles, agenda_scope, created_at")
      .eq("clinic_id", clinicId)
      .then((r) => unwrap(r, "Equipe")),
    db.rpc("list_clinic_member_emails", { p_clinic_id: clinicId }).then((r) => unwrap(r, "E-mails da equipe")),
    listInvitations(db, clinicId),
    db
      .from("professionals")
      .select("id, user_id")
      .eq("clinic_id", clinicId)
      .not("user_id", "is", null)
      .then((r) => unwrap(r, "Profissionais")),
    db
      .from("member_agenda_grants")
      .select("user_id, agenda_id")
      .eq("clinic_id", clinicId)
      .then((r) => unwrap(r, "Agendas liberadas")),
  ]);
  const emailOf = new Map(emails.map((row) => [row.user_id, row.email]));
  return members
    .map((member) => {
      const email = emailOf.get(member.user_id) ?? null;
      const invitation = invitations.find((i) => i.email === email);
      return {
        userId: member.user_id,
        email,
        roles: ROLES.filter((role) => member.roles.includes(role)),
        agendaScope: member.agenda_scope,
        grantedAgendaIds: grants.filter((g) => g.user_id === member.user_id).map((g) => g.agenda_id).sort(),
        professionalId: professionals.find((p) => p.user_id === member.user_id)?.id ?? null,
        joinedAt: new Date(member.created_at),
        invitation: invitation ? { id: invitation.id, lastSentAt: invitation.lastSentAt, acceptedAt: invitation.acceptedAt } : null,
      };
    })
    .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
}

/** O cadastro de profissional pode ser ligado a este login? (ativo e livre) */
async function checkProfessionalLink(db: DbClient, clinicId: string, professionalId: string, userId: string | null): Promise<void> {
  const professional = unwrap(
    await db.from("professionals").select("user_id, is_active").eq("clinic_id", clinicId).eq("id", professionalId).maybeSingle(),
    "Profissional",
  );
  const v = new Validation();
  v.check(!!professional && professional.is_active, "professionalId", "Escolha um profissional ativo");
  v.check(!professional?.user_id || professional.user_id === userId, "professionalId", "Este profissional já está ligado a outra pessoa da equipe");
  v.throwIfInvalid("Equipe");
}

/** Liga o login a um cadastro de profissional (ou a nenhum), soltando o anterior. */
async function linkProfessional(db: DbClient, clinicId: string, userId: string, professionalId: string | null): Promise<void> {
  let release = db.from("professionals").update({ user_id: null }).eq("clinic_id", clinicId).eq("user_id", userId);
  if (professionalId) release = release.neq("id", professionalId);
  unwrap(await release, "Profissional");
  if (professionalId) {
    unwrapOne(
      await db.from("professionals").update({ user_id: userId }).eq("clinic_id", clinicId).eq("id", professionalId).select("id").maybeSingle(),
      "Profissional",
    );
  }
}

/**
 * Convida uma pessoa para a equipe (mesmo envio da F4.4a): quem já tem login
 * entra direto e recebe um aviso; quem não tem recebe o convite para criar a
 * senha. Depois liga o profissional e grava o acesso às agendas.
 */
export async function inviteMember(
  db: DbClient,
  actorId: string,
  clinic: { id: string; name: string },
  email: string,
  input: MemberAccessInput,
  deps: OnboardingDeps,
): Promise<{ userId: string; existingUser: boolean; email: EmailOutcome }> {
  const address = normalizeEmail(email ?? "");
  const v = new Validation();
  v.check(EMAIL_RE.test(address), "email", "E-mail inválido");
  v.throwIfInvalid("Equipe");
  const access = validateMemberAccess(input);
  if (access.professionalId) await checkProfessionalLink(db, clinic.id, access.professionalId, null);
  if ((await listTeam(db, clinic.id)).some((member) => member.email === address)) {
    throw new DataError("duplicate", "Equipe: esta pessoa já faz parte da equipe", { email: "Esta pessoa já faz parte da equipe." });
  }

  const result = await inviteToClinic(db, actorId, clinic, address, access.roles, deps);
  await linkProfessional(db, clinic.id, result.userId, access.professionalId);
  await setMemberAgendaAccess(db, clinic.id, result.userId, access.agendaScope, access.grantedAgendaIds);
  return result;
}

/**
 * Muda papéis, profissional ligado e acesso às agendas. Ninguém tira o
 * próprio papel de Administrador (ficaria fora de Configurações sem querer);
 * o banco impede tirar o do último.
 */
export async function updateMember(
  db: DbClient,
  actorId: string,
  clinicId: string,
  userId: string,
  input: MemberAccessInput,
): Promise<void> {
  const access = validateMemberAccess(input);
  const member = (await listTeam(db, clinicId)).find((m) => m.userId === userId);
  if (!member) throw new DataError("not_found", "Equipe: pessoa não encontrada");
  if (userId === actorId && member.roles.includes("admin") && !access.roles.includes("admin")) {
    throw new DataError("invalid", "Equipe: você não pode tirar o seu próprio papel de Administrador", {
      roles: "Você não pode tirar o seu próprio papel de Administrador. Peça a outro Administrador.",
    });
  }
  if (access.professionalId) await checkProfessionalLink(db, clinicId, access.professionalId, userId);

  unwrapOne(
    await db
      .from("clinic_members")
      .update({ roles: access.roles })
      .eq("clinic_id", clinicId)
      .eq("user_id", userId)
      .select("user_id")
      .maybeSingle(),
    "Equipe",
  );
  await linkProfessional(db, clinicId, userId, access.professionalId);
  await setMemberAgendaAccess(db, clinicId, userId, access.agendaScope, access.grantedAgendaIds);
}

/**
 * Tira a pessoa da clínica: perde o acesso; o login continua (pode ser de
 * outra clínica) e o histórico fica. O convite sai junto, para dar para
 * convidar de novo.
 */
export async function removeMember(db: DbClient, actorId: string, clinicId: string, userId: string): Promise<void> {
  if (userId === actorId) {
    throw new DataError("invalid", "Equipe: você não pode remover a si mesmo", { userId: "Você não pode remover a si mesmo. Peça a outro Administrador." });
  }
  unwrapOne(
    await db.from("clinic_members").delete().eq("clinic_id", clinicId).eq("user_id", userId).select("user_id").maybeSingle(),
    "Equipe",
  );
  unwrap(await db.from("clinic_invitations").delete().eq("clinic_id", clinicId).eq("user_id", userId), "Convite");
}
