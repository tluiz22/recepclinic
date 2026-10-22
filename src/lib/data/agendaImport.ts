import {
  AGENDA_IMPORT_DAYS,
  isImportOpen,
  normalizeImportEntries,
  validateImport,
  type BusyPeriod,
  type ImportCatalog,
  type ImportIssues,
  type ImportPatient,
  type ImportRequestStatus,
} from "../agendaImport";
import { buildLoadPlan, reviewImport, type ImportReview, type ReviewContext } from "../agendaImportReview";
import { addDays, dayBounds, formatInstant, isCalendarDate, todayIn } from "../clinicTime";
import { agendaImportEmail, agendaImportReturnedEmail } from "../email";
import { normalizePhone } from "../phone";
import type { Json } from "../supabase/database.types";
import type { DbClient } from "./clients";
import { DataError, fromDbError, unwrap, unwrapAll, unwrapOne } from "./errors";
import { getClinicFeatures } from "./features";
import { EMAIL_RE, hashToken, newToken, normalizeEmail, trySend, type EmailOutcome, type OnboardingDeps } from "./onboarding";

// Agenda atual para a importação na implantação (F10.1a; cliente, 19 e
// 20/out/2026). O Suporte pede (e-mail com o link, 15 dias); a clínica
// preenche sem login e envia; a conferência e a carga são do Suporte (F10.1b
// e F10.1c). Um pedido em andamento por clínica: "Mandar link novo" troca o
// código e o prazo, e o que já foi digitado continua.

export type AgendaImportRequest = {
  id: string;
  email: string;
  status: ImportRequestStatus;
  entries: ImportPatient[];
  returnComment: string | null;
  requestedAt: Date;
  linkSentAt: Date;
  expiresAt: Date;
  savedAt: Date | null;
  submittedAt: Date | null;
  loadedAt: Date | null;
};

const COLUMNS = "id, email, status, entries, return_comment, requested_at, link_sent_at, expires_at, saved_at, submitted_at, loaded_at";

type Row = {
  id: string;
  email: string;
  status: string;
  entries: Json;
  return_comment: string | null;
  requested_at: string;
  link_sent_at: string;
  expires_at: string;
  saved_at: string | null;
  submitted_at: string | null;
  loaded_at: string | null;
};

const toRequest = (row: Row): AgendaImportRequest => ({
  id: row.id,
  email: row.email,
  status: row.status as ImportRequestStatus,
  entries: normalizeImportEntries(row.entries),
  returnComment: row.return_comment,
  requestedAt: new Date(row.requested_at),
  linkSentAt: new Date(row.link_sent_at),
  expiresAt: new Date(row.expires_at),
  savedAt: row.saved_at ? new Date(row.saved_at) : null,
  submittedAt: row.submitted_at ? new Date(row.submitted_at) : null,
  loadedAt: row.loaded_at ? new Date(row.loaded_at) : null,
});

/** Suporte: o pedido em andamento da clínica (há no máximo um) ou, sem ele, o da carga (ou pedido) mais recente. */
export async function getLatestAgendaImport(db: DbClient, clinicId: string): Promise<AgendaImportRequest | null> {
  const rows = unwrap(
    await db.from("agenda_import_requests").select(COLUMNS).eq("clinic_id", clinicId).order("requested_at", { ascending: false }),
    "Agenda atual",
  ).map(toRequest);
  const recent = (r: AgendaImportRequest) => (r.loadedAt ?? r.requestedAt).getTime();
  return rows.find((r) => isImportOpen(r.status) || r.status === "submitted") ?? [...rows].sort((a, b) => recent(b) - recent(a))[0] ?? null;
}

/**
 * Suporte: pede a agenda atual por e-mail ou, com um pedido ainda aberto para
 * a clínica, manda um link novo (o anterior para de funcionar; o rascunho
 * continua). Depois de enviada ao Suporte, só a conferência (F10.1b) devolve.
 */
