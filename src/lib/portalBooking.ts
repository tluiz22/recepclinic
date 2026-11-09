import { formatAge } from "./age";
import { isCalendarDate } from "./clinicTime";

// Regras puras da marcação pelo portal (F2c; especificação P8b, P9 e P10): nome, data de nascimento, a data por
// extenso com a idade e o arquivo da agenda do celular (.ics).

/** Mais velho que isto, o portal pede para conferir o ano (P8b: "até 110 anos"). */
export const MAX_AGE_YEARS = 110;
export const NAME_MAX = 120;

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Nome e sobrenome (duas palavras com letras), sem espaços sobrando; null = não serve. */
export function cleanFullName(raw: string | null | undefined): string | null {
  const name = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!name || name.length > NAME_MAX) return null;
  const words = name.split(" ").filter((w) => /\p{L}/u.test(w));
  return words.length >= 2 ? name : null;
}

export type BirthdateProblem = "format" | "invalid" | "future" | "too_old";

export const BIRTHDATE_MESSAGES: Record<BirthdateProblem, string> = {
  format: "Escreva o dia, o mês e o ano com 4 números, como 14/03/2019.",
  invalid: "Esta data não existe. Confira o dia e o mês.",
  future: "A data de nascimento não pode ser depois de hoje.",
  too_old: `Confira o ano: a data passa de ${MAX_AGE_YEARS} anos.`,
};

/**
 * "14/03/2019" (ou "14032019", ou "2019-03-14" do campo de data) → "2019-03-14". Ano com 4 números, data que existe,
 * não futura, até 110 anos (`today` no fuso da clínica).
 */
export function parseBirthdate(raw: string | null | undefined, today: string): { ok: true; date: string } | { ok: false; problem: BirthdateProblem } {
  const text = (raw ?? "").trim();
  let match = /^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{4})$/.exec(text) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(text);
  let iso: string | null = null;
  if (match) iso = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  else if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text))) iso = text;
  if (!iso) return { ok: false, problem: "format" };
  if (!isCalendarDate(iso)) return { ok: false, problem: "invalid" };
  if (iso > today) return { ok: false, problem: "future" };
  const [y, m, d] = today.split("-");
  if (iso < `${Number(y) - MAX_AGE_YEARS}-${m}-${d}`) return { ok: false, problem: "too_old" };
  return { ok: true, date: iso };
}

/** "14/03/2019". */
export const shortDate = (iso: string) => iso.split("-").reverse().join("/");

/** "14 de março de 2019, 7 anos" (abaixo do campo e na revisão). */
export function birthdateText(iso: string, today: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} de ${MONTHS[m - 1]} de ${y}, ${formatAge(iso, today)}`;
}

/** "Consulta com Dra. Ana Lima — Clínica Exemplo" (I4: com o médico; sem especialidade nem convênio). */
export const icsTitle = (professional: string, clinic: string, kind: "consulta" | "retorno" | "exame" = "consulta") =>
  kind === "exame" ? `Exame ${professional} — ${clinic}` : `${kind === "retorno" ? "Retorno" : "Consulta"} com ${professional} — ${clinic}`;

const icsText = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Linhas de até 75 bytes (RFC 5545): as seguintes começam com um espaço. */
function fold(line: string): string {
  const bytes = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    if (bytes.encode(current + char).length > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = char;
    } else current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** Arquivo .ics de um atendimento (P10 "Adicionar à agenda do celular"). */
export function buildIcs(event: { uid: string; start: Date; end: Date; title: string; location: string | null; now?: Date }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RecepClinic//Portal//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}@recepclinic.com.br`,
    `DTSTAMP:${icsStamp(event.now ?? new Date())}`,
    `DTSTART:${icsStamp(event.start)}`,
    `DTEND:${icsStamp(event.end)}`,
    `SUMMARY:${icsText(event.title)}`,
    ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(event.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export type BlockText =
  | { kind: "age"; limit: number }
  | { kind: "already"; when: string }
  | { kind: "limit"; reason: "future_appointments" | "new_patients" | "no_shows"; current: number }
  | { kind: "blocked_contact" };

/** O aviso do que impede marcar (P8 e P9), sem revelar as regras de limite além do número de consultas (P9). */
export function blockMessage(block: BlockText, professionalName: string, patientName: string | null, kind: "consulta" | "exame" = "consulta"): string {
  switch (block.kind) {
    case "age":
      return `${professionalName} atende pacientes até ${block.limit - 1} anos.`;
    case "already":
      // Exame (F2d): o mesmo exame já marcado (como o bot).
      if (kind === "exame") return `${patientName ?? "Este paciente"} já tem o exame ${professionalName} marcado ${block.when}. Para mudar o dia ou o horário, fale com a recepção.`;
      return `${patientName ?? "Este paciente"} já tem consulta com ${professionalName} ${block.when}. Para mudar o dia ou o horário, fale com a recepção.`;
    case "limit":
      if (block.reason === "future_appointments") return `Este número já tem ${block.current} ${block.current === 1 ? "consulta marcada" : "consultas marcadas"}. Fale com a recepção.`;
      return "Para este agendamento, fale com a recepção.";
    case "blocked_contact":
      return "Para este agendamento, fale com a recepção.";
  }
}
