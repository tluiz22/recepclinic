import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AstroCookies } from "astro";
import { platformEnv } from "../env";
import type { Database } from "../supabase/database.types";

// Clientes do código novo, tipados com o schema (F3.1). O código herdado do
// piloto continua com src/lib/supabase/* até cada domínio passar para cá.

export type DbClient = SupabaseClient<Database>;

/** Cliente com o login de quem está usando o painel: o RLS decide o que ele vê. */
export function createUserClient(request: Request, cookies: AstroCookies): DbClient {
  const env = platformEnv();
  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get("Cookie") ?? "").map(({ name, value }) => ({
          name,
          value: value ?? "",
        }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => cookies.set(name, value, options));
      },
    },
  });
}
