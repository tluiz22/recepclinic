import { createClient } from "@supabase/supabase-js";
import { isUuid } from "../clinicAccess";
import { platformEnv, type PlatformEnv } from "../env";
import type { Database } from "../supabase/database.types";
import type { DbClient } from "./clients";
import type { ErrorRecord } from "../log";

// Único ponto do código novo com a service role (D1, F3.3), que ignora o RLS.
// O cliente não sai deste arquivo: só funções estreitas da plataforma.
//
// Nas portas públicas ela só descobre de qual clínica é a requisição; o resto
// segue com createClinicServiceClient(clinicId). Rotinas administrativas da
// plataforma: achar o login de um e-mail e gerar o link de convite (F4.4a; a
// clínica em si é criada com o login do Suporte, que fica no registro).

type ServiceEnv = Pick<PlatformEnv, "supabaseUrl" | "supabaseServiceRoleKey">;

function platformClient(env: ServiceEnv): DbClient {
  return createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export class PlatformLookupError extends Error {
  constructor(what: string, cause: unknown) {
    super(`Falha ao descobrir a clínica (${what})`, { cause });
    this.name = "PlatformLookupError";
  }
}

function clinicIdOrNull(what: string, result: { data: string | null; error: unknown }): string | null {
  if (result.error) throw new PlatformLookupError(what, result.error);
  return result.data ?? null;
}

/** Webhook do WhatsApp: clínica do número que recebeu a mensagem (desconectado = nenhuma). */
export async function resolveClinicByPhoneNumberId(
  phoneNumberId: string,
  env: ServiceEnv = platformEnv(),
): Promise<string | null> {
  if (!phoneNumberId.trim()) return null;
  return clinicIdOrNull(
    "número do WhatsApp",
    await platformClient(env).rpc("resolve_whatsapp_clinic", { p_phone_number_id: phoneNumberId }),
  );
}

/** Webhook do WhatsApp: clínicas conectadas da conta (WABA), para a situação dos templates (F6.2). */
export async function resolveClinicsByWabaId(wabaId: string, env: ServiceEnv = platformEnv()): Promise<string[]> {
  if (!wabaId.trim()) return [];
  const result = await platformClient(env).rpc("resolve_whatsapp_clinics_by_waba", { p_waba_id: wabaId });
  if (result.error) throw new PlatformLookupError("conta do WhatsApp", result.error);
  return (result.data ?? []) as string[];
}

/** Rotina da conversa parada (F6.3): clínicas com conversa parada desde antes de `before`. */
export async function listClinicsWithIdleConversations(before: Date, env: ServiceEnv = platformEnv()): Promise<string[]> {
  const result = await platformClient(env).rpc("list_clinics_with_idle_conversations", { p_before: before.toISOString() });
  if (result.error) throw new PlatformLookupError("conversas paradas", result.error);
  return (result.data ?? []) as string[];
}

/** Rotinas do agendador (F7): clínicas ativas; cada uma roda depois com a própria credencial. */
export async function listActiveClinics(env: ServiceEnv = platformEnv()): Promise<string[]> {
  const result = await platformClient(env).rpc("list_active_clinics");
  if (result.error) throw new PlatformLookupError("clínicas ativas", result.error);
  return (result.data ?? []) as string[];
}

/** /agendar/[token]: clínica do link de agendamento (vencido ou usado também resolve). */
export async function resolveClinicByBookingLink(
  linkId: string,
  env: ServiceEnv = platformEnv(),
): Promise<string | null> {
  if (!isUuid(linkId)) return null;
  return clinicIdOrNull(
    "link de agendamento",
    await platformClient(env).rpc("resolve_booking_link_clinic", { p_link_id: linkId }),
  );
}

/** /preparo/[id]: clínica do serviço (exame) cujo preparo é mostrado. */
export async function resolveClinicByService(
  serviceId: string,
  env: ServiceEnv = platformEnv(),
): Promise<string | null> {
  if (!isUuid(serviceId)) return null;
  return clinicIdOrNull(
    "serviço",
    await platformClient(env).rpc("resolve_service_clinic", { p_service_id: serviceId }),
  );
}

/** /formulario/[código]: clínica do pedido de informações (F4.4a), pelo hash do código. */
export async function resolveClinicByOnboardingToken(
  tokenHash: string,
  env: ServiceEnv = platformEnv(),
): Promise<string | null> {
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) return null;
  return clinicIdOrNull(
    "pedido de informações",
    await platformClient(env).rpc("resolve_onboarding_request_clinic", { p_token_hash: tokenHash }),
  );
}

