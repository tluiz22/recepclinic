import { cronRoute } from "../../../lib/cron/route";
import { hasFeature } from "../../../lib/data/features";
import { processPendingMedia, purgeDeletedMedia } from "../../../lib/data/whatsapp/media";

// Central de atendimento (CN5): a cada minuto, baixa da Meta os anexos que os pacientes enviaram e guarda no bucket
// privado (foto, áudio e documento); vídeo e arquivo acima do limite ficam só com o aviso. Só nas clínicas com a Central.
// CN7: antes, remove do bucket os arquivos dos anexos apagados (prazo de guarda ou anonimização), em todas as clínicas
// (a Central pode ter sido desligada depois de guardar).
const route = cronRoute("midias", async ({ clinicId, db, now }) => {
  const purged = await purgeDeletedMedia(db, clinicId);
  if (!(await hasFeature(db, clinicId, "central_attendance"))) return { purged, skipped: "sem a Central" };
  return { purged, ...(await processPendingMedia(db, clinicId, { now })) };
});

export const POST = route;
export const GET = route;
