import type { DbClient } from "../clients";
import { createClinicServiceClient } from "../clinicService";
import { resolveClinicsByWabaId } from "../platform";
import { unwrap } from "../errors";
import { getWhatsappAccessToken, getWhatsappConnection, listWhatsappTemplates, type TemplateKey, type TemplateStatus } from "./connection";
import { createTemplate, deleteTemplate, editTemplate, fetchAllTemplates, fetchTemplatesByName, GraphRequestError, type Fetcher, type MetaTemplate } from "./graph";
import { DEFAULT_TEMPLATES, defaultTemplate, rejectionReason, TEMPLATE_LANGUAGE, templateCreationPayload, templateEditPayload, templateStatusFromMeta } from "./templates";

// Templates padrão na conta da clínica (F6.2), pelo Suporte em Configurações ›
// WhatsApp, com a credencial da clínica (só ela lê o token):
// - "Criar na Meta": para cada template padrão, se a conta já tem um com o
//   nome, só guarda a situação; senão, cria (vai para a análise da Meta).
// - "Atualizar situação": pergunta à Meta a situação de cada um.
// - Webhook (`message_template_status_update`): a Meta avisa a mudança.
// - "Reenviar à Meta" (F8a.1): o padrão recusado é editado com o texto atual
//   do código, com o mesmo nome, e volta para a análise.
// - "Excluir da Meta" (F8a.2): templates do RecepClinic (`rc_`) da conta que
//   nenhuma clínica dela usa.

export type TemplateSyncLine = { key: TemplateKey; name: string; status: TemplateStatus | null; problem: string | null };

export type TemplateSyncResult = { ok: true; lines: TemplateSyncLine[] } | { ok: false; message: string };

async function saveTemplateRow(
  db: DbClient,
  clinicId: string,
  key: TemplateKey,
  name: string,
  meta: { id: string; status: string; rejectedReason: string | null },
): Promise<TemplateStatus> {
  const status = templateStatusFromMeta(meta.status);
  unwrap(
    await db.from("whatsapp_templates").upsert(
      {
        clinic_id: clinicId,
        template_key: key,
        name,
        language: TEMPLATE_LANGUAGE,
        status,
        meta_template_id: meta.id || null,
        rejection_reason: status === "rejected" ? rejectionReason(meta.rejectedReason) : null,
        version: 1,
      },
      { onConflict: "clinic_id,template_key,version" },
    ),
    "Template do WhatsApp",
  );
  return status;
}

/** Situação de uma versão personalizada (F6.6). */
async function saveVersionStatus(db: DbClient, clinicId: string, id: string, meta: { id: string; status: string; rejectedReason: string | null }): Promise<TemplateStatus> {
  const status = templateStatusFromMeta(meta.status);
  unwrap(
    await db
      .from("whatsapp_templates")
      .update({ status, meta_template_id: meta.id || null, rejection_reason: status === "rejected" ? rejectionReason(meta.rejectedReason) : null })
      .eq("clinic_id", clinicId)
      .eq("id", id),
    "Template do WhatsApp",
  );
  return status;
}

async function setup(db: DbClient, clinicId: string): Promise<{ wabaId: string; token: string } | { message: string }> {
  const connection = await getWhatsappConnection(db, clinicId);
  if (!connection) return { message: "Cadastre a conexão antes dos templates." };
  const token = await getWhatsappAccessToken(db);
  if (!token) return { message: "Grave o token da Meta antes dos templates." };
  return { wabaId: connection.wabaId, token };
}

const inLanguage = (templates: MetaTemplate[]) => templates.find((t) => t.language === TEMPLATE_LANGUAGE) ?? null;

/** Já existe conteúdo nesse idioma: a Meta criou o template antes (resposta perdida, clique duplo). */
const ALREADY_EXISTS = 2388024;

/** Cria; se a Meta disser que já existe, lê a situação dele (achado na validação da F7). */
async function createOrFind(wabaId: string, template: (typeof DEFAULT_TEMPLATES)[number], token: string, fetcher: Fetcher): Promise<MetaTemplate> {
  try {
    const created = await createTemplate(wabaId, templateCreationPayload(template), token, fetcher);
    return { ...created, name: template.name, language: TEMPLATE_LANGUAGE, rejectedReason: null };
  } catch (error) {
    if (!(error instanceof GraphRequestError) || error.graph.subcode !== ALREADY_EXISTS) throw error;
    const found = inLanguage(await fetchTemplatesByName(wabaId, template.name, token, fetcher));
    if (!found) throw error;
    return found;
  }
}

