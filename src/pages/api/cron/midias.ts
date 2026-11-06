import { cronRoute } from "../../../lib/cron/route";
import { hasFeature } from "../../../lib/data/features";
import { processPendingMedia } from "../../../lib/data/whatsapp/media";

// Central de atendimento (CN5): a cada minuto, baixa da Meta os anexos que os pacientes enviaram e guarda no bucket
// privado (foto, áudio e documento); vídeo e arquivo acima do limite ficam só com o aviso. Só nas clínicas com a Central.
const route = cronRoute("midias", async ({ clinicId, db, now }) => {
  if (!(await hasFeature(db, clinicId, "central_attendance"))) return { skipped: "sem a Central" };
  return processPendingMedia(db, clinicId, { now });
});

export const POST = route;
export const GET = route;
