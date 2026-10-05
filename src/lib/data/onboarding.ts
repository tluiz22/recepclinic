import { createHash, randomBytes } from "node:crypto";
import { formatInstant, isValidTimeZone } from "../clinicTime";
import { addedToClinicEmail, EmailNotConfiguredError, infoRequestEmail, inviteEmail, type EmailSender } from "../email";
import { normalizeAnswers, submitProblem, type OnboardingAnswers } from "../onboardingForm";
import type { Json } from "../supabase/database.types";
import type { DbClient } from "./clients";
import { cleanText, DataError, fromDbError, unwrap, unwrapOne, Validation } from "./errors";

// Nova clínica, convites e pedido de informações (F4.4a, L47; cliente,
// 05/out/2026). O Suporte cria a clínica com o próprio login (fica no
// registro): nasce com a matriz desligada e limite de 1 profissional, e o
// primeiro Administrador é sempre convidado na criação. Se o Administrador
// preferir que o Suporte configure, o Suporte pede as informações por e-mail,
// com um formulário por link; as respostas ficam para o Suporte revisar.

export const INFO_REQUEST_DAYS = 30;

export type ClinicProfileValue = "pediatric" | "adult" | "mixed";
export type NewClinicInput = { name: string; profile: ClinicProfileValue; timezone: string; adminEmail: string };

/** O que vem da plataforma (service role) e o envio de e-mail; os testes trocam. */
export type OnboardingDeps = {
  findUserIdByEmail: (email: string) => Promise<string | null>;
  createPasswordLink: (email: string, kind: "invite" | "resend") => Promise<{ userId: string; tokenHash: string; type: "invite" | "recovery" }>;
  sendEmail: EmailSender;
  /** Endereço do painel, para os links dos e-mails. */
  baseUrl: string;
};

export type EmailOutcome = { sent: true } | { sent: false; reason: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateNewClinic(input: NewClinicInput): NewClinicInput {
  const v = new Validation();
  const clean = {
    name: cleanText(input.name) ?? "",
    profile: input.profile,
    timezone: input.timezone,
    adminEmail: normalizeEmail(input.adminEmail ?? ""),
  };
  v.check(clean.name.length > 0, "name", "Informe o nome da clínica.");
  v.check(["pediatric", "adult", "mixed"].includes(clean.profile), "profile", "Escolha o perfil.");
  v.check(isValidTimeZone(clean.timezone), "timezone", "Escolha o fuso horário.");
  v.check(EMAIL_RE.test(clean.adminEmail), "adminEmail", "E-mail do Administrador inválido.");
  v.throwIfInvalid("Nova clínica");
  return clean;
}

async function trySend(send: () => Promise<void>): Promise<EmailOutcome> {
  try {
    await send();
    return { sent: true };
  } catch (error) {
    if (!(error instanceof EmailNotConfiguredError)) console.error("[e-mail] envio falhou:", error);
    return { sent: false, reason: error instanceof EmailNotConfiguredError ? "envio de e-mail não configurado" : "o envio falhou" };
  }
}

const passwordLink = (deps: OnboardingDeps, tokenHash: string, type: "invite" | "recovery") =>
  `${deps.baseUrl}/api/admin/auth/confirmar?token_hash=${encodeURIComponent(tokenHash)}&type=${type}${type === "recovery" ? "&origem=convite" : ""}`;

/**
 * Convida uma pessoa para a clínica com os papéis: quem já tem login entra
 * direto (e recebe um aviso); quem não tem recebe o convite para criar a
 * senha. O vínculo e o convite ficam gravados mesmo se o e-mail não sair
 * (dá para reenviar).
 */
export async function inviteToClinic(
  db: DbClient,
  actorId: string,
  clinic: { id: string; name: string },
  email: string,
  roles: ("admin" | "professional" | "reception")[],
  deps: OnboardingDeps,
  now: Date = new Date(),
): Promise<{ existingUser: boolean; email: EmailOutcome }> {
  const address = normalizeEmail(email);
  const existing = await deps.findUserIdByEmail(address);
  const link = existing ? null : await deps.createPasswordLink(address, "invite");
  const userId = existing ?? link!.userId;

  // Acesso a todas as agendas; a equipe ajusta depois (F4.4b).
  unwrap(await db.from("clinic_members").insert({ clinic_id: clinic.id, user_id: userId, roles, agenda_scope: "all" }), "Membro da equipe");
  unwrap(
    await db.from("clinic_invitations").insert({
      clinic_id: clinic.id,
      email: address,
      user_id: userId,
      roles,
      invited_by: actorId,
      invited_at: now.toISOString(),
      last_sent_at: now.toISOString(),
      accepted_at: existing ? now.toISOString() : null,
    }),
    "Convite",
  );

  const message = existing
    ? addedToClinicEmail(address, { clinicName: clinic.name, loginUrl: `${deps.baseUrl}/admin/login` })
    : inviteEmail(address, { clinicName: clinic.name, link: passwordLink(deps, link!.tokenHash, link!.type) });
  return { existingUser: !!existing, email: await trySend(() => deps.sendEmail(message)) };
}

/** Suporte: cria a clínica e convida o primeiro Administrador. */
export async function createClinicWithAdmin(
  db: DbClient,
  actorId: string,
  input: NewClinicInput,
  deps: OnboardingDeps,
  now: Date = new Date(),
): Promise<{ clinicId: string; existingUser: boolean; email: EmailOutcome }> {
  const clean = validateNewClinic(input);
  const clinicId = crypto.randomUUID();
  unwrap(await db.from("clinics").insert({ id: clinicId, name: clean.name }), "Clínica");
  try {
    unwrapOne(
      await db
        .from("clinic_settings")
        .update({ profile: clean.profile, timezone: clean.timezone })
        .eq("clinic_id", clinicId)
        .select("clinic_id")
        .maybeSingle(),
      "Configuração da clínica",
    );
    const result = await inviteToClinic(db, actorId, { id: clinicId, name: clean.name }, clean.adminEmail, ["admin"], deps, now);
    return { clinicId, ...result };
  } catch (error) {
    // Sem o Administrador, a clínica não fica pela metade.
    await db.from("clinics").delete().eq("id", clinicId);
    throw error;
  }
}

export type Invitation = {
  id: string;
  email: string;
  roles: ("admin" | "professional" | "reception")[];
  invitedAt: Date;
  lastSentAt: Date | null;
  acceptedAt: Date | null;
};

export async function listInvitations(db: DbClient, clinicId: string): Promise<Invitation[]> {
  const rows = unwrap(
    await db
      .from("clinic_invitations")
      .select("id, email, roles, invited_at, last_sent_at, accepted_at")
      .eq("clinic_id", clinicId)
      .order("invited_at"),
    "Convites",
  );
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    roles: row.roles,
    invitedAt: new Date(row.invited_at),
    lastSentAt: row.last_sent_at ? new Date(row.last_sent_at) : null,
    acceptedAt: row.accepted_at ? new Date(row.accepted_at) : null,
  }));
}