// ---------------------------------------------------------------------------
// Logins (F4.4a): convite de quem ainda não tem acesso
// ---------------------------------------------------------------------------

export class PlatformAuthError extends Error {
  constructor(what: string, cause: unknown) {
    super(`Falha no login da plataforma (${what})`, { cause });
    this.name = "PlatformAuthError";
  }
}

/** Login já existente com este e-mail (null = ainda não tem). */
export async function findUserIdByEmail(email: string, env: ServiceEnv = platformEnv()): Promise<string | null> {
  const { data, error } = await platformClient(env).rpc("find_user_id_by_email", { p_email: email });
  if (error) throw new PlatformAuthError("busca por e-mail", error);
  return data ?? null;
}

/**
 * Link para criar a senha (o e-mail é nosso, não do Supabase): convite para
 * quem ainda não tem login (cria o login) ou, para quem foi convidado e não
 * criou a senha, um novo link pelo mesmo caminho da recuperação.
 */
export async function createPasswordLink(
  email: string,
  kind: "invite" | "resend",
  env: ServiceEnv = platformEnv(),
): Promise<{ userId: string; tokenHash: string; type: "invite" | "recovery" }> {
  const type = kind === "invite" ? "invite" : "recovery";
  const { data, error } = await platformClient(env).auth.admin.generateLink({ type, email });
  if (error || !data.user) throw new PlatformAuthError(kind === "invite" ? "convite" : "novo link do convite", error);
  return { userId: data.user.id, tokenHash: data.properties.hashed_token, type };
}

// ---------------------------------------------------------------------------
// Erros e saúde do sistema (F9.3): gravados e lidos só pela plataforma
// ---------------------------------------------------------------------------

/** Destino do logError (src/lib/log.ts): o registro já vem sem dados pessoais. */
export async function recordSystemError(record: ErrorRecord, env: ServiceEnv = platformEnv()): Promise<void> {
  const { error } = await platformClient(env)
    .from("system_errors")
    .insert({ scope: record.scope, clinic_id: record.clinicId, ids: record.ids, message: record.message });
  if (error) throw new PlatformLookupError("gravar o erro", error);
}

/** Fim de uma execução da rotina do agendador (cronRoute e conversas paradas). */
export async function recordCronHeartbeat(
  job: string,
  { clinics, errors }: { clinics: number; errors: number },
  now: Date = new Date(),
  env: ServiceEnv = platformEnv(),
): Promise<void> {
  const { error } = await platformClient(env)
    .from("cron_heartbeats")
    .upsert({ job, last_finished_at: now.toISOString(), clinics, errors });
  if (error) throw new PlatformLookupError("registrar a execução da rotina", error);
}

/** Para a /api/saude: o banco responde e a última execução de cada rotina. */
export async function loadCronHeartbeats(env: ServiceEnv = platformEnv()): Promise<{ job: string; lastFinishedAt: Date }[]> {
  const { data, error } = await platformClient(env).from("cron_heartbeats").select("job, last_finished_at");
  if (error) throw new PlatformLookupError("execuções das rotinas", error);
  return data.map((row) => ({ job: row.job, lastFinishedAt: new Date(row.last_finished_at) }));
}

/** Para a /api/saude/erros: quantos erros desde `since`. */
export async function countSystemErrorsSince(since: Date, env: ServiceEnv = platformEnv()): Promise<number> {
  const { count, error } = await platformClient(env)
    .from("system_errors")
    .select("id", { count: "exact", head: true })
    .gte("occurred_at", since.toISOString());
  if (error) throw new PlatformLookupError("erros recentes", error);
  return count ?? 0;
}
