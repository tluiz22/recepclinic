import type { APIRoute } from "astro";
import { createClinicServiceClient } from "../../../../lib/data/clinicService";
import { bookedSummary, loadHold } from "../../../../lib/data/portal/booking";
import { readSession } from "../../../../lib/data/portal/identity";
import { loadPortal } from "../../../../lib/data/portal/portal";
import { professionalOf } from "../../../../lib/data/portal/page";
import { resolveClinicByPortalSlug } from "../../../../lib/data/platform";
import { buildIcs, icsTitle } from "../../../../lib/portalBooking";

// P10 "Adicionar à agenda do celular" (F2c; I4): o .ics da consulta marcada nesta sessão ("Consulta com {médico} —
// {Clínica}" e o endereço; sem especialidade, convênio ou outro dado de saúde). Sem extensão no caminho: o endereço do
// portal só passa páginas sem extensão (portalRewrite); o nome do arquivo vai no cabeçalho.
export const GET: APIRoute = async ({ params, url, cookies }) => {
  const notFound = () => new Response("Não encontrado", { status: 404, headers: { "Cache-Control": "no-store" } });
  const clinicId = await resolveClinicByPortalSlug((params.clinica ?? "").toLowerCase());
  if (!clinicId) return notFound();
  const db = createClinicServiceClient(clinicId);
  const portal = await loadPortal(db, clinicId, (params.clinica ?? "").toLowerCase());
  if (portal.status !== "open") return notFound();
  const professional = professionalOf(portal, params.profissional);
  const session = await readSession(db, clinicId, cookies);
  const hold = professional && session ? await loadHold(db, clinicId, session.id, url.searchParams.get("reserva") ?? "") : null;
  if (!professional || !hold?.appointmentId || hold.agendaId !== professional.agendaId) return notFound();
  const booked = await bookedSummary(db, clinicId, hold.appointmentId);
  if (!booked || booked.status === "canceled") return notFound();
  const location = professional.locations.find((l) => l.id === booked.locationId);
  const ics = buildIcs({
    uid: booked.appointmentId,
    start: booked.start,
    end: booked.end,
    title: icsTitle(professional.name, portal.brand.name),
    location: location ? [location.name, location.address].filter(Boolean).join(", ") : null,
  });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="consulta.ics"',
      "Cache-Control": "no-store",
    },
  });
};
