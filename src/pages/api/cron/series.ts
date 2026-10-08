import { cronRoute } from "../../../lib/cron/route";
import { extendOpenSeries } from "../../../lib/data/agenda/series";

// Séries sem fim (F7, pendência da F4.6): uma vez por dia, marca as sessões
// que entraram no horizonte de 3 meses.
const route = cronRoute("series", ({ clinicId, db, now }) => extendOpenSeries(db, clinicId, now));

export const POST = route;
export const GET = route;
