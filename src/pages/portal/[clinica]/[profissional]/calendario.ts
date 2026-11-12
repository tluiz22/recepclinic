import type { APIRoute } from "astro";
import { createClinicServiceClient } from "../../../../lib/data/clinicService";
import { bookedSummary, loadHoldById } from "../../../../lib/data/portal/booking";
import { loadPortal } from "../../../../lib/data/portal/portal";
import { professionalOf } from "../../../../lib/data/portal/page";
import { resolveClinicByPortalSlug } from "../../../../lib/data/platform";
import { buildIcs, icsTitle } from "../../../../lib/portalBooking";

// P10 "Adicionar à agenda do celular" (F2c; I4): o .ics da consulta (ou do retorno, F2d) marcada nesta sessão ("Consulta com {médico} —
// {Clínica}" e o endereço; sem especialidade, convênio ou outro dado de saúde). Sem extensão no caminho: o endereço do
// portal só passa páginas sem extensão (portalRewrite); o nome do arquivo vai no cabeçalho.
// Sem a sessão (validação de 09/nov/2026): no iPhone, o Calendário baixa o arquivo sem os cookies do Safari. Vale pelo
// id da reserva (aleatório), só depois de marcada e até o fim do atendimento.
export const GET: APIRoute = async ({ params, url, request }) => {
  const notFound = () => new Response("Não encontrado", { status: 404, headers: { "Cache-Control": "no-store" } });
  const clinicId = await resolveClinicByPortalSlug((params.clinica ?? "").toLowerCase());
  if (!clinicId) return notFound();
  const db = createClinicServiceClient(clinicId);
  const portal = await loadPortal(db, clinicId, (params.clinica ?? "").toLowerCase());
  if (portal.status !== "open") return notFound();
  const professional = professionalOf(portal, params.profissional);
  const hold = professional ? await loadHoldById(db, clinicId, url.searchParams.get("reserva") ?? "") : null;
  if (!professional || !hold?.appointmentId || hold.agendaId !== professional.agendaId) return notFound();
  const booked = await bookedSummary(db, clinicId, hold.appointmentId);
  if (!booked || booked.status === "canceled" || booked.end.getTime() < Date.now()) return notFound();
  const location = professional.locations.find((l) => l.id === booked.locationId);
  const ics = buildIcs({
    uid: booked.appointmentId,
    start: booked.start,
    end: booked.end,
    title: icsTitle(professional.name, portal.brand.name, professional.exam ? "exame" : hold.returnOriginId ? "retorno" : "consulta"),
    // Em casa (F3e-1): o endereço do atendimento.
    location: location?.type === "home_visit" ? booked.homeVisitAddress : location ? [location.name, location.address].filter(Boolean).join(", ") : null,
  });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // iPhone e iPad: "inline" abre o "Adicionar ao Calendário"; nos outros, o arquivo baixa e abre na agenda.
      "Content-Disposition": `${/iPhone|iPad|iPod/.test(request.headers.get("user-agent") ?? "") ? "inline" : "attachment"}; filename="${professional.exam ? "exame" : hold.returnOriginId ? "retorno" : "consulta"}.ics"`,
      "Cache-Control": "no-store",
    },
  });
};