/** Reenvia o convite de quem ainda não criou a senha (o link anterior vence em 24h). */
export async function resendInvitation(
  db: DbClient,
  clinic: { id: string; name: string },
  invitationId: string,
  deps: OnboardingDeps,
  now: Date = new Date(),
): Promise<EmailOutcome> {
  const invitation = (await listInvitations(db, clinic.id)).find((i) => i.id === invitationId);
  if (!invitation) throw new DataError("not_found", "Convite: não encontrado");
  if (invitation.acceptedAt) throw new DataError("invalid", "Convite: a pessoa já criou a senha", { invitation: "Esta pessoa já criou a senha e entra pelo login." });
  const link = await deps.createPasswordLink(invitation.email, "resend");
  unwrap(await db.from("clinic_invitations").update({ last_sent_at: now.toISOString() }).eq("id", invitationId), "Convite");
  return trySend(() => deps.sendEmail(inviteEmail(invitation.email, { clinicName: clinic.name, link: passwordLink(deps, link.tokenHash, link.type) })));
}

/** Quem acabou de criar a senha: os convites dele ficam aceitos. */
export async function markMyInvitationsAccepted(db: DbClient): Promise<void> {
  const { error } = await db.rpc("mark_my_invitations_accepted");
  if (error) console.error("[convite] não marcou como aceito:", error.message);
}

// ---------------------------------------------------------------------------
// Visão do Suporte
// ---------------------------------------------------------------------------

export type RequestStatus = "sent" | "draft" | "submitted" | "reviewed";

export type ClinicOverview = {
  id: string;
  name: string;
  status: string;
  createdAt: Date;
  pendingInvitations: number;
  /** Situação do pedido de informações mais recente. */
  latestRequest: RequestStatus | null;
};

