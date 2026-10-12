import type { APIRoute } from "astro";
import { todayIn } from "../../../../lib/clinicTime";
import { createUserClient } from "../../../../lib/data/clients";
import { generateDmed, saveDmedSettings } from "../../../../lib/data/dmed";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { formInt, formOptionalText, formText } from "../../../../lib/forms";

// Financeiro › DMED (F11.6): salvar os responsáveis e baixar o arquivo do
// ano. Só o Administrador da clínica (conferido aqui e de novo no banco). O
// arquivo sai em ISO-8859-1, com quebra de linha do Windows, como os
// programas da Receita leem.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  const year = formInt(form, "ano");
  const page = `/admin/financeiro/dmed${Number.isInteger(year) ? `?ano=${year}` : ""}`;
  const acao = formText(form, "acao");

  if (acao === "gerar" && clinic.roles.includes("admin")) {
    try {
      const file = await generateDmed(db, clinic.clinicId, year, Number(todayIn(clinic.timezone).slice(0, 4)));
      return new Response(toLatin1(file.content), {
        headers: {
          "Content-Type": "text/plain; charset=iso-8859-1",
          "Content-Disposition": `attachment; filename="${file.fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      return runFormAction(context, () => Promise.reject(error), page);
    }
  }

  return runFormAction(
    context,
    async () => {
      if (!clinic.roles.includes("admin")) throw new DataError("forbidden", "DMED: só o Administrador da clínica");
      if (acao !== "salvar") throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      await saveDmedSettings(db, clinic.clinicId, {
        fillerCpf: formText(form, "filler_cpf"),
        fillerName: formText(form, "filler_name"),
        fillerDdd: formText(form, "filler_ddd"),
        fillerPhone: formText(form, "filler_phone"),
        fillerExtension: formOptionalText(form, "filler_extension"),
        fillerEmail: formOptionalText(form, "filler_email"),
        legalResponsibleCpf: formText(form, "legal_responsible_cpf"),
        cnes: formOptionalText(form, "cnes"),
      });
      return { redirectTo: page, message: "Responsáveis da DMED salvos." };
    },
    page,
  );
};

/** Texto em ISO-8859-1: o que não existe nessa tabela vira "?". */
function toLatin1(text: string): Uint8Array<ArrayBuffer> {
  const normalized = text.normalize("NFC");
  const bytes = new Uint8Array(normalized.length);
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    bytes[i] = code <= 0xff ? code : 0x3f;
  }
  return bytes;
}
