import type { APIRoute } from "astro";
import { createUserClient } from "../../../../../lib/data/clients";
import { runFormAction } from "../../../../../lib/data/formAction";
import { publish } from "../../../../../lib/data/knowledge/admin";

// Publica a Base de Conhecimento (BC 3.3): a fotografia das entradas ativas vai
// ao bot de todas as clínicas com "Perguntas frequentes no bot" ligado. Barra
// modelo com variável sem fonte de dados.
export const POST: APIRoute = async (context) => {
  const db = createUserClient(context.request, context.cookies);
  return runFormAction(
    context,
    async () => {
      const version = await publish(db);
      return { redirectTo: "/admin/sistema/conhecimento", message: `Base publicada (versão ${version}). O bot passa a usar esta versão na próxima mensagem.` };
    },
    "/admin/sistema/conhecimento",
  );
};