export async function requestAgendaImport(
  db: DbClient,
  actorId: string,
  clinic: { id: string; name: string; timezone: string },
  email: string,
  deps: Pick<OnboardingDeps, "sendEmail" | "baseUrl">,
  now: Date = new Date(),
): Promise<{ email: EmailOutcome; link: string; renewed: boolean }> {
  const address = normalizeEmail(email);
  if (!EMAIL_RE.test(address)) throw new DataError("invalid", "Agenda atual: e-mail inválido", { email: "E-mail inválido." });
  const token = newToken();
  const expiresAt = new Date(now.getTime() + AGENDA_IMPORT_DAYS * 24 * 60 * 60_000);
  const latest = await getLatestAgendaImport(db, clinic.id);
  if (latest?.status === "submitted") {
    throw new DataError("invalid", "Agenda atual: já enviada ao Suporte", {
      email: "A clínica já enviou a agenda atual: confira antes de pedir de novo.",
    });
  }
  const renewed = !!latest && isImportOpen(latest.status);
  const link = { token_hash: hashToken(token), email: address, link_sent_at: now.toISOString(), expires_at: expiresAt.toISOString() };
  if (renewed) {
    unwrap(await db.from("agenda_import_requests").update(link).eq("id", latest.id), "Agenda atual");
  } else {
    unwrap(
      await db.from("agenda_import_requests").insert({ clinic_id: clinic.id, requested_by: actorId, requested_at: now.toISOString(), ...link }),
      "Agenda atual",
    );
  }
  // O link só existe aqui (o banco guarda o hash): sem e-mail, o Suporte o recebe uma vez.
  const url = `${deps.baseUrl}/importar/${token}`;
  const message = agendaImportEmail(address, { clinicName: clinic.name, link: url, expiresOn: formatInstant(expiresAt, clinic.timezone, "dd/MM/yyyy") });
  return { email: await trySend(() => deps.sendEmail(message)), link: url, renewed };
}

// ---------------------------------------------------------------------------
// Página do link (credencial da clínica)
// ---------------------------------------------------------------------------

export async function getAgendaImportByToken(db: DbClient, token: string): Promise<AgendaImportRequest | null> {
  const row = unwrap(await db.from("agenda_import_requests").select(COLUMNS).eq("token_hash", hashToken(token)).maybeSingle(), "Agenda atual");
  return row ? toRequest(row) : null;
}

/** Serviços, agendas, locais e convênios ativos da clínica (menus do link). */
export async function loadImportCatalog(db: DbClient, clinicId: string): Promise<ImportCatalog> {
  const [features, services, agendas, pairs, locations, plans] = await Promise.all([
    getClinicFeatures(db, clinicId),
    db.from("services").select("id, name, duration_minutes, scheduling_mode, category").eq("clinic_id", clinicId).eq("is_active", true).order("name"),
    db.from("agendas").select("id, name").eq("clinic_id", clinicId).eq("is_active", true).order("name"),
    db.from("service_agendas").select("service_id, agenda_id").eq("clinic_id", clinicId),
    db.from("locations").select("id, name, type").eq("clinic_id", clinicId).eq("is_active", true).order("name"),
    db.from("insurance_plans").select("id, name").eq("clinic_id", clinicId).eq("is_active", true).order("name"),
  ]);
  return {
    services: unwrap(services, "Serviços").map((s) => ({ id: s.id, name: s.name, durationMinutes: s.duration_minutes, group: s.scheduling_mode === "group", category: s.category })),
    agendas: unwrap(agendas, "Agendas").map((a) => ({ id: a.id, name: a.name })),
    serviceAgendas: unwrap(pairs, "Serviços das agendas").map((p) => ({ serviceId: p.service_id, agendaId: p.agenda_id })),
    locations: unwrap(locations, "Locais").map((l) => ({ id: l.id, name: l.name, homeVisit: l.type === "home_visit" })),
    insurancePlans: features.includes("insurance") ? unwrap(plans, "Convênios").map((p) => ({ id: p.id, name: p.name })) : [],
  };
}

