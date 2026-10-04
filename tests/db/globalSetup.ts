import { execFileSync } from "node:child_process";

// Lê as URLs e chaves do Supabase local (`supabase status -o env`) uma vez
// e repassa aos testes por variáveis de ambiente.
export default function setup() {
  let output: string;
  try {
    output = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    throw new Error("Supabase local não está rodando. Rode `npm run db:start` antes de `npm run test:db`.");
  }

  for (const line of output.split("\n")) {
    const match = line.match(/^([A-Z_]+)="(.*)"$/);
    if (match) process.env[`SUPABASE_LOCAL_${match[1]}`] = match[2];
  }

  for (const key of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY", "JWT_SECRET", "DB_URL"]) {
    if (!process.env[`SUPABASE_LOCAL_${key}`]) throw new Error(`supabase status sem ${key}`);
  }
}