/** "Criar na Meta": cria os templates padrão que a conta ainda não tem. */
export async function createDefaultTemplates(db: DbClient, clinicId: string, fetcher: Fetcher = fetch): Promise<TemplateSyncResult> {
  const ready = await setup(db, clinicId);
  if ("message" in ready) return { ok: false, message: ready.message };
  const lines: TemplateSyncLine[] = [];
  for (const template of DEFAULT_TEMPLATES) {
    try {
      const existing = inLanguage(await fetchTemplatesByName(ready.wabaId, template.name, ready.token, fetcher));
      const meta = existing ?? (await createOrFind(ready.wabaId, template, ready.token, fetcher));
      const status = await saveTemplateRow(db, clinicId, template.key, template.name, meta);
      lines.push({ key: template.key, name: template.name, status, problem: null });
    } catch (error) {
      if (!(error instanceof GraphRequestError)) throw error;
      lines.push({ key: template.key, name: template.name, status: null, problem: error.graph.message });
    }
  }
  return { ok: true, lines };
}

/** "Atualizar situação": a situação de cada template da clínica na Meta. */
export async function refreshTemplateStatuses(db: DbClient, clinicId: string, fetcher: Fetcher = fetch): Promise<TemplateSyncResult> {
  const ready = await setup(db, clinicId);
  if ("message" in ready) return { ok: false, message: ready.message };
  const lines: TemplateSyncLine[] = [];
  for (const row of (await listWhatsappTemplates(db, clinicId)).filter((t) => t.stage === "meta")) {
    try {
      const meta = (await fetchTemplatesByName(ready.wabaId, row.name, ready.token, fetcher)).find((t) => t.language === row.language);
      if (!meta) {
        lines.push({ key: row.key, name: row.name, status: row.status, problem: "não existe na conta da Meta" });
        continue;
      }
      const status = row.version === 1 ? await saveTemplateRow(db, clinicId, row.key, row.name, meta) : await saveVersionStatus(db, clinicId, row.id, meta);
      lines.push({ key: row.key, name: row.name, status, problem: null });
    } catch (error) {
      if (!(error instanceof GraphRequestError)) throw error;
      lines.push({ key: row.key, name: row.name, status: row.status, problem: error.graph.message });
    }
  }
  return { ok: true, lines };
}

export type ResendResult = { ok: true; name: string } | { ok: false; message: string };

/**
 * "Reenviar à Meta" (F8a.1): edita o template padrão recusado na conta da
 * clínica com o texto atual do código (mesmo nome, sem `_v2`). Quem muda o
 * texto é o código (cliente, 12/out): ele segue um só para todas as clínicas.
 */
export async function resendRejectedTemplate(db: DbClient, clinicId: string, key: TemplateKey, fetcher: Fetcher = fetch): Promise<ResendResult> {
  const template = defaultTemplate(key);
  if (!template) return { ok: false, message: "Template desconhecido." };
  const saved = (await listWhatsappTemplates(db, clinicId)).find((t) => t.key === key && t.version === 1);
  // Nome diferente = texto novo com outro nome: o caminho é "Criar na Meta".
  if (!saved || saved.name !== template.name || saved.status !== "rejected") {
    return { ok: false, message: `${template.name} não está recusado: nada a reenviar.` };
  }
  const ready = await setup(db, clinicId);
  if ("message" in ready) return { ok: false, message: ready.message };
  try {
    const id = saved.metaTemplateId ?? inLanguage(await fetchTemplatesByName(ready.wabaId, template.name, ready.token, fetcher))?.id;
    if (!id) return { ok: false, message: `${template.name} não existe na conta da Meta: use "Criar na Meta".` };
    await editTemplate(id, templateEditPayload(template), ready.token, fetcher);
    await saveTemplateRow(db, clinicId, key, template.name, { id, status: "PENDING", rejectedReason: null });
    return { ok: true, name: template.name };
  } catch (error) {
    if (!(error instanceof GraphRequestError)) throw error;
    return { ok: false, message: `${template.name}: ${error.graph.message}` };
  }
}