/** Horários ocupados nas agendas da clínica nos dias das consultas digitadas (só início e fim). */
export async function loadBusyPeriods(db: DbClient, clinicId: string, patients: ImportPatient[], timeZone: string): Promise<BusyPeriod[]> {
  const dates = patients
    .flatMap((p) => p.appointments.map((a) => a.date))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  if (dates.length === 0) return [];
  // Um dia antes: atendimento que começa na véspera e passa da meia-noite.
  const start = dayBounds(addDays(dates[0], -1), timeZone).start;
  const end = dayBounds(dates[dates.length - 1], timeZone).end;
  // Em páginas: uma carga longa numa clínica cheia passa das 1000 linhas da API.
  const rows = await unwrapAll(
    (from, to) =>
      db
        .from("appointments")
        .select("agenda_id, scheduled_at, duration_minutes")
        .eq("clinic_id", clinicId)
        .in("status", ["scheduled", "confirmed"])
        .eq("is_group_session", false)
        .gte("scheduled_at", start.toISOString())
        .lt("scheduled_at", end.toISOString())
        .order("id")
        .range(from, to),
    "Horários ocupados",
  );
  return rows.map((r) => {
    const begin = new Date(r.scheduled_at);
    return { agendaId: r.agenda_id, start: begin, end: new Date(begin.getTime() + r.duration_minutes * 60_000) };
  });
}

/** A conferência do que está digitado, com o cadastro atual da clínica. */
export async function checkImport(
  db: DbClient,
  clinicId: string,
  patients: ImportPatient[],
  catalog: ImportCatalog,
  timeZone: string,
  now: Date = new Date(),
): Promise<ImportIssues> {
  const busy = await loadBusyPeriods(db, clinicId, patients, timeZone);
  return validateImport(patients, catalog, { timeZone, today: todayIn(timeZone, now), now, busy });
}

/**
 * Página do link: salva o rascunho (mesmo com erro) ou envia ao Suporte (só
 * sem erro; com erro, fica salvo como rascunho). Devolve os problemas achados.
 */
export async function saveAgendaImport(
  db: DbClient,
  clinicId: string,
  token: string,
  patients: ImportPatient[],
  submit: boolean,
  timeZone: string,
  now: Date = new Date(),
): Promise<{ issues: ImportIssues; submitted: boolean }> {
  const catalog = await loadImportCatalog(db, clinicId);
  const issues = await checkImport(db, clinicId, patients, catalog, timeZone, now);
  const problems = Object.keys(issues).length;
  const sending = submit && problems === 0 && patients.length > 0;
  const { data, error } = await db
    .from("agenda_import_requests")
    .update({
      entries: patients as unknown as NonNullable<Json>,
      status: sending ? "submitted" : "draft",
      saved_at: now.toISOString(),
      ...(sending ? { submitted_at: now.toISOString() } : {}),
    })
    .eq("token_hash", hashToken(token))
    .select("id")
    .maybeSingle();
  if (error) {
    if ((error as { hint?: string }).hint === "agenda_import_closed") {
      throw new DataError("invalid", "Agenda atual: já enviada ou vencida", { form: "Este link já foi enviado ou venceu." }, { cause: error });
    }
    throw fromDbError(error, "Agenda atual");
  }
  if (!data) throw new DataError("not_found", "Agenda atual: não encontrada");
  return { issues, submitted: sending };
}

// ---------------------------------------------------------------------------
// Conferência e devolução pelo Suporte (F10.1b)
// ---------------------------------------------------------------------------

/** Suporte: um pedido da clínica pelo id. */
export async function getAgendaImport(db: DbClient, clinicId: string, requestId: string): Promise<AgendaImportRequest | null> {
  const row = unwrap(await db.from("agenda_import_requests").select(COLUMNS).eq("clinic_id", clinicId).eq("id", requestId).maybeSingle(), "Agenda atual");
  return row ? toRequest(row) : null;
}

