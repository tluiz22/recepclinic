// Variáveis de ambiente da plataforma (L39), validadas de uma vez na primeira
// requisição: faltando alguma, o erro aparece logo e lista todas, em vez de
// estourar só quando a função que a usa rodar.
//
// Só entram aqui as variáveis da plataforma. O que é de cada clínica (número
// e token do WhatsApp, templates) fica no banco (D3). Do app RecepClinic na
// Meta (F6.1), só o que é da plataforma: o App Secret, que assina o webhook,
// e o token de verificação do cadastro do webhook.

export type PlatformEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Só para rotinas da plataforma (D1); bot, agendador e páginas públicas usam a credencial limitada. */
  supabaseServiceRoleKey: string;
  /** Segredo que assina a credencial limitada à clínica (clinic_service, F3.3). */
  supabaseJwtSecret: string;
  /** Segredo que a Vercel manda nas rotinas agendadas (Authorization: Bearer). */
  cronSecret: string;
  /** Endereço público do sistema; sem ele, vale o `site` do astro.config.mjs. */
  siteUrl: string | null;
  /** Envio de e-mail próprio por SMTP (F4.4a); null = sem envio (o painel avisa). */
  email: EmailEnv | null;
  /** App RecepClinic na Meta (F6.1); null = webhook desligado (recusa os eventos). */
  whatsapp: WhatsappAppEnv | null;
};

export type WhatsappAppEnv = { appSecret: string; webhookVerifyToken: string };

export type EmailEnv = { host: string; port: number; user: string | null; password: string | null; from: string };

export const CRON_SECRET_MIN_LENGTH = 32;
export const JWT_SECRET_MIN_LENGTH = 32;

export class PlatformEnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Variáveis de ambiente com problema:\n- ${problems.join("\n- ")}`);
    this.name = "PlatformEnvError";
  }
}

type EnvSource = Record<string, string | boolean | undefined>;

function text(source: EnvSource, name: string): string | null {
  const value = source[name];
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function parsePlatformEnv(source: EnvSource): PlatformEnv {
  const problems: string[] = [];

  const required = (name: string): string => {
    const value = text(source, name);
    if (!value) problems.push(`${name} não definida`);
    return value ?? "";
  };
  const url = (name: string, value: string | null): void => {
    if (value && !isHttpUrl(value)) problems.push(`${name} não é um endereço http(s): ${value}`);
  };

  const supabaseUrl = required("PUBLIC_SUPABASE_URL");
  url("PUBLIC_SUPABASE_URL", supabaseUrl);
  const supabaseAnonKey = required("PUBLIC_SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseJwtSecret = required("SUPABASE_JWT_SECRET");
  if (supabaseJwtSecret && supabaseJwtSecret.length < JWT_SECRET_MIN_LENGTH) {
    problems.push(`SUPABASE_JWT_SECRET curta demais (mínimo ${JWT_SECRET_MIN_LENGTH} caracteres)`);
  }
  const cronSecret = required("CRON_SECRET");
  if (cronSecret && cronSecret.length < CRON_SECRET_MIN_LENGTH) {
    problems.push(`CRON_SECRET curta demais (mínimo ${CRON_SECRET_MIN_LENGTH} caracteres)`);
  }
  const siteUrl = text(source, "SITE_URL");
  url("SITE_URL", siteUrl);

  // E-mail: opcional; com SMTP_HOST, o remetente e a porta passam a ser obrigatórios.
  let email: EmailEnv | null = null;
  const smtpHost = text(source, "SMTP_HOST");
  if (smtpHost) {
    const port = Number(text(source, "SMTP_PORT") ?? "");
    if (!Number.isInteger(port) || port <= 0) problems.push("SMTP_PORT inválida (número da porta)");
    const from = text(source, "EMAIL_FROM");
    if (!from) problems.push("EMAIL_FROM não definida (remetente, ex.: RecepClinic <nao-responda@recepclinic.com.br>)");
    email = { host: smtpHost, port, user: text(source, "SMTP_USER"), password: text(source, "SMTP_PASSWORD"), from: from ?? "" };
  }

  // WhatsApp: opcional; uma sem a outra é configuração pela metade.
  let whatsapp: WhatsappAppEnv | null = null;
  const appSecret = text(source, "WHATSAPP_APP_SECRET");
  const webhookVerifyToken = text(source, "WHATSAPP_WEBHOOK_VERIFY_TOKEN");
  if (appSecret || webhookVerifyToken) {
    if (!appSecret) problems.push("WHATSAPP_APP_SECRET não definida (App Secret do app RecepClinic na Meta)");
    if (!webhookVerifyToken) problems.push("WHATSAPP_WEBHOOK_VERIFY_TOKEN não definida (token de verificação do webhook)");
    if (appSecret && webhookVerifyToken) whatsapp = { appSecret, webhookVerifyToken };
  }

  if (problems.length) throw new PlatformEnvError(problems);
  return { supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey, supabaseJwtSecret, cronSecret, siteUrl, email, whatsapp };
}

let cached: PlatformEnv | undefined;

/** Variáveis da plataforma já validadas (lidas uma vez por instância do servidor). */
export function platformEnv(): PlatformEnv {
  // Cada variável escrita por extenso: o Vite só troca `import.meta.env.X` literal.
  cached ??= parsePlatformEnv({
    PUBLIC_SUPABASE_URL: import.meta.env.PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_ANON_KEY: import.meta.env.PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_JWT_SECRET: import.meta.env.SUPABASE_JWT_SECRET,
    CRON_SECRET: import.meta.env.CRON_SECRET,
    SITE_URL: import.meta.env.SITE_URL,
    SMTP_HOST: import.meta.env.SMTP_HOST,
    SMTP_PORT: import.meta.env.SMTP_PORT,
    SMTP_USER: import.meta.env.SMTP_USER,
    SMTP_PASSWORD: import.meta.env.SMTP_PASSWORD,
    EMAIL_FROM: import.meta.env.EMAIL_FROM,
    WHATSAPP_APP_SECRET: import.meta.env.WHATSAPP_APP_SECRET,
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: import.meta.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  });
  return cached;
}
