import type { APIRoute } from "astro";
import { createClinicServiceClient } from "../../../../lib/data/clinicService";
import { confirmBookingLink, loadBookingPage, logBookingPageStep, parseSlotChoice } from "../../../../lib/data/agenda/publicBooking";
import { resolveClinicByBookingLink } from "../../../../lib/data/platform";

// Confirma o horário escolhido em /agendar (F5.2). Toda volta com erro é uma
// tentativa que falhou, registrada no funil do bot com o motivo.
export const POST: APIRoute = async ({ params, request, redirect }) => {
  const token = params.token ?? "";
  const form = await request.formData().catch(() => null);
  const date = form?.get("date")?.toString() ?? "";
  const choice = parseSlotChoice(form?.get("start")?.toString());
  const pageUrl = `/agendar/${encodeURIComponent(token)}`;

  const clinicId = await resolveClinicByBookingLink(token);
  if (!clinicId) return redirect(pageUrl, 303);
  const db = createClinicServiceClient(clinicId);

  const back = async (error: string) => {
    const page = await loadBookingPage(db, clinicId, token).catch(() => null);
    if (page) await logBookingPageStep(db, clinicId, page, "confirm_failed", { reason: error });
    const query = new URLSearchParams({ ...(date ? { date } : {}), error });
    return redirect(`${pageUrl}?${query}`, 303);
  };

  if (!choice) return back("failed");
  const result = await confirmBookingLink(db, clinicId, token, choice);
  if (result.status === "unavailable") return redirect(pageUrl, 303);
  if (result.status !== "confirmed") return back(result.status);

  const page = await loadBookingPage(db, clinicId, token);
  await logBookingPageStep(db, clinicId, page, "confirmed", { appointment_id: result.appointmentId });
  return redirect(pageUrl, 303);
};
