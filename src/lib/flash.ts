import type { AstroCookies } from "astro";

// Aviso depois de salvar (F4.3): a rota grava num cookie de uso único e a tela
// seguinte mostra e apaga. O texto não vai na URL, então um link não consegue
// fingir um aviso do sistema.

/** `fields`: campos que falharam na validação, para a tela marcar e focar o primeiro. */
export type Flash = { tone: "success" | "error"; text: string; fields?: string[] };

const COOKIE = "rc_aviso";

/** `path`: onde o aviso vale (painel por padrão; o formulário público usa o dele). */
export function setFlash(cookies: AstroCookies, flash: Flash, path = "/admin"): void {
  cookies.set(COOKIE, Buffer.from(JSON.stringify(flash)).toString("base64url"), {
    path,
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60,
  });
}

export function takeFlash(cookies: AstroCookies, path = "/admin"): Flash | null {
  const raw = cookies.get(COOKIE)?.value;
  if (!raw) return null;
  cookies.delete(COOKIE, { path });
  try {
    const flash = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Flash>;
    if ((flash.tone === "success" || flash.tone === "error") && typeof flash.text === "string") {
      const fields = Array.isArray(flash.fields)
        ? flash.fields.filter((f): f is string => typeof f === "string" && /^[A-Za-z0-9_]{1,60}$/.test(f)).slice(0, 10)
        : [];
      return { tone: flash.tone, text: flash.text.slice(0, 500), ...(fields.length ? { fields } : {}) };
    }
  } catch {
    // Cookie estragado: sem aviso.
  }
  return null;
}

/**
 * O aviso da tela, lido uma vez só por pedido (QA-09 da R8): o FlashMessage e
 * o EditCard leem o mesmo, sem depender da ordem em que são montados.
 */
export function pageFlash(astro: { cookies: AstroCookies; locals: App.Locals }): Flash | null {
  if (astro.locals.flash === undefined) astro.locals.flash = takeFlash(astro.cookies);
  return astro.locals.flash;
}

/** Nomes do formulário para um campo da camada de dados ("payerCpf" → "payer_cpf"; "priceCents" → "price"), como no keepFormValues. */
export function formNamesFor(field: string): string[] {
  const snake = field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  return [...new Set([field, snake, snake.replace(/_cents$/, "")])];
}
