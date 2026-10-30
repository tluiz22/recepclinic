import { describe, expect, it } from "vitest";
import { parsePlatformEnv, PlatformEnvError, webhookOverride } from "./env";

const valid = {
  PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_JWT_SECRET: "j".repeat(32),
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
      supabaseJwtSecret: "j".repeat(32),
      cronSecret: "x".repeat(32),
      siteUrl: null,
      email: null,
      whatsapp: null,
      whatsappAppId: null,
      whatsappSignupConfigId: null,
      nfseSimulation: false,
      asaasPreview: false,
      webPush: null,
    });
    expect(parsePlatformEnv({ ...valid, SITE_URL: "https://app.recepclinic.com.br" }).siteUrl).toBe(
      "https://app.recepclinic.com.br",
    );
  });

  it("e-mail é opcional; com SMTP_HOST, porta e remetente são obrigatórios", () => {
    expect(parsePlatformEnv({ ...valid, SMTP_HOST: "127.0.0.1", SMTP_PORT: "54325", EMAIL_FROM: "RecepClinic <a@b.c>" }).email).toEqual({
      host: "127.0.0.1",
      port: 54325,
      user: null,
      password: null,
      from: "RecepClinic <a@b.c>",
    });
    expect(problemsOf({ ...valid, SMTP_HOST: "smtp.resend.com" })).toEqual([
      "SMTP_PORT inválida (número da porta)",
      "EMAIL_FROM não definida (remetente, ex.: RecepClinic <nao-responda@recepclinic.com.br>)",
    ]);
  });

  it("WhatsApp é opcional; com uma das duas, a outra é obrigatória (F6.1)", () => {
    expect(parsePlatformEnv({ ...valid, WHATSAPP_APP_SECRET: "segredo", WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verifica" }).whatsapp).toEqual({
      appSecret: "segredo",
      webhookVerifyToken: "verifica",
      webhookOverrideUrl: null,
    });
    expect(() => parsePlatformEnv({ ...valid, WHATSAPP_APP_SECRET: "segredo" })).toThrow(/WHATSAPP_WEBHOOK_VERIFY_TOKEN não definida/);
    expect(() => parsePlatformEnv({ ...valid, WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verifica" })).toThrow(/WHATSAPP_APP_SECRET não definida/);
  });

  it("desvio da conta: só no staging, https e com o WhatsApp ligado (F10.0a)", () => {
    const whatsapp = { WHATSAPP_APP_SECRET: "segredo", WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verifica" };
    const staging = parsePlatformEnv({ ...valid, ...whatsapp, WHATSAPP_WEBHOOK_OVERRIDE_URL: "https://teste.recepclinic.com.br/api/whatsapp/webhook" });
    expect(staging.whatsapp?.webhookOverrideUrl).toBe("https://teste.recepclinic.com.br/api/whatsapp/webhook");
    expect(webhookOverride(staging)).toEqual({ url: "https://teste.recepclinic.com.br/api/whatsapp/webhook", verifyToken: "verifica" });
    expect(webhookOverride(parsePlatformEnv({ ...valid, ...whatsapp }))).toBeNull();
    expect(webhookOverride(parsePlatformEnv(valid))).toBeNull();
    expect(problemsOf({ ...valid, ...whatsapp, WHATSAPP_WEBHOOK_OVERRIDE_URL: "http://teste.recepclinic.com.br/api/whatsapp/webhook" })).toEqual([
      "WHATSAPP_WEBHOOK_OVERRIDE_URL não é um endereço https: http://teste.recepclinic.com.br/api/whatsapp/webhook",
    ]);
    expect(problemsOf({ ...valid, WHATSAPP_WEBHOOK_OVERRIDE_URL: "https://teste.recepclinic.com.br/api/whatsapp/webhook" })).toEqual([
      "WHATSAPP_WEBHOOK_OVERRIDE_URL sem o WhatsApp ligado (WHATSAPP_APP_SECRET e WHATSAPP_WEBHOOK_VERIFY_TOKEN)",
    ]);
  });

  it("ID do app na Meta: opcional, só números (F11.5)", () => {
    expect(parsePlatformEnv(valid).whatsappAppId).toBeNull();
    expect(parsePlatformEnv({ ...valid, WHATSAPP_APP_ID: "1234567890" }).whatsappAppId).toBe("1234567890");
    expect(() => parsePlatformEnv({ ...valid, WHATSAPP_APP_ID: "app-x" })).toThrow(/WHATSAPP_APP_ID inválida/);
  });

  it("ID da configuração do Embedded Signup: opcional, só números (F8.1)", () => {
    expect(parsePlatformEnv(valid).whatsappSignupConfigId).toBeNull();
    expect(parsePlatformEnv({ ...valid, WHATSAPP_ES_CONFIG_ID: "987654321012" }).whatsappSignupConfigId).toBe("987654321012");
    expect(() => parsePlatformEnv({ ...valid, WHATSAPP_ES_CONFIG_ID: "config" })).toThrow(/WHATSAPP_ES_CONFIG_ID inválida/);
  });

  it("simulação da nota fiscal: só com NFSE_SIMULATION=1 (F11.4b)", () => {
    expect(parsePlatformEnv(valid).nfseSimulation).toBe(false);
    expect(parsePlatformEnv({ ...valid, NFSE_SIMULATION: "0" }).nfseSimulation).toBe(false);
    expect(parsePlatformEnv({ ...valid, NFSE_SIMULATION: "1" }).nfseSimulation).toBe(true);
    expect(() => parsePlatformEnv({ ...valid, NFSE_SIMULATION: "sim" })).toThrow(/NFSE_SIMULATION inválida/);
  });

  it("cartão do Asaas na Nota fiscal: só com ASAAS_PREVIEW=1 (N0)", () => {
    expect(parsePlatformEnv(valid).asaasPreview).toBe(false);
    expect(parsePlatformEnv({ ...valid, ASAAS_PREVIEW: "0" }).asaasPreview).toBe(false);
    expect(parsePlatformEnv({ ...valid, ASAAS_PREVIEW: "1" }).asaasPreview).toBe(true);
    expect(() => parsePlatformEnv({ ...valid, ASAAS_PREVIEW: "sim" })).toThrow(/ASAAS_PREVIEW inválida/);
  });

  it("notificações: opcionais; com uma das chaves, a outra é obrigatória (F8.5c)", () => {
    expect(parsePlatformEnv({ ...valid, WEB_PUSH_PUBLIC_KEY: "pub", WEB_PUSH_PRIVATE_KEY: "priv" }).webPush).toEqual({ publicKey: "pub", privateKey: "priv" });
    expect(() => parsePlatformEnv({ ...valid, WEB_PUSH_PUBLIC_KEY: "pub" })).toThrow(/WEB_PUSH_PRIVATE_KEY não definida/);
    expect(() => parsePlatformEnv({ ...valid, WEB_PUSH_PRIVATE_KEY: "priv" })).toThrow(/WEB_PUSH_PUBLIC_KEY não definida/);
  });

  it("tira espaços das pontas", () => {
    expect(parsePlatformEnv({ ...valid, PUBLIC_SUPABASE_ANON_KEY: "  anon-key \n" }).supabaseAnonKey).toBe("anon-key");
  });

  it("lista todas as que faltam de uma vez", () => {
    expect(problemsOf({})).toEqual([
      "PUBLIC_SUPABASE_URL não definida",
      "PUBLIC_SUPABASE_ANON_KEY não definida",
      "SUPABASE_SERVICE_ROLE_KEY não definida",
      "SUPABASE_JWT_SECRET não definida",
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

  it("SUPABASE_JWT_SECRET precisa de 32 caracteres ou mais", () => {
    expect(problemsOf({ ...valid, SUPABASE_JWT_SECRET: "curto" })).toEqual([
      "SUPABASE_JWT_SECRET curta demais (mínimo 32 caracteres)",
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
