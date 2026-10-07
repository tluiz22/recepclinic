// Link de criar ou redefinir a senha de um login que já existe, num ambiente
// na nuvem, enquanto não há provedor de e-mail (staging, 07/out/2026): o
// convite que não saiu por e-mail, ou o "Esqueci minha senha". Não muda
// papéis nem clínicas.
//
// Uso (na raiz do projeto):
//   node --env-file=.env.staging scripts/link-de-senha.mjs <e-mail>
//
// O link vale 1 hora. Quem nunca entrou vê a tela de boas-vindas do convite.

import { createClient } from "@supabase/supabase-js";

const email = process.argv[2]?.trim().toLowerCase();
const { PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, SITE_URL: site } = process.env;

if (!email) {
  console.error("Uso: node --env-file=.env.staging scripts/link-de-senha.mjs <e-mail>");
  process.exit(1);
}
if (!url || !key || !site) {
  console.error("Faltam PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou SITE_URL no arquivo de variáveis.");
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

const user = await findUser(email);
if (!user) {
  console.error(`Não há login com o e-mail ${email}. Para a equipe de uma clínica, convide pela tela Equipe.`);
  process.exit(1);
}

const { data: link, error } = await db.auth.admin.generateLink({ type: "recovery", email });
if (error) throw error;
const origem = user.last_sign_in_at ? "" : "&origem=convite";
console.log(`\nLink para ${user.last_sign_in_at ? "redefinir" : "criar"} a senha de ${email} (vale 1 hora):`);
console.log(`${site.replace(/\/$/, "")}/api/admin/auth/confirmar?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=recovery${origem}`);
