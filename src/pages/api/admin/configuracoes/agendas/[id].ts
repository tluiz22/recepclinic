import type { APIRoute } from "astro";
import { createUserClient } from "../../../../../lib/data/clients";
import { createAgenda, setAgendaActive, updateAgenda, type AgendaKind } from "../../../../../lib/data/config/agendas";
import { runFormAction } from "../../../../../lib/data/formAction";
import { allFilterOn, withAllFilter } from "../../../../../lib/returnPath";
import { formInt, formOptionalText, formText } from "../../../../../lib/forms";
import { setupOrigin, setupParam, withParams } from "../../../../../lib/setupFlow";

// Agenda (F4.3, D2): criar (`novo`), salvar, desativar e reativar. O tipo e o
// profissional não mudam depois de criada (os atendimentos já feitos são dela).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinicId = locals.clinic!.clinicId;
  const db = createUserClient(request, cookies);
  // Cadastro aberto da lista em "Todos": volta com o filtro (teste da R9, NAV-06).
  const url = new URL(request.url);
  const all = allFilterOn(url);
  // Aberto pelo próximo passo de outro cadastro (jornada revista, cliente
  // 21/out/2026): a origem segue junto (com o profissional já escolhido);
  // vindo do serviço, volta para ele.
  const origin = setupOrigin(url, ["servico", "local", "profissional"]);
  const flow = { servico: setupParam(url, "servico"), local: setupParam(url, "local"), profissional: setupParam(url, "profissional") };
  const page = (target: string) => withParams(withAllFilter(`/admin/configuracoes/agendas/${target}`, all), flow);
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
        if (origin?.kind === "servico") {
          return { redirectTo: withParams(`/admin/configuracoes/servicos/${origin.id}`, { marcar_agenda: created.id }), message: "Agenda cadastrada e já marcada abaixo. Salve o serviço." };
        }
        return { redirectTo: page(created.id), message: "Agenda cadastrada." };
      }
      await updateAgenda(db, clinicId, id, { name, bufferMinutes });
      return { redirectTo: page(id), message: "Agenda salva." };
    },
    page(id),
  );
};
