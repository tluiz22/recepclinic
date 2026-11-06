import { cronRoute } from "../../../lib/cron/route";
import { hasFeature } from "../../../lib/data/features";
import { processHistoryEvents, processPendingMedia, purgeDeletedMedia } from "../../../lib/data/whatsapp/media";

// Central de atendimento (CN5): a cada minuto, baixa da Meta os anexos que os pacientes enviaram e guarda no bucket
// privado (foto, áudio e documento); vídeo e arquivo acima do limite ficam só com o aviso. Só nas clínicas com a Central.
// CN7: antes, remove do bucket os arquivos dos anexos apagados (prazo de guarda ou anonimização), em todas as clínicas
// (a Central pode ter sido desligada depois de guardar). CN8: grava o histórico do app guardado pelo webhook.
const route = cronRoute("midias", async ({ clinicId, db, now }) => {
  const purged = await purgeDeletedMedia(db, clinicId);
  if (!(await hasFeature(db, clinicId, "central_attendance"))) return { purged, skipped: "sem a Central" };
  // CN8: antes dos anexos, o histórico do app (os anexos dele entram como pendentes e já baixam nesta execução).
  const history = await processHistoryEvents(db, clinicId);
  return { purged, history, ...(await processPendingMedia(db, clinicId, { now })) };
});

export const POST = route;
export const GET = route;