/** A conferência do pedido com o cadastro de agora (Suporte). */
export async function loadImportReview(db: DbClient, clinicId: string, patients: ImportPatient[], now: Date = new Date()): Promise<{ review: ImportReview; catalog: ImportCatalog; timeZone: string; context: ReviewContext }> {
  const settings = unwrapOne(
    await db.from("clinic_settings").select("timezone, consultation_age_limit_years").eq("clinic_id", clinicId).maybeSingle(),
    "Configuração da clínica",
  );
  const timeZone = settings.timezone;
  const dates = patients
    .flatMap((p) => p.appointments.map((a) => a.date))
    .filter(isCalendarDate)
    .sort();
  const phones = [...new Set(patients.map((p) => (p.phone ? normalizePhone(p.phone) : null)).filter((p): p is string => !!p))];
  const from = dates.length ? dayBounds(addDays(dates[0], -1), timeZone).start : null;
  const to = dates.length ? dayBounds(dates[dates.length - 1], timeZone).end : null;

  const [catalog, busy, windows, serviceLocations, blocks, holidays, contacts] = await Promise.all([
    loadImportCatalog(db, clinicId),
    loadBusyPeriods(db, clinicId, patients, timeZone),
    db
      .from("availability_windows")
      .select("agenda_id, location_id, service_id, weekday, start_time, end_time")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .then((r) => unwrap(r, "Horários de atendimento")),
    db
      .from("service_locations")
      .select("service_id, location_id")
      .eq("clinic_id", clinicId)
      .then((r) => unwrap(r, "Locais dos serviços")),
    from && to
      ? db
          .from("schedule_blocks")
          .select("agenda_id, starts_at, ends_at")
          .eq("clinic_id", clinicId)
          .is("removed_at", null)
          .lt("starts_at", to.toISOString())
          .gt("ends_at", from.toISOString())
          .then((r) => unwrap(r, "Bloqueios"))
      : Promise.resolve([]),
    dates.length
      ? db
          .from("clinic_holidays")
          .select("date")
          .eq("clinic_id", clinicId)
          .gte("date", dates[0])
          .lte("date", dates[dates.length - 1])
          .then((r) => unwrap(r, "Feriados"))
      : Promise.resolve([]),
    phones.length
      ? db
          .from("contacts")
          .select("id, phone, full_name, is_active, patients ( id, full_name, birthdate, is_active, insurance_plan_id, insurance_card_number )")
          .eq("clinic_id", clinicId)
          .in("phone", phones)
          .then((r) => unwrap(r, "Contatos"))
      : Promise.resolve([]),
  ]);

  const context: ReviewContext = {
    timeZone,
    today: todayIn(timeZone, now),
    now,
    busy,
    windows: windows.map((w) => ({
      agendaId: w.agenda_id,
      locationId: w.location_id,
      serviceId: w.service_id,
      weekday: w.weekday,
      startTime: w.start_time.slice(0, 5),
      endTime: w.end_time.slice(0, 5),
    })),
    serviceLocations: serviceLocations.map((l) => ({ serviceId: l.service_id, locationId: l.location_id })),
    blocks: blocks.map((b) => ({ agendaId: b.agenda_id, start: new Date(b.starts_at), end: new Date(b.ends_at) })),
    holidays: new Set(holidays.map((h) => h.date)),
    contacts: contacts.map((c) => ({
      id: c.id,
      phone: c.phone,
      name: c.full_name,
      isActive: c.is_active,
      patients: c.patients.map((p) => ({
        id: p.id,
        name: p.full_name,
        birthdate: p.birthdate,
        isActive: p.is_active,
        insurancePlanId: p.insurance_plan_id,
        cardNumber: p.insurance_card_number,
      })),
    })),
    consultationAgeLimit: settings.consultation_age_limit_years,
  };
  return { review: reviewImport(patients, catalog, context), catalog, timeZone, context };
}

export const MAX_RETURN_COMMENT = 2000;

/**
 * Suporte: devolve a agenda enviada à clínica com o que corrigir. Sai um link
 * novo (15 dias) por e-mail, com o comentário; o rascunho continua.
 */
export async function returnAgendaImport(
  db: DbClient,
  actorId: string,
  clinic: { id: string; name: string; timezone: string },
  requestId: string,
  comment: string,
  deps: Pick<OnboardingDeps, "sendEmail" | "baseUrl">,
  now: Date = new Date(),
): Promise<{ email: EmailOutcome; link: string }> {
  const text = comment.trim();
  if (!text) throw new DataError("invalid", "Agenda atual: sem comentário", { comentario: "Escreva o que a clínica precisa corrigir." });
  if (text.length > MAX_RETURN_COMMENT) {
    throw new DataError("invalid", "Agenda atual: comentário longo", { comentario: `No máximo ${MAX_RETURN_COMMENT} caracteres.` });
  }
  const request = await getAgendaImport(db, clinic.id, requestId);
  if (!request) throw new DataError("not_found", "Agenda atual: não encontrada");
  if (request.status !== "submitted") {
    throw new DataError("invalid", "Agenda atual: não está para conferir", { comentario: "Só a agenda enviada ao Suporte pode ser devolvida." });
  }
  const token = newToken();
  const expiresAt = new Date(now.getTime() + AGENDA_IMPORT_DAYS * 24 * 60 * 60_000);
  unwrapOne(
    await db
      .from("agenda_import_requests")
      .update({
        status: "returned",
        return_comment: text,
        returned_by: actorId,
        returned_at: now.toISOString(),
        token_hash: hashToken(token),
        link_sent_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      })
      .eq("id", request.id)
      .eq("status", "submitted")
      .select("id")
      .maybeSingle(),
    "Agenda atual",
  );
  const url = `${deps.baseUrl}/importar/${token}`;
  const message = agendaImportReturnedEmail(request.email, {
    clinicName: clinic.name,
    link: url,
    comment: text,
    expiresOn: formatInstant(expiresAt, clinic.timezone, "dd/MM/yyyy"),
  });
  return { email: await trySend(() => deps.sendEmail(message)), link: url };
}

