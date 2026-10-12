import type { APIRoute } from "astro";
import { isUuid } from "../../../../../lib/clinicAccess";
import { createUserClient } from "../../../../../lib/data/clients";
import { invoiceXmlUrl } from "../../../../../lib/data/nfse";
import { invoicePdf } from "../../../../../lib/data/nfseDelivery";
import { setFlash } from "../../../../../lib/flash";
import { logError } from "../../../../../lib/log";

// Arquivos da nota fiscal, só para quem lê o financeiro da clínica (RLS da
// nota e do Storage): `?formato=pdf` (F11.5) gera o DANFSe do XML guardado
// (com "CANCELADA" se for o caso); sem formato, o XML por link temporário (2
// minutos) do bucket privado (F11.4).
export const GET: APIRoute = async ({ request, cookies, locals, params, redirect, url }) => {
  const id = params.id!;
  const db = createUserClient(request, cookies);
  try {
    if (!isUuid(id)) throw new Error("id");
    if (url.searchParams.get("formato") === "pdf") {
      const pdf = await invoicePdf(db, locals.clinic!.clinicId, id);
      return new Response(new Uint8Array(pdf.bytes), {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdf.filename}"`, "Cache-Control": "no-store" },
      });
    }
    return redirect(await invoiceXmlUrl(db, locals.clinic!.clinicId, id), 302);
  } catch (error) {
    if (!(error instanceof Error && error.message === "id")) logError("nota fiscal: arquivo", error, { clinica: locals.clinic!.clinicId, nota: id });
    setFlash(cookies, { tone: "error", text: "Arquivo da nota não encontrado." });
    return redirect("/admin/financeiro", 303);
  }
};
