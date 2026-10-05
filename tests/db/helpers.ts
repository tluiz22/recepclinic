import { createHmac, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";

const env = (key: string) => {
  const value = process.env[`SUPABASE_LOCAL_${key}`];
  if (!value) throw new Error(`SUPABASE_LOCAL_${key} ausente (globalSetup não rodou?)`);
  return value;
};

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

/** Service role: ignora o RLS. Só para montar e limpar os dados do teste. */
export function adminClient(): SupabaseClient {
  return createClient(env("API_URL"), env("SERVICE_ROLE_KEY"), clientOptions);
}

/** Sem login (chave anônima). */
export function anonClient(): SupabaseClient {
  return createClient(env("API_URL"), env("ANON_KEY"), clientOptions);
}

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

/** Cria um login de verdade no Auth local e devolve um cliente já autenticado. */
export async function createUser(label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID().slice(0, 8)}@teste.recepclinic.local`;
  const password = `senha-${randomUUID()}`;
  const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser sem usuário");

  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client };
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** Credencial limitada à clínica (D1): JWT com role `clinic_service` e `clinic_id`. */
export function clinicServiceClient(clinicId: string): SupabaseClient {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iss: "supabase", role: "clinic_service", clinic_id: clinicId, iat: now, exp: now + 3600 }),
  );
  const signature = createHmac("sha256", env("JWT_SECRET")).update(`${header}.${payload}`).digest("base64url");
  const token = `${header}.${payload}.${signature}`;
  return createClient(env("API_URL"), env("ANON_KEY"), {
    ...clientOptions,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/**
 * Clínica de teste. Por padrão com todos os itens da matriz de acesso
 * liberados (D11) e limite de 50 profissionais; `features` escolhe outros
 * itens (lista vazia = só o básico).
 */
export async function createClinic(name: string, features?: string[]): Promise<string> {
  // Limite de profissionais folgado (o padrão de clínica nova é 1, D11); os
  // testes do limite mudam o número.
  const { data, error } = await adminClient().from("clinics").insert({ name, max_professionals: 50 }).select("id").single();
  if (error) throw error;
  const id = data.id as string;
  let keys = features;
  if (!keys) {
    const { data: all, error: catalogError } = await adminClient().from("features").select("key");
    if (catalogError) throw catalogError;
    keys = all.map((row) => row.key as string);
  }
  const { error: featureError } = await adminClient().rpc("set_clinic_features", { p_clinic_id: id, p_features: keys });
  if (featureError) throw featureError;
  return id;
}

export async function addMember(clinicId: string, userId: string, roles: string[]): Promise<void> {
  const { error } = await adminClient().from("clinic_members").insert({ clinic_id: clinicId, user_id: userId, roles });
  if (error) throw error;
}

export async function makePlatformStaff(userId: string): Promise<void> {
  const { error } = await adminClient().from("platform_staff").insert({ user_id: userId });
  if (error) throw error;
}

export async function deleteClinics(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await adminClient().from("clinics").delete().in("id", ids);
  if (error) throw new Error(`Limpeza das clínicas de teste falhou: ${error.message}`);
}

export async function deleteUsers(users: TestUser[]): Promise<void> {
  for (const user of users) await adminClient().auth.admin.deleteUser(user.id);
}

/** Entra com um login dos dados de teste (supabase/seed.sql). */
export async function signInSeedUser(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: "recepclinic-local" });
  if (error) throw new Error(`Login de teste ${email} falhou (rodou npm run db:reset?): ${error.message}`);
  return client;
}

/** Conexão direta ao Postgres local, para consultar o catálogo e contar linhas. */
export async function withDatabase<T>(run: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString: env("DB_URL") });
  await db.connect();
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}
