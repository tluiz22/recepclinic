// Troca o e-mail de um login num ambiente na nuvem (ex.: e-mail digitado
// errado no criar-suporte.mjs). A senha continua a mesma.
//
// Uso (na raiz do projeto):
//   node --env-file=.env.staging scripts/trocar-email.mjs <e-mail atual> <e-mail novo>

import { createClient } from "@supabase/supabase-js";

const [current, next] = process.argv.slice(2).map((value) => value?.trim().toLowerCase());
const { PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;

if (!current || !next) {
  console.error("Uso: node --env-file=.env.staging scripts/trocar-email.mjs <e-mail atual> <e-mail novo>");
  process.exit(1);
}
if (!url || !key) {
  console.error("Faltam PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no arquivo de variáveis.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUser(address) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === address);
    if (found || data.users.length < 200) return found ?? null;
  }
}

const user = await findUser(current);
if (!user) {
  console.error(`Não há login com o e-mail ${current}.`);
  process.exit(1);
}
if (await findUser(next)) {
  console.error(`Já existe um login com o e-mail ${next}.`);
  process.exit(1);
}

const { error } = await db.auth.admin.updateUserById(user.id, { email: next, email_confirm: true });
if (error) throw error;
console.log(`E-mail trocado: ${current} → ${next}. A senha continua a mesma.`);
