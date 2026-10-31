import type { APIRoute } from "astro";
import { createUserClient } from "../../../../../lib/data/clients";
import { runFormAction } from "../../../../../lib/data/formAction";
import { addSynonym, parseList, removeSynonym, saveEntry, setEntriesStatus, setEntryStatus } from "../../../../../lib/data/knowledge/admin";
import { formAll, formChecked, formOptionalText, formText } from "../../../../../lib/forms";
import { KB_STATUS_LABELS, type KbAnswerType, type KbFlow, type KbRequiredTerm, type KbSource, type KbStatus } from "../../../../../lib/knowledge/lists";

// Entrada da Base de Conhecimento (BC 3.3): criar, editar, mudar a situação e
// os sinônimos. Só o Suporte (o middleware confere; o RLS confere de novo).
// Nada vai ao bot até "Publicar".
const BASE = "/admin/sistema/conhecimento";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData().catch(() => null);
  const db = createUserClient(context.request, context.cookies);
  const action = formText(form, "acao");
  const code = formOptionalText(form, "codigo") ?? "";
  const back = action === "situacao_lote" ? BASE : code && action !== "criar" ? `${BASE}/${code}` : `${BASE}/nova`;
  return runFormAction(
    context,
    async () => {
      switch (action) {
        case "criar":
        case "salvar": {
          const saved = await saveEntry(
            db,
            {
              code: action === "criar" ? formText(form, "code").toUpperCase() : code,
              categoryKey: formText(form, "category"),
              question: formText(form, "question"),
              keywords: parseList(formText(form, "keywords")),
              guidance: formText(form, "guidance"),
              answerType: formText(form, "answer_type") as KbAnswerType,
              template: formOptionalText(form, "template"),
              sources: formAll(form, "sources") as KbSource[],
              flow: (formOptionalText(form, "flow") as KbFlow | null) ?? null,
              requiredTerm: (formOptionalText(form, "required_term") as KbRequiredTerm | null) ?? null,
              offersReception: formChecked(form, "offers_reception"),
            },
            action === "salvar" ? code : undefined,
          );
          return { redirectTo: `${BASE}/${saved}`, message: action === "criar" ? `Entrada ${saved} criada como rascunho.` : `Entrada ${saved} salva. Vale no bot depois de publicar.` };
        }
        case "situacao": {
          const status = formText(form, "status") as KbStatus;
          await setEntryStatus(db, code, status);
          return { redirectTo: `${BASE}/${code}`, message: `Entrada ${code}: ${KB_STATUS_LABELS[status] ?? status}. Vale no bot depois de publicar.` };
        }
        case "situacao_lote": {
          const status = formText(form, "status") as KbStatus;
          const changed = await setEntriesStatus(db, formAll(form, "codigos"), status);
          const label = (KB_STATUS_LABELS[status] ?? status).toLowerCase();
          return {
            redirectTo: BASE,
            message: changed ? `${changed} ${changed === 1 ? "entrada passou" : "entradas passaram"} para ${label}. Vale no bot depois de publicar.` : `As entradas marcadas já estavam como ${label}.`,
          };
        }
        case "sinonimo": {
          await addSynonym(db, code, formText(form, "text"));
          return { redirectTo: `${BASE}/${code}#sinonimos`, message: "Sinônimo incluído." };
        }
        case "tirar_sinonimo": {
          await removeSynonym(db, formText(form, "synonym_id"));
          return { redirectTo: `${BASE}/${code}#sinonimos`, message: "Sinônimo retirado." };
        }
        default:
          return { redirectTo: BASE, message: "Nada foi alterado." };
      }
    },
    back,
  );
};
