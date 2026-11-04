import type { APIRoute } from "astro";
import { isUuid } from "../../../../lib/clinicAccess";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { deleteKnownIssue, saveKnownIssue } from "../../../../lib/data/knownIssues";
import { formText } from "../../../../lib/forms";

// Problemas conhecidos (IS5, cliente, 03/nov/2026): cadastrar, alterar e excluir. Só o Suporte (o banco confere).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const page = "/admin/sistema/problemas";
  return runFormAction(
    context,
    async () => {
      const db = createUserClient(request, cookies);
      const id = formText(form, "id");
      if (id && !isUuid(id)) throw new DataError("not_found", "Problema conhecido: não encontrado");
      switch (formText(form, "acao")) {
        case "salvar": {
          await saveKnownIssue(
            db,
            { title: formText(form, "titulo"), symptom: formText(form, "sintoma"), cause: formText(form, "causa"), solution: formText(form, "solucao"), links: formText(form, "links") },
            locals.userId!,
            id || null,
          );
          return { redirectTo: page, message: id ? "Problema conhecido salvo." : "Problema conhecido cadastrado." };
        }
        case "excluir":
          await deleteKnownIssue(db, id);
          return { redirectTo: page, message: "Problema conhecido excluído." };
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    page,
  );
};
