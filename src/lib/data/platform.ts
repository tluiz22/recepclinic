import { createClient } from "@supabase/supabase-js";
import { isUuid } from "../clinicAccess";
import { platformEnv, type PlatformEnv } from "../env";
import type { Database } from "../supabase/database.types";
import type { DbClient } from "./clients";

// Único ponto do código novo com a service role (D1, F3.3), que ignora o RLS.
// O cliente não sai deste arquivo: só funções estreitas da plataforma.
//
// Nas portas públicas ela só descobre de qual clínica é a requisição; o resto
// segue com createClinicServiceClient(clinicId). Rotinas administrativas da
// plataforma (ex.: criar uma clínica) entram aqui quando existirem.

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
