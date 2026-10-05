import type { Enums } from "./supabase/database.types";

// Rótulos dos tipos de serviço (D4c) nas telas.
export const CATEGORY_LABELS: Record<Enums<"service_category">, string> = {
  consultation: "Consulta",
  return_visit: "Retorno",
  exam: "Exame",
};
