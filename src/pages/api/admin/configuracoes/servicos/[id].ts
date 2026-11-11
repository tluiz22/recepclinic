import type { APIRoute } from "astro";
import { createUserClient } from "../../../../../lib/data/clients";
import {
  createService,
  getService,
  parseOwner,
  setServiceActive,
  setServiceLocations,
  updateService,
  type SchedulingMode,
  type ServiceCategory,
} from "../../../../../lib/data/config/services";
import { listLocations } from "../../../../../lib/data/config/locations";
import { deactivateServiceWindowsOutside, deactivateWindowsWithService, reactivateWindowsWithService } from "../../../../../lib/data/config/availability";
import { receivedPreparationFile, setPreparationFile, type PreparationFile } from "../../../../../lib/data/config/preparationFile";
import { runFormAction } from "../../../../../lib/data/formAction";
import { listInsurancePlans } from "../../../../../lib/data/config/insurance";
import { listServicePlans, setServiceCoverage } from "../../../../../lib/data/config/serviceInsurance";
import { allFilterOn, withAllFilter } from "../../../../../lib/returnPath";
import { formAll, formChecked, formInt, formMoneyCents, formOptionalInt, formOptionalMoneyCents, formText } from "../../../../../lib/forms";

// Serviço (F4.3, D4c): criar (`novo`), salvar (dados e locais com preço
// próprio), desativar e reativar. A categoria e o profissional (MS, 07/nov/2026)
// não mudam depois de criado; os campos de outra categoria são ignorados.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  let id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinicId = locals.clinic!.clinicId;
  const db = createUserClient(request, cookies);
  // Cadastro aberto da lista em "Todos": volta com o filtro (teste da R9, NAV-06).
  const all = allFilterOn(new URL(request.url));
  const page = () => withAllFilter(`/admin/configuracoes/servicos/${id}`, all);
  const acao = formText(form, "acao");

  return runFormAction(
    context,
    async () => {
      if (acao === "convenios") {
        // Particular e convênios do exame (CE-2, cliente, 10/nov/2026), como os do profissional: os planos ativos
        // marcados e a observação de cada um; a ligação a planos desativados fica.
        const [active, current] = await Promise.all([listInsurancePlans(db, clinicId), listServicePlans(db, clinicId, id)]);
        const activeIds = new Set(active.map((p) => p.id));
        const marked = formAll(form, "plan_id").filter((pid) => activeIds.has(pid));
        const acceptsPrivate = form?.get("accepts_private") === "1";
        await setServiceCoverage(db, clinicId, id, {
          acceptsPrivate,
          plans: marked.map((pid) => ({ planId: pid, note: formText(form, `note_${pid}`) || null })),
          keepPlanIds: current.map((p) => p.planId).filter((pid) => !activeIds.has(pid)),
        });
        const message = !marked.length ? "Salvo: só particular." : acceptsPrivate ? "Salvo: particular e convênios." : "Salvo: só convênios.";
        return { redirectTo: page(), message };
      }
      if (acao === "desativar" || acao === "reativar") {
        // Os horários só deste serviço saem e voltam com ele (cliente, 08/nov/2026).
        const plural = (n: number) => (n === 1 ? "1 horário" : `${n} horários`);
        if (acao === "desativar") {
          const off = await deactivateWindowsWithService(db, clinicId, id);
          await setServiceActive(db, clinicId, id, false);
          return { redirectTo: page(), message: `Serviço desativado.${off ? ` ${off === 1 ? "1 horário dele também foi desativado" : `${plural(off)} dele também foram desativados`}.` : ""}` };
        }
        await setServiceActive(db, clinicId, id, true);
        const { reactivated, blocked } = await reactivateWindowsWithService(db, clinicId, id);
        const back = reactivated ? ` ${reactivated === 1 ? "1 horário dele também foi reativado" : `${plural(reactivated)} dele também foram reativados`}.` : "";
        const stuck = blocked
          ? ` ${blocked === 1 ? "1 horário ficou desativado porque" : `${plural(blocked)} ficaram desativados porque`} outro horário ocupa o lugar: veja em Horários.`
          : "";
        return { redirectTo: page(), message: `Serviço reativado.${back}${stuck}` };
      }
      const category = (id === "novo" ? formText(form, "category") : (await getService(db, clinicId, id)).category) as ServiceCategory;
      const input = {
        name: formText(form, "name"),
        durationMinutes: formInt(form, "duration_minutes"),
        priceCents: formMoneyCents(form, "price"),
        returnDeadlineDays: category === "return_visit" ? formOptionalInt(form, "return_deadline_days") : null,
        preparationInstructions: category === "exam" ? formText(form, "preparation_instructions") || null : null,
        schedulingMode: (category === "exam" && formText(form, "scheduling_mode") === "group" ? "group" : "individual") as SchedulingMode,
      };
      const isNew = id === "novo";
      // Arquivo do preparo (C7): só no exame; o novo vem da tela já no armazenamento. C7.5: vai sem as instruções.
      const currentFile = isNew ? null : (await getService(db, clinicId, id)).preparationFile;
      let file: PreparationFile | null = category === "exam" ? currentFile : null;
      const newFile = formText(form, "preparation_file");
      if (category === "exam" && newFile) file = await receivedPreparationFile(db, clinicId, newFile);
      else if (category === "exam" && formChecked(form, "remover_arquivo")) file = null;
      // Dono (MS): o profissional ou a equipe; o banco liga à agenda dele.
      const owner = parseOwner(formText(form, "owner"));
      if (isNew) id = (await createService(db, clinicId, { ...input, category }, owner)).id;
      else await updateService(db, clinicId, id, input, owner);

      // Depois de criado, um erro aqui volta para a tela do serviço (já existe).
      if (file?.path !== currentFile?.path) await setPreparationFile(db, clinicId, id, file);
      const locations = formAll(form, "location_id").map((locationId) => ({
        locationId,
        priceCents: formChecked(form, `own_price_${locationId}`) ? formOptionalMoneyCents(form, `price_${locationId}`) : null,
      }));
      // Sem o item "Atendimento domiciliar" (D11), os locais domiciliares não
      // aparecem na tela e as ligações já gravadas ficam como estão.
      const keep = locals.clinic!.features.includes("home_visit")
        ? []
        : (await listLocations(db, clinicId, { includeInactive: true })).filter((l) => l.type === "home_visit").map((l) => l.id);
      const saved = await setServiceLocations(db, clinicId, id, locations, { keep });
      // Local tirado do serviço: os horários dele ali ficam desativados (C5; cliente, 28/out/2026).
      const off = isNew ? 0 : await deactivateServiceWindowsOutside(db, clinicId, id, saved.locations.map((l) => l.locationId));
      const offText = off ? ` ${off === 1 ? "1 horário do serviço ficou desativado" : `${off} horários do serviço ficaram desativados`} (local tirado).` : "";
      return { redirectTo: page(), message: `${isNew ? "Serviço cadastrado." : "Serviço salvo."}${offText}` };
    },
    page,
  );
};
