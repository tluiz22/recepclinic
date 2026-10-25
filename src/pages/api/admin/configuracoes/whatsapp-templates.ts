import type { APIRoute } from "astro";
import { createClinicServiceClient } from "../../../../lib/data/clinicService";
import { TEMPLATE_KEYS, type TemplateKey } from "../../../../lib/data/whatsapp/connection";
import { createDefaultTemplates, refreshTemplateStatuses, deleteUnusedTemplate, namesInWaba, resendRejectedTemplate, type TemplateSyncLine } from "../../../../lib/data/whatsapp/templateSync";
import { setFlash } from "../../../../lib/flash";
import { formText } from "../../../../lib/forms";

// Suporte, templates padrão na conta da clínica (F6.2): "Criar na Meta" e
// "Atualizar situação"; F8a.1: "Reenviar à Meta" do recusado; F8a.2: "Excluir
// da Meta" o template do RecepClinic sem uso. Usa a
// credencial da clínica porque só ela lê o token. F8.2: o Administrador
// também usa o "criar" ("Enviar à Meta as que faltam", no cartão Conexão).

const STATUS_TEXT = { pending: "em análise", approved: "aprovado", rejected: "recusado", disabled: "desativado" } as const;

const describe = (line: TemplateSyncLine) => `${line.name}: ${line.problem ?? (line.status ? STATUS_TEXT[line.status] : "?")}`;

export const POST: APIRoute = async ({ request, cookies, locals, redirect }) => {
  const clinic = locals.clinic!;
  const back = "/admin/configuracoes/whatsapp";
  const form = await request.formData().catch(() => null);
  const action = formText(form, "acao");
  if (!clinic.isPlatformStaff && !(action === "criar" && clinic.roles.includes("admin"))) {
    setFlash(cookies, { tone: "error", text: "Você não tem permissão para isso." });
    return redirect(back, 303);
  }
  const db = createClinicServiceClient(clinic.clinicId);
  if (action === "reenviar") {
    const key = formText(form, "chave");
    const result = TEMPLATE_KEYS.includes(key as TemplateKey)
      ? await resendRejectedTemplate(db, clinic.clinicId, key as TemplateKey)
      : { ok: false as const, message: "Template desconhecido." };
    setFlash(
      cookies,
      result.ok
        ? { tone: "success", text: `${result.name} reenviado à Meta: está em análise. A situação chega sozinha pelo webhook.` }
        : { tone: "error", text: result.message },
    );
    return redirect(back, 303);
  }
  if (action === "excluir") {
    const result = await deleteUnusedTemplate(db, clinic.clinicId, formText(form, "nome"), namesInWaba());
    setFlash(cookies, result.ok ? { tone: "success", text: `${result.name} excluído da conta da Meta.` } : { tone: "error", text: result.message });
    return redirect(`${back}?sem-uso=1#sem-uso`, 303);
  }
  const create = action === "criar";
  const result = create ? await createDefaultTemplates(db, clinic.clinicId) : await refreshTemplateStatuses(db, clinic.clinicId);
  if (!result.ok) {
    setFlash(cookies, { tone: "error", text: result.message });
    return redirect(back, 303);
  }
  const problems = result.lines.filter((line) => line.problem);
  if (!clinic.isPlatformStaff) {
    // Administrador (F8.2): o resumo, sem a lista técnica de cada template.
    const sent = result.lines.length - problems.length;
    const text = problems.length
      ? `${sent ? `${sent} enviadas ou já na Meta; ` : ""}${problems.length} não foram enviadas (a Meta respondeu: ${problems[0].problem}). Tente de novo mais tarde; se repetir, fale com o suporte do RecepClinic.`
      : "Mensagens automáticas enviadas à Meta: a aprovação leva de minutos a algumas horas e chega sozinha.";
    setFlash(cookies, { tone: problems.length ? "error" : "success", text });
    return redirect(back, 303);
  }
  const head = create ? "Templates enviados à Meta" : "Situação atualizada";
  const text = result.lines.length ? `${head}. ${result.lines.map(describe).join(" · ")}.` : "Nenhum template cadastrado ainda: use \"Criar na Meta\".";
  setFlash(cookies, { tone: problems.length ? "error" : "success", text });
  return redirect(back, 303);
};
