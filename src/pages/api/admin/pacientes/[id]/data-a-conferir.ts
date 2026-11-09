import type { APIRoute } from "astro";
import { receivedReturn, withReturn } from "../../../../../lib/returnPath";
import { createUserClient } from "../../../../../lib/data/clients";
import { DataError } from "../../../../../lib/data/errors";
import { runFormAction } from "../../../../../lib/data/formAction";
import { listOpenBirthdateChecks, resolveBirthdateCheck } from "../../../../../lib/data/portalBirthdate";
import { formText } from "../../../../../lib/forms";
import { shortDate } from "../../../../../lib/portalBooking";

// Quadro "Data de nascimento a conferir" da ficha (F2c; R4): "Corrigir para {data}" ou "Manter {data}", com
// confirmação na tela. A pendência é a aberta deste paciente; o banco confere a clínica e a equipe.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const clinic = locals.clinic!;
  const patientId = params.id!;
  const form = await request.formData().catch(() => null);
  const db = createUserClient(request, cookies);
  const page = withReturn(`/admin/pacientes/${patientId}`, receivedReturn(new URL(request.url)));

  return runFormAction(
    context,
    async () => {
      const action = formText(form, "acao");
      if (action !== "corrigir" && action !== "manter") throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      const check = (await listOpenBirthdateChecks(db, clinic.clinicId, [patientId])).get(patientId);
      if (!check || check.id !== formText(form, "pendencia")) return { redirectTo: page, message: "Esta data já foi conferida." };
      await resolveBirthdateCheck(db, check.id, action === "corrigir" ? "corrected" : "kept");
      return {
        redirectTo: page,
        message: action === "corrigir" ? `Data de nascimento corrigida para ${shortDate(check.informed)}.` : `Mantida a data ${shortDate(check.registered)}.`,
      };
    },
    page,
  );
};
