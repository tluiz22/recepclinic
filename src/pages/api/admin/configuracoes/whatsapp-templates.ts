import type { APIRoute } from "astro";
import { createClinicServiceClient } from "../../../../lib/data/clinicService";
import { createDefaultTemplates, refreshTemplateStatuses, type TemplateSyncLine } from "../../../../lib/data/whatsapp/templateSync";
import { setFlash } from "../../../../lib/flash";
import { formText } from "../../../../lib/forms";

// Suporte, templates padrão na conta da clínica (F6.2): "Criar na Meta" e
// "Atualizar situação". Usa a credencial da clínica porque só ela lê o token.

const STATUS_TEXT = { pending: "em análise", approved: "aprovado", rejected: "recusado", disabled: "desativado" } as const;

const describe = (line: TemplateSyncLine) => `${line.name}: ${line.problem ?? (line.status ? STATUS_TEXT[line.status] : "?")}`;

export const POST: APIRoute = async ({ request, cookies, locals, redirect }) => {
  const clinic = locals.clinic!;
  const back = "/admin/configuracoes/whatsapp";
  if (!clinic.isPlatformStaff) {
    setFlash(cookies, { tone: "error", text: "Você não tem permissão para isso." });
    return redirect(back, 303);
  }
  const form = await request.formData().catch(() => null);
  const db = createClinicServiceClient(clinic.clinicId);
  const create = formText(form, "acao") === "criar";
  const result = create ? await createDefaultTemplates(db, clinic.clinicId) : await refreshTemplateStatuses(db, clinic.clinicId);
  if (!result.ok) {
    setFlash(cookies, { tone: "error", text: result.message });
    return redirect(back, 303);
  }
  const problems = result.lines.filter((line) => line.problem);
  const head = create ? "Templates enviados à Meta" : "Situação atualizada";
  const text = result.lines.length ? `${head}. ${result.lines.map(describe).join(" · ")}.` : "Nenhum template cadastrado ainda: use \"Criar na Meta\".";
  setFlash(cookies, { tone: problems.length ? "error" : "success", text });
  return redirect(back, 303);
};