/** Templates do RecepClinic na conta: os da própria clínica nunca aparecem (cliente, 12/out). */
export const RECEPCLINIC_PREFIX = "rc_";

/**
 * Nomes em uso nas clínicas da conta (WABA): uma conta pode atender várias
 * clínicas (no staging, a do RecepClinic), e cada uma lê só os próprios.
 */
export type NamesInUse = (wabaId: string) => Promise<string[]>;

/** Nomes gravados nas clínicas da conta, cada uma lida com a própria credencial. */
export function namesInWaba(env?: Parameters<typeof resolveClinicsByWabaId>[1] & Parameters<typeof createClinicServiceClient>[1]): NamesInUse {
  return async (wabaId) => {
    const clinics = await resolveClinicsByWabaId(wabaId, env);
    const lists = await Promise.all(clinics.map((id) => listWhatsappTemplates(createClinicServiceClient(id, env), id)));
    return lists.flat().map((t) => t.name);
  };
}

export type UnusedTemplatesResult = { ok: true; templates: MetaTemplate[] } | { ok: false; message: string };

/**
 * Templates `rc_` da conta da clínica que nenhuma clínica da conta usa
 * (F8a.2). Em uso: os nomes padrão atuais do código e qualquer nome gravado
 * em `whatsapp_templates` (padrão e versões personalizadas, de todas as
 * clínicas da conta).
 */
export async function listUnusedTemplates(db: DbClient, clinicId: string, namesInUse: NamesInUse, fetcher: Fetcher = fetch): Promise<UnusedTemplatesResult> {
  const ready = await setup(db, clinicId);
  if ("message" in ready) return { ok: false, message: ready.message };
  try {
    // A própria clínica conta mesmo com a conexão desligada (o resolvedor só traz as ligadas).
    const own = (await listWhatsappTemplates(db, clinicId)).map((t) => t.name);
    const used = new Set([...DEFAULT_TEMPLATES.map((t) => t.name), ...own, ...(await namesInUse(ready.wabaId))]);
    const all = await fetchAllTemplates(ready.wabaId, ready.token, fetcher);
    const unused = all.filter((t) => t.name.startsWith(RECEPCLINIC_PREFIX) && !used.has(t.name));
    return { ok: true, templates: unused.sort((a, b) => a.name.localeCompare(b.name)) };
  } catch (error) {
    if (!(error instanceof GraphRequestError)) throw error;
    return { ok: false, message: error.graph.message };
  }
}

export type DeleteResult = { ok: true; name: string } | { ok: false; message: string };

/** "Excluir da Meta" (F8a.2): só se ainda estiver na lista dos sem uso (conferido de novo na hora). */
export async function deleteUnusedTemplate(db: DbClient, clinicId: string, name: string, namesInUse: NamesInUse, fetcher: Fetcher = fetch): Promise<DeleteResult> {
  const unused = await listUnusedTemplates(db, clinicId, namesInUse, fetcher);
  if (!unused.ok) return unused;
  if (!unused.templates.some((t) => t.name === name)) return { ok: false, message: `${name} não está entre os templates sem uso: nada foi excluído.` };
  const ready = await setup(db, clinicId);
  if ("message" in ready) return { ok: false, message: ready.message };
  try {
    await deleteTemplate(ready.wabaId, name, ready.token, fetcher);
    return { ok: true, name };
  } catch (error) {
    if (!(error instanceof GraphRequestError)) throw error;
    return { ok: false, message: `${name}: ${error.graph.message}` };
  }
}

export type TemplateStatusEvent = { name: string; language: string; event: string; reason: string | null; metaTemplateId: string | null };

/** Webhook: a Meta avisou a mudança de situação de um template. true = era da clínica e mudou. */
export async function applyTemplateStatusEvent(db: DbClient, clinicId: string, event: TemplateStatusEvent): Promise<boolean> {
  const status = templateStatusFromMeta(event.event);
  const changed = unwrap(
    await db
      .from("whatsapp_templates")
      .update({
        status,
        rejection_reason: status === "rejected" ? rejectionReason(event.reason) : null,
        ...(event.metaTemplateId ? { meta_template_id: event.metaTemplateId } : {}),
      })
      .eq("clinic_id", clinicId)
      .eq("name", event.name)
      .eq("language", event.language)
      .select("id"),
    "Template do WhatsApp",
  );
  return changed.length > 0;
}
