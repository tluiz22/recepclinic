import type { APIRoute } from "astro";
import { createUserClient } from "../../../../../../lib/data/clients";
import { DataError } from "../../../../../../lib/data/errors";
import { documentLink } from "../../../../../../lib/data/patientDocuments";
import { logError } from "../../../../../../lib/log";

// Abrir ou baixar um documento do paciente (CRM P1): link de 2 minutos do
// armazenamento privado. `?modo=baixar` baixa com o nome do arquivo; `?formato=json`
// devolve o link, para o "Baixar selecionados" e o "Compartilhar" da tela.
export const GET: APIRoute = async ({ request, cookies, locals, params, redirect, url }) => {
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  const mode = url.searchParams.get("modo") === "baixar" ? "download" : "open";
  try {
    const link = await documentLink(db, clinic.clinicId, params.id!, params.documento!, mode);
    if (url.searchParams.get("formato") === "json") return new Response(JSON.stringify({ url: link }), { headers: { "Content-Type": "application/json" } });
    return redirect(link, 303);
  } catch (error) {
    if (!(error instanceof DataError)) logError("documentos: abrir", error, { clinica: clinic.clinicId });
    return new Response("Documento não encontrado.", { status: 404 });
  }
};
