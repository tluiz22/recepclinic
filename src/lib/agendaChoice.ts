import type { AstroCookies } from "astro";
import { isUuid } from "./clinicAccess";

// Qual agenda a Agenda mostra (F4.5; cliente, 05/out/2026): por padrão todas
// as que a pessoa vê, cada atendimento com o nome da agenda, e um seletor
// para ver só uma. A escolha fica lembrada neste navegador, por clínica.

const COOKIE = "rc_agenda";
export const ALL_AGENDAS = "todas";

type Choice = { clinicId: string; agendaId: string };

function readCookie(cookies: AstroCookies): Choice[] {
  try {
    const parsed = JSON.parse(cookies.get(COOKIE)?.value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((c) => typeof c?.clinicId === "string" && typeof c?.agendaId === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Agenda escolhida: a do endereço (`?agenda=`), senão a lembrada, senão
 * todas. Agenda que a pessoa não vê (ou desativada) vira "todas". Escolher
 * pelo endereço grava a escolha.
 */
export function resolveAgendaChoice(
  url: URL,
  cookies: AstroCookies,
  clinicId: string,
  selectable: { id: string }[],
): string | null {
  const fromUrl = url.searchParams.get("agenda");
  const stored = readCookie(cookies).find((c) => c.clinicId === clinicId)?.agendaId ?? null;
  const wanted = fromUrl ?? stored;
  const agendaId = wanted && isUuid(wanted) && selectable.some((a) => a.id === wanted) ? wanted : null;
  if (fromUrl !== null) {
    const others = readCookie(cookies).filter((c) => c.clinicId !== clinicId);
    cookies.set(COOKIE, JSON.stringify([...others, { clinicId, agendaId: agendaId ?? ALL_AGENDAS }].slice(-10)), {
      path: "/admin",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 365 * 24 * 60 * 60,
    });
  }
  return agendaId;
}
