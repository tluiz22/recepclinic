import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { isUuid } from "../clinicAccess";
import { platformEnv, type PlatformEnv } from "../env";
import type { Database } from "../supabase/database.types";
import type { DbClient } from "./clients";

// Credencial limitada à clínica (D1, F3.3): bot, agendador e páginas públicas
// falam com o banco como o papel `clinic_service`, e o RLS só deixa ver a
// clínica do token. Substitui a service role nesses caminhos.
//
// Assinatura HS256 com o segredo compartilhado do projeto (SUPABASE_JWT_SECRET).
// Local funciona assim; na nuvem, conferir ao criar o projeto (as chaves de
// assinatura novas aceitam um segredo compartilhado importado ou uma chave
// ES256 própria). Trocar o esquema mexe só nesta função.

/** Validade do token: cobre uma requisição ou uma rotina; cada uso cria outro. */
export const CLINIC_TOKEN_TTL_SECONDS = 15 * 60;

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

export function mintClinicServiceToken(
  clinicId: string,
  secret: string,
  { now = Date.now(), ttlSeconds = CLINIC_TOKEN_TTL_SECONDS }: { now?: number; ttlSeconds?: number } = {},
): string {
  if (!isUuid(clinicId)) throw new RangeError(`Clínica inválida: ${clinicId}`);
  if (!secret) throw new RangeError("Segredo de assinatura vazio");
  const iat = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iss: "recepclinic", role: "clinic_service", clinic_id: clinicId.toLowerCase(), iat, exp: iat + ttlSeconds }),
  );
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

type ClientEnv = Pick<PlatformEnv, "supabaseUrl" | "supabaseAnonKey" | "supabaseJwtSecret">;

/** Cliente do banco que só enxerga a clínica `clinicId`. */
export function createClinicServiceClient(clinicId: string, env: ClientEnv = platformEnv()): DbClient {
  const token = mintClinicServiceToken(clinicId, env.supabaseJwtSecret);
  return createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
