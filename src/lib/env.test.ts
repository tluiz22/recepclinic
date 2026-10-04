import { describe, expect, it } from "vitest";
import { parsePlatformEnv, PlatformEnvError } from "./env";

const valid = {
  PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  CRON_SECRET: "x".repeat(32),
};

function problemsOf(source: Record<string, string | undefined>): string[] {
  try {
    parsePlatformEnv(source);
  } catch (error) {
    if (error instanceof PlatformEnvError) return error.problems;
    throw error;
  }
  return [];
}

describe("variáveis da plataforma", () => {
  it("lê as variáveis válidas; SITE_URL é opcional", () => {
    expect(parsePlatformEnv(valid)).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      supabaseAnonKey: "anon-key",
      supabaseServiceRoleKey: "service-role-key",
      cronSecret: "x".repeat(32),
      siteUrl: null,
    });
    expect(parsePlatformEnv({ ...valid, SITE_URL: "https://app.recepclinic.com.br" }).siteUrl).toBe(
      "https://app.recepclinic.com.br",
    );
  });

  it("tira espaços das pontas", () => {
    expect(parsePlatformEnv({ ...valid, PUBLIC_SUPABASE_ANON_KEY: "  anon-key \n" }).supabaseAnonKey).toBe("anon-key");
  });

  it("lista todas as que faltam de uma vez", () => {
    expect(problemsOf({})).toEqual([
      "PUBLIC_SUPABASE_URL não definida",
      "PUBLIC_SUPABASE_ANON_KEY não definida",
      "SUPABASE_SERVICE_ROLE_KEY não definida",
      "CRON_SECRET não definida",
    ]);
  });

  it("vazia ou só com espaços conta como não definida", () => {
    expect(problemsOf({ ...valid, SUPABASE_SERVICE_ROLE_KEY: "", CRON_SECRET: "   " })).toEqual([
      "SUPABASE_SERVICE_ROLE_KEY não definida",
      "CRON_SECRET não definida",
    ]);
  });

  it("endereços precisam ser http(s)", () => {
    expect(problemsOf({ ...valid, PUBLIC_SUPABASE_URL: "127.0.0.1:54321", SITE_URL: "ftp://x" })).toEqual([
      "PUBLIC_SUPABASE_URL não é um endereço http(s): 127.0.0.1:54321",
      "SITE_URL não é um endereço http(s): ftp://x",
    ]);
  });

  it("CRON_SECRET precisa de 32 caracteres ou mais", () => {
    expect(problemsOf({ ...valid, CRON_SECRET: "curto" })).toEqual([
      "CRON_SECRET curta demais (mínimo 32 caracteres)",
    ]);
  });

  it("a mensagem do erro traz a lista, sem os valores secretos", () => {
    const error = (() => {
      try {
        parsePlatformEnv({ ...valid, CRON_SECRET: "segredo-curto", PUBLIC_SUPABASE_ANON_KEY: undefined });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error?.message).toContain("PUBLIC_SUPABASE_ANON_KEY não definida");
    expect(error?.message).not.toContain("segredo-curto");
  });
});
