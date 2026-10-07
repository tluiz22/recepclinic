// Liga o agendador do Supabase (pg_cron) ao sistema (F6.3, L34): grava no
// cofre (Vault) o endereço do sistema e o CRON_SECRET, que as rotinas usam
// para chamar /api/cron/… . Sem isso, as rotinas não saem (nada acontece).
//
// Uso (na raiz do projeto, com o arquivo de variáveis do ambiente):
//   node --env-file=.env.staging scripts/agendador.mjs
//
// Precisa de PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL e
// CRON_SECRET (o mesmo da Vercel). Rodar de novo ao trocar o endereço ou o
// segredo.

import { createClient } from "@supabase/supabase-js";

const { PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, SITE_URL: site, CRON_SECRET: secret } = process.env;

if (!url || !key || !site || !secret) {
  console.error("Faltam PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL ou CRON_SECRET no arquivo de variáveis.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { error } = await db.rpc("set_scheduler_settings", { p_base_url: site, p_cron_secret: secret });
if (error) {
  console.error("Não gravou:", error.message);
  process.exit(1);
}
console.log(`Agendador ligado: as rotinas chamam ${site.replace(/\/$/, "")}/api/cron/… a cada minuto.`);
