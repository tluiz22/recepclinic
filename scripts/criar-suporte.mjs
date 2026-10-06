// Cria (ou reaproveita) um login do Suporte RecepClinic num ambiente na nuvem
// (F5.5: staging sem dados fictícios; cliente, 06/out/2026) e imprime o link
// para definir a senha — não depende de e-mail.
//
// Uso (na raiz do projeto, com o arquivo de variáveis do ambiente):
//   node --env-file=.env.staging scripts/criar-suporte.mjs voce@exemplo.com "Seu nome"
//
// Precisa de PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e SITE_URL. O link
// vale pelo tempo do "Esqueci minha senha" do Supabase (1 hora, padrão).

import { createClient } from "@supabase/supabase-js";

const [email, displayName] = process.argv.slice(2);
const { PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, SITE_URL: site } = process.env;

if (!email || !displayName) {
  console.error('Uso: node --env-file=.env.staging scripts/criar-suporte.mjs <e-mail> "<nome>"');
  process.exit(1);
}
if (!url || !key || !site) {
  console.error("Faltam PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou SITE_URL no arquivo de variáveis.");
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(url)) {
  console.error("Este script é para a nuvem. No ambiente local o Suporte já vem nos dados de teste.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUser(address) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === address.toLowerCase());
    if (found || data.users.length < 200) return found ?? null;
  }
}

let user = await findUser(email);
if (!user) {
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  user = data.user;
  console.log(`Login criado: ${email}`);
} else {
  console.log(`Login já existia: ${email}`);
}

const { error: staffError } = await db
  .from("platform_staff")
  .upsert({ user_id: user.id, display_name: displayName }, { onConflict: "user_id" });
if (staffError) throw staffError;
console.log(`Suporte RecepClinic: ${displayName}`);

const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: "recovery", email });
if (linkError) throw linkError;
const base = site.replace(/\/$/, "");
console.log("\nAbra este link para definir a senha (vale 1 hora):");
console.log(`${base}/api/admin/auth/confirmar?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=recovery`);
