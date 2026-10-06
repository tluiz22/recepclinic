import type { APIRoute } from "astro";
import { formatInstant, isCalendarDate } from "../../../../lib/clinicTime";
import { createClinicServiceClient } from "../../../../lib/data/clinicService";
import { listLinkSlots, loadBookingPage, logBookingPageStep, slotChoiceValue, slotDetails } from "../../../../lib/data/agenda/publicBooking";
import { DataError } from "../../../../lib/data/errors";
import { resolveClinicByBookingLink } from "../../../../lib/data/platform";

// Horários livres de um dia para a página /agendar (F5.2), ao trocar a data.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const GET: APIRoute = async ({ params, url }) => {
  const token = params.token ?? "";
  const date = url.searchParams.get("date") ?? "";
  if (!isCalendarDate(date)) return json({ error: "date (YYYY-MM-DD) é obrigatório" }, 400);

  const clinicId = await resolveClinicByBookingLink(token);
  if (!clinicId) return json({ error: "link inválido" }, 404);
  const db = createClinicServiceClient(clinicId);
  const page = await loadBookingPage(db, clinicId, token).catch((error) => {
    if (error instanceof DataError && error.code === "not_found") return null;
    throw error;
  });
  if (!page || page.state !== "form") return json({ error: "link inválido ou expirado" }, 404);
  if (page.service.isGroup) return json({ slots: [] });

  const slots = await listLinkSlots(db, clinicId, page, date);
  await logBookingPageStep(db, clinicId, page, "date_changed", { date, slots: slots.length });
  return json({
    slots: slots.map((slot) => ({
      value: slotChoiceValue(slot),
      time: formatInstant(slot.start, page.timeZone, "HH:mm"),
      extra: slotDetails(page.candidates, slot),
    })),
  });
};
