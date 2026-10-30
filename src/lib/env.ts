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
  /**
   * ID do app RecepClinic na Meta (F11.5): só para mandar o PDF de exemplo do
   * template da nota fiscal (documento no topo). null = esse template não é criado.
   */
  whatsappAppId: string | null;
  /**
   * ID da configuração do Embedded Signup (Login do Facebook para Empresas;
   * F8.1). Com ele e o WHATSAPP_APP_ID, o Administrador conecta o número pela
   * janela da Meta; null = só o cadastro manual do Suporte.
   */
  whatsappSignupConfigId: string | null;
  /**
   * Ambiente "Simulação" da nota fiscal (F11.4b): a nota sai do próprio
   * servidor, sem a Receita. Só no staging (NFSE_SIMULATION=1); fora dele o
   * Suporte não consegue ligar e a clínica que estiver nele não emite.
   */
  nfseSimulation: boolean;
  /**
   * Cartão "Emissão pelo Asaas" em Configurações › Nota fiscal (N0, formulário
   * BaaS): só onde ASAAS_PREVIEW=1 (o staging). Sem a variável, como na
   * produção, a tela não muda.
   */
  asaasPreview: boolean;
  /**
   * Notificações no celular do atendimento humano (F8.5c, Web Push): o par de
   * chaves VAPID do ambiente. null = desligadas (a tela avisa).
   */
  webPush: WebPushEnv | null;
};

export type WebPushEnv = { publicKey: string; privateKey: string };

export type WhatsappAppEnv = {
  appSecret: string;
  webhookVerifyToken: string;
  /**
   * Desvio da conta (F10.0a): só no staging, o endereço do webhook dele
   * (WHATSAPP_WEBHOOK_OVERRIDE_URL). Com ele, a inscrição de cada conta pede à
   * Meta que mande os eventos para cá, e não para o webhook principal do app
   * (o da produção). null = sem desvio (produção).
   */
  webhookOverrideUrl: string | null;
};

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
    if (appSecret && webhookVerifyToken) whatsapp = { appSecret, webhookVerifyToken, webhookOverrideUrl: null };
  }
  const webhookOverrideUrl = text(source, "WHATSAPP_WEBHOOK_OVERRIDE_URL");
  if (webhookOverrideUrl) {
    let https = false;
    try {
      https = new URL(webhookOverrideUrl).protocol === "https:";
    } catch {
      https = false;
    }
    if (!https) problems.push(`WHATSAPP_WEBHOOK_OVERRIDE_URL não é um endereço https: ${webhookOverrideUrl}`);
    if (!appSecret && !webhookVerifyToken) problems.push("WHATSAPP_WEBHOOK_OVERRIDE_URL sem o WhatsApp ligado (WHATSAPP_APP_SECRET e WHATSAPP_WEBHOOK_VERIFY_TOKEN)");
    if (whatsapp && https) whatsapp.webhookOverrideUrl = webhookOverrideUrl;
  }

  const whatsappAppId = text(source, "WHATSAPP_APP_ID");
  if (whatsappAppId && !/^\d{5,20}$/.test(whatsappAppId)) problems.push("WHATSAPP_APP_ID inválida (só os números do ID do app na Meta)");

  const whatsappSignupConfigId = text(source, "WHATSAPP_ES_CONFIG_ID");
  if (whatsappSignupConfigId && !/^\d{5,20}$/.test(whatsappSignupConfigId)) {
    problems.push("WHATSAPP_ES_CONFIG_ID inválida (só os números do ID da configuração do Login do Facebook para Empresas)");
  }

  const nfseSimulation = text(source, "NFSE_SIMULATION");
  if (nfseSimulation && nfseSimulation !== "1" && nfseSimulation !== "0") problems.push("NFSE_SIMULATION inválida (1 liga a simulação da nota fiscal; 0 ou vazia, desliga)");

  const asaasPreview = text(source, "ASAAS_PREVIEW");
  if (asaasPreview && asaasPreview !== "1" && asaasPreview !== "0") problems.push("ASAAS_PREVIEW inválida (1 mostra o cartão do Asaas na Nota fiscal; 0 ou vazia, esconde)");

  // Notificações (F8.5c): opcionais; uma chave sem a outra é configuração pela metade.
  let webPush: WebPushEnv | null = null;
  const pushPublic = text(source, "WEB_PUSH_PUBLIC_KEY");
  const pushPrivate = text(source, "WEB_PUSH_PRIVATE_KEY");
  if (pushPublic || pushPrivate) {
    if (!pushPublic) problems.push("WEB_PUSH_PUBLIC_KEY não definida (chave pública das notificações)");
    if (!pushPrivate) problems.push("WEB_PUSH_PRIVATE_KEY não definida (chave privada das notificações)");
    if (pushPublic && pushPrivate) webPush = { publicKey: pushPublic, privateKey: pushPrivate };
  }

  if (problems.length) throw new PlatformEnvError(problems);
  return { supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey, supabaseJwtSecret, cronSecret, siteUrl, email, whatsapp, whatsappAppId: whatsappAppId ?? null, whatsappSignupConfigId: whatsappSignupConfigId ?? null, nfseSimulation: nfseSimulation === "1", asaasPreview: asaasPreview === "1", webPush };
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
    WHATSAPP_WEBHOOK_OVERRIDE_URL: import.meta.env.WHATSAPP_WEBHOOK_OVERRIDE_URL,
    WHATSAPP_APP_ID: import.meta.env.WHATSAPP_APP_ID,
    WHATSAPP_ES_CONFIG_ID: import.meta.env.WHATSAPP_ES_CONFIG_ID,
    NFSE_SIMULATION: import.meta.env.NFSE_SIMULATION,
    ASAAS_PREVIEW: import.meta.env.ASAAS_PREVIEW,
    WEB_PUSH_PUBLIC_KEY: import.meta.env.WEB_PUSH_PUBLIC_KEY,
    WEB_PUSH_PRIVATE_KEY: import.meta.env.WEB_PUSH_PRIVATE_KEY,
  });
  return cached;
}

/**
 * Desvio da conta para a inscrição (F10.0a): o endereço do webhook deste
 * ambiente e o token que a Meta usa para conferi-lo. null = sem desvio.
 */
export function webhookOverride(env: PlatformEnv): { url: string; verifyToken: string } | null {
  const whatsapp = env.whatsapp;
  return whatsapp?.webhookOverrideUrl ? { url: whatsapp.webhookOverrideUrl, verifyToken: whatsapp.webhookVerifyToken } : null;
}