// ---------------------------------------------------------------------------
// Carga (F10.1c)
// ---------------------------------------------------------------------------

export type LoadResult = { contacts: number; patients: number; appointments: number; reactivated: number };

/**
 * Suporte: autoriza a carga da agenda enviada. Confere de novo na hora (com
 * erro, não grava nada) e grava tudo numa transação (load_agenda_import), sem
 * aviso de marcação; as consultas que já passaram ficam de fora.
 */
export async function authorizeAgendaImport(db: DbClient, clinicId: string, requestId: string, now: Date = new Date()): Promise<LoadResult> {
  const request = await getAgendaImport(db, clinicId, requestId);
  if (!request) throw new DataError("not_found", "Agenda atual: não encontrada");
  if (request.status !== "submitted") throw new DataError("invalid", "Agenda atual: não está para autorizar", { carga: "Esta agenda atual não está para autorizar." });
  const { review, catalog, context } = await loadImportReview(db, clinicId, request.entries, now);
  if (review.errorCount > 0) {
    throw new DataError("invalid", "Agenda atual: com erro", {
      carga: `A conferência achou ${review.errorCount === 1 ? "1 erro" : `${review.errorCount} erros`}: devolva à clínica para corrigir.`,
    });
  }
  const plan = buildLoadPlan(review, request.entries, catalog, context);
  const { data, error } = await db.rpc("load_agenda_import", { p_request_id: request.id, p_plan: plan as unknown as Json });
  if (error) {
    const code = (error as { code?: string }).code;
    // Um horário ocupado entre a conferência e a gravação: nada entra.
    if (code === "23P01") {
      throw new DataError("conflict", "Agenda atual: um horário ficou ocupado durante a gravação e nada foi gravado. Confira de novo", {}, { cause: error });
    }
    throw fromDbError(error, "Carga da agenda atual");
  }
  return data as unknown as LoadResult;
}

// ---------------------------------------------------------------------------
// Desfazer a carga (F10.1d)
// ---------------------------------------------------------------------------

export type UndoResult = {
  applied: boolean;
  appointmentsRemoved: number;
  patientsRemoved: number;
  contactsRemoved: number;
  appointmentsKept: { patientName: string; serviceName: string; scheduledAt: Date; reasons: string[] }[];
  patientsKept: { name: string; reason: string }[];
  contactsKept: { name: string; reason: string }[];
};

/**
 * Suporte: desfaz a carga (`apply`) ou mostra o que aconteceria (prévia, sem
 * mudar nada). Ficam as consultas já mexidas e o que tem outro uso; o
 * resultado diz quais e por quê.
 */
export async function undoAgendaImport(db: DbClient, clinicId: string, requestId: string, apply: boolean): Promise<UndoResult> {
  const request = await getAgendaImport(db, clinicId, requestId);
  if (!request) throw new DataError("not_found", "Agenda atual: não encontrada");
  if (request.status !== "loaded") throw new DataError("invalid", "Agenda atual: não carregada", { carga: "Esta agenda atual não foi carregada." });
  const { data, error } = await db.rpc("undo_agenda_import", { p_request_id: request.id, p_apply: apply });
  if (error) throw fromDbError(error, "Desfazer a carga");
  const raw = data as unknown as Omit<UndoResult, "appointmentsKept"> & { appointmentsKept: { patientName: string; serviceName: string; scheduledAt: string; reasons: string[] }[] };
  return { ...raw, appointmentsKept: raw.appointmentsKept.map((a) => ({ ...a, scheduledAt: new Date(a.scheduledAt) })) };
}
