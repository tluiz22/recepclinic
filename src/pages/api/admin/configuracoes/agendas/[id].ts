import type { APIRoute } from "astro";
import { createUserClient } from "../../../../../lib/data/clients";
import { createAgenda, setAgendaActive, updateAgenda, type AgendaKind } from "../../../../../lib/data/config/agendas";
import { runFormAction } from "../../../../../lib/data/formAction";
import { formInt, formOptionalText, formText } from "../../../../../lib/forms";

// Agenda (F4.3, D2): criar (`novo`), salvar, desativar e reativar. O tipo e o
// profissional não mudam depois de criada (os atendimentos já feitos são dela).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinicId = locals.clinic!.clinicId;
  const db = createUserClient(request, cookies);
  const page = (target: string) => `/admin/configuracoes/agendas/${target}`;
  const acao = formText(form, "acao");

  return runFormAction(
    context,
    async () => {
      if (acao === "desativar" || acao === "reativar") {
        await setAgendaActive(db, clinicId, id, acao === "reativar");
        return { redirectTo: page(id), message: acao === "reativar" ? "Agenda reativada." : "Agenda desativada." };
      }
      const name = formText(form, "name");
      const bufferMinutes = formInt(form, "buffer_minutes");
      if (id === "novo") {
        const created = await createAgenda(db, clinicId, {
          name,
          kind: formText(form, "kind") as AgendaKind,
          professionalId: formOptionalText(form, "professional_id"),
          bufferMinutes,
        });
        return { redirectTo: page(created.id), message: "Agenda cadastrada. Agora ligue os serviços a ela em Serviços." };
      }
      await updateAgenda(db, clinicId, id, { name, bufferMinutes });
      return { redirectTo: page(id), message: "Agenda salva." };
    },
    page(id),
  );
};
