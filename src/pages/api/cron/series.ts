import { cronRoute } from "../../../lib/cron/route";
import { extendOpenSeries } from "../../../lib/data/agenda/series";

// Séries sem fim (F7, pendência da F4.6): uma vez por dia, marca as sessões
// que entraram no horizonte de 3 meses. Também na clínica em implantação (F8.2b).
const route = cronRoute("series", ({ clinicId, db, now }) => extendOpenSeries(db, clinicId, now), { inService: true });

export const POST = route;
export const GET = route;
