/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
  readonly CRON_SECRET: string;
  readonly SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    // Preenchido pelo middleware em /admin e /api/admin (login ativo).
    userId?: string;
    // Perfil do login ativo (Fase 14) — sem perfil cadastrado = "secretaria".
    role?: "secretaria" | "medica";
  }
}
