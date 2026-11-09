import { formatInstant } from "./clinicTime";

// Origem do atendimento, só no atendimento aberto da Agenda (R2; F2c): "Portal · {lugar}, marcada pelo paciente em
// {data} às {hora}", "WhatsApp · bot" ou "Recepção · {nome}".

const PLACES: Record<string, string> = { instagram: "Instagram", site: "site", google: "Google", message: "mensagem", poster: "cartaz", other: "outro lugar" };
const ENTRIES: Record<string, string> = { whatsapp: "WhatsApp", clinic_link: "link da clínica", professional_link: "link do profissional" };

export function bookingOriginText(
  a: { bookingChannel: string; portalEntry?: string | null; portalPlace?: string | null; createdAt?: Date; imported?: boolean },
  timeZone: string,
  actorName: string | null,
): string | null {
  if (a.imported) return "Importado da agenda anterior";
  if (a.bookingChannel === "portal") {
    const where = (a.portalPlace && PLACES[a.portalPlace]) || (a.portalEntry && ENTRIES[a.portalEntry]) || null;
    const when = a.createdAt ? `, marcada pelo paciente em ${formatInstant(a.createdAt, timeZone, "dd/MM 'às' HH:mm")}` : ", marcada pelo paciente";
    return `Portal${where ? ` · ${where}` : ""}${when}`;
  }
  if (a.bookingChannel === "whatsapp_bot") return "WhatsApp · bot";
  if (a.bookingChannel === "admin") return actorName ? `Recepção · ${actorName}` : "Recepção";
  return null;
}
