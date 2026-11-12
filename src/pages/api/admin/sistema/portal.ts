import type { APIRoute } from "astro";
import { isUuid } from "../../../../lib/clinicAccess";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { releaseBlock } from "../../../../lib/data/portalBlocks";
import { formText } from "../../../../lib/forms";

// Sistema › Portal (F6, parte 3): liberar um bloqueio ativo. Só o Suporte vê a tela; o banco confere a permissão
// (`portal_release_block`) e a liberação entra no registro do Suporte.
export const POST: APIRoute = async (context) => {
  const { request, cookies } = context;
  const form = await request.formData().catch(() => null);
  const page = "/admin/sistema/portal";
  return runFormAction(
    context,
    async () => {
      const db = createUserClient(request, cookies);
      if (formText(form, "acao") !== "liberar") throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      const id = formText(form, "id");
      if (!isUuid(id)) throw new DataError("not_found", "Bloqueio: não encontrado");
      const released = await releaseBlock(db, id);
      return { redirectTo: page, message: released ? "Bloqueio liberado." : "Esse bloqueio já tinha sido liberado ou vencido." };
    },
    page,
  );
};