export async function listClinicsOverview(db: DbClient): Promise<ClinicOverview[]> {
  const rows = unwrap(
    await db
      .from("clinics")
      .select("id, name, status, created_at, clinic_invitations ( accepted_at ), onboarding_requests ( status, requested_at )")
      .order("created_at", { ascending: false }),
    "Clínicas",
  );
  return rows.map((row) => {
    const latest = [...row.onboarding_requests].sort((a, b) => b.requested_at.localeCompare(a.requested_at))[0];
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      createdAt: new Date(row.created_at),
      pendingInvitations: row.clinic_invitations.filter((i) => !i.accepted_at).length,
      latestRequest: (latest?.status as RequestStatus | undefined) ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Pedido de informações
// ---------------------------------------------------------------------------

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type InfoRequest = {
  id: string;
  email: string;
  status: RequestStatus;
  answers: OnboardingAnswers;
  requestedAt: Date;
  expiresAt: Date;
  savedAt: Date | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
};

const REQUEST_COLUMNS = "id, email, status, answers, requested_at, expires_at, saved_at, submitted_at, reviewed_at";

type RequestRow = {
  id: string;
  email: string;
  status: string;
  answers: Json;
  requested_at: string;
  expires_at: string;
  saved_at: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
};

const toRequest = (row: RequestRow): InfoRequest => ({
  id: row.id,
  email: row.email,
  status: row.status as RequestStatus,
  answers: normalizeAnswers(row.answers),
  requestedAt: new Date(row.requested_at),
  expiresAt: new Date(row.expires_at),
  savedAt: row.saved_at ? new Date(row.saved_at) : null,
  submittedAt: row.submitted_at ? new Date(row.submitted_at) : null,
  reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
});

/** Suporte: cria o pedido e envia o e-mail com o link (válido por 30 dias). */
export async function createInfoRequest(
  db: DbClient,
  actorId: string,
  clinic: { id: string; name: string; timezone: string },
  email: string,
  deps: Pick<OnboardingDeps, "sendEmail" | "baseUrl">,
  now: Date = new Date(),
): Promise<{ email: EmailOutcome; link: string }> {
  const address = normalizeEmail(email);
  if (!EMAIL_RE.test(address)) throw new DataError("invalid", "Pedido de informações: e-mail inválido", { email: "E-mail inválido." });
  const token = newToken();
  const expiresAt = new Date(now.getTime() + INFO_REQUEST_DAYS * 24 * 60 * 60_000);
  unwrap(
    await db.from("onboarding_requests").insert({
      clinic_id: clinic.id,
      token_hash: hashToken(token),
      email: address,
      requested_by: actorId,
      requested_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    }),
    "Pedido de informações",
  );
  // O link só existe aqui (o banco guarda o hash): sem e-mail, o Suporte o recebe uma vez.
  const link = `${deps.baseUrl}/formulario/${token}`;
  const message = infoRequestEmail(address, { clinicName: clinic.name, link, expiresOn: formatInstant(expiresAt, clinic.timezone, "dd/MM/yyyy") });
  return { email: await trySend(() => deps.sendEmail(message)), link };
}

export async function listInfoRequests(db: DbClient, clinicId: string): Promise<InfoRequest[]> {
  const rows = unwrap(
    await db.from("onboarding_requests").select(REQUEST_COLUMNS).eq("clinic_id", clinicId).order("requested_at", { ascending: false }),
    "Pedidos de informações",
  );
  return rows.map(toRequest);
}

/** Suporte: respostas revisadas e cadastradas. */
export async function markInfoRequestReviewed(db: DbClient, actorId: string, requestId: string, now: Date = new Date()): Promise<void> {
  unwrapOne(
    await db
      .from("onboarding_requests")
      .update({ status: "reviewed", reviewed_by: actorId, reviewed_at: now.toISOString() })
      .eq("id", requestId)
      .eq("status", "submitted")
      .select("id")
      .maybeSingle(),
    "Pedido de informações",
  );
}

/** Página pública (credencial da clínica): o pedido do link. */
export async function getInfoRequestByToken(db: DbClient, token: string): Promise<InfoRequest | null> {
  const row = unwrap(
    await db.from("onboarding_requests").select(REQUEST_COLUMNS).eq("token_hash", hashToken(token)).maybeSingle(),
    "Pedido de informações",
  );
  return row ? toRequest(row) : null;
}

/** Página pública: salva o rascunho ou envia ao Suporte. Depois de enviado ou vencido, não muda. */
export async function saveInfoRequestAnswers(
  db: DbClient,
  token: string,
  answers: OnboardingAnswers,
  submit: boolean,
  now: Date = new Date(),
): Promise<void> {
  if (submit) {
    const problem = submitProblem(answers);
    if (problem) {
      // O que foi digitado fica salvo como rascunho.
      await saveInfoRequestAnswers(db, token, answers, false, now);
      throw new DataError("invalid", `Formulário: ${problem}`, { form: problem });
    }
  }
  const { data, error } = await db
    .from("onboarding_requests")
    .update({
      answers: answers as unknown as NonNullable<Json>,
      status: submit ? "submitted" : "draft",
      saved_at: now.toISOString(),
      ...(submit ? { submitted_at: now.toISOString() } : {}),
    })
    .eq("token_hash", hashToken(token))
    .select("id")
    .maybeSingle();
  if (error) {
    if ((error as { hint?: string }).hint === "onboarding_closed") {
      throw new DataError("invalid", "Formulário: já enviado ou vencido", { form: "Este formulário já foi enviado ou venceu." }, { cause: error });
    }
    throw fromDbError(error, "Formulário");
  }
  if (!data) throw new DataError("not_found", "Formulário: não encontrado");
}
