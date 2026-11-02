import type { APIRoute } from "astro";
import { createUserClient } from "../../../../../../lib/data/clients";
import { migrateAgenda } from "../../../../../../lib/data/config/agendas";
import { runFormAction } from "../../../../../../lib/data/formAction";
import { formText } from "../../../../../../lib/forms";

// Migrar de agenda (cliente, 02/nov/2026): confirma e aplica a migração mostrada na prévia.
export const POST: APIRoute = async (context) => {
  const { request, cookies, params } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const to = formText(form, "para");
  // Sem nenhum serviço marcado na tela (agenda sem serviços com horário) migra tudo.
  const serviceIds = form ? form.getAll("servico").map(String) : [];
  const db = createUserClient(request, cookies);
  const back = `/admin/configuracoes/agendas/${id}/migrar?para=${encodeURIComponent(to)}`;
  return runFormAction(
    context,
    async () => {
      const r = await migrateAgenda(db, id, to, true, serviceIds.length ? serviceIds : undefined);
      const left = r.conflicts.length;
      return {
        redirectTo: `/admin/configuracoes/agendas/${id}`,
        message: `Migrado: ${r.windows} horário(s) e ${r.appointments} atendimento(s) futuro(s).${left ? ` ${left} ficou na agenda antiga por conflito de horário: remarque ou altere.` : ""}`,
      };
    },
    back,
  );
};
