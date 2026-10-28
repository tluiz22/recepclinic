import type { APIRoute } from "astro";
import { receivedReturn, withReturn } from "../../../../../../lib/returnPath";
import { createUserClient } from "../../../../../../lib/data/clients";
import { DataError } from "../../../../../../lib/data/errors";
import { describeDataError, runFormAction } from "../../../../../../lib/data/formAction";
import { confirmDocumentUpload, deleteDocument, prepareDocumentUpload, type DocumentInput } from "../../../../../../lib/data/patientDocuments";
import { setFlash } from "../../../../../../lib/flash";
import { formText } from "../../../../../../lib/forms";
import { logError } from "../../../../../../lib/log";

// Documentos do paciente (CRM P1). "Anexar" é chamado por código (JSON) em
// dois passos: "preparar" confere o pedido e devolve o link de envio de uso
// único; o aparelho manda o arquivo direto ao armazenamento; "confirmar" grava
// o documento. "Apagar" é formulário (com confirmação na tela). O banco e o
// armazenamento conferem o papel (Administrador e Recepção, Q19).
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const clinic = locals.clinic!;
  const patientId = params.id!;
  const db = createUserClient(request, cookies);
  const page = withReturn(`/admin/pacientes/${patientId}`, receivedReturn(new URL(request.url)));

  if (request.headers.get("content-type")?.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as (Partial<DocumentInput> & { acao?: string; documentId?: string }) | null;
    const input: DocumentInput = {
      kind: String(body?.kind ?? ""),
      description: body?.description ? String(body.description) : null,
      fileName: String(body?.fileName ?? ""),
      mimeType: String(body?.mimeType ?? ""),
      sizeBytes: Number(body?.sizeBytes) || 0,
    };
    try {
      if (body?.acao === "preparar") {
        const { documentId, uploadUrl } = await prepareDocumentUpload(db, clinic.clinicId, patientId, input);
        return json(200, { documentId, uploadUrl });
      }
      if (body?.acao === "confirmar") {
        await confirmDocumentUpload(db, clinic.clinicId, patientId, { ...input, documentId: String(body.documentId ?? "") });
        setFlash(cookies, { tone: "success", text: "Documento anexado." });
        return json(200, { redirectTo: page });
      }
      return json(400, { error: "Ação desconhecida." });
    } catch (error) {
      if (error instanceof DataError) return json(error.code === "forbidden" ? 403 : 400, { error: describeDataError(error), fields: error.fields });
      logError("documentos: anexar", error, { clinica: clinic.clinicId });
      return json(500, { error: "Não anexamos por uma falha do sistema, já registrada para o suporte. Tente de novo em instantes." });
    }
  }

  const form = await request.formData().catch(() => null);
  return runFormAction(
    context,
    async () => {
      if (formText(form, "acao") !== "apagar") throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      const { fileRemoved } = await deleteDocument(db, clinic.clinicId, patientId, formText(form, "documento"));
      if (!fileRemoved) logError("documentos: arquivo não saiu ao apagar", undefined, { clinica: clinic.clinicId, paciente: patientId });
      return { redirectTo: page, message: "Documento apagado." };
    },
    page,
  );
};
