import { createHmac, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

export async function createClinic(name: string): Promise<string> {
  const { data, error } = await adminClient().from("clinics").insert({ name }).select("id").single();
  if (error) throw error;
  return data.id as string;
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
