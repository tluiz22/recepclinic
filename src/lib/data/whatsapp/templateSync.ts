import type { DbClient } from "../clients";
import { unwrap } from "../errors";
import { getWhatsappAccessToken, getWhatsappConnection, listWhatsappTemplates, type TemplateKey, type TemplateStatus } from "./connection";
import { createTemplate, fetchTemplatesByName, GraphRequestError, type Fetcher, type MetaTemplate } from "./graph";
import { DEFAULT_TEMPLATES, rejectionReason, TEMPLATE_LANGUAGE, templateCreationPayload, templateStatusFromMeta } from "./templates";

// Templates padrão na conta da clínica (F6.2), pelo Suporte em Configurações ›
// WhatsApp, com a credencial da clínica (só ela lê o token):
// - "Criar na Meta": para cada template padrão, se a conta já tem um com o
//   nome, só guarda a situação; senão, cria (vai para a análise da Meta).
// - "Atualizar situação": pergunta à Meta a situação de cada um.
// - Webhook (`message_template_status_update`): a Meta avisa a mudança.

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
