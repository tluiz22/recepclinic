/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
  readonly SUPABASE_JWT_SECRET: string;
  readonly CRON_SECRET: string;
  readonly SITE_URL?: string;
  readonly SMTP_HOST?: string;
  readonly SMTP_PORT?: string;
  readonly SMTP_USER?: string;
  readonly SMTP_PASSWORD?: string;
  readonly EMAIL_FROM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    // Preenchido pelo middleware em /admin e /api/admin (login ativo).
    userId?: string;
    // Clínica ativa, papéis e agendas do login (F3.2), preenchido pelo
    // middleware em /admin e /api/admin.
    clinic?: import("./lib/clinicAccess").ClinicContext;
  }
}
