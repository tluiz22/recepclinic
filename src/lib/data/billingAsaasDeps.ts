import { asaasBillingApi } from "../asaas/billingApi";
import { todayIn } from "../clinicTime";
import { platformEnv } from "../env";
import { logError } from "../log";
import { syncContractWithAsaas, type SyncResult } from "./billingAsaas";
import { platformBillingStore } from "./platform";

// Liga a sincronização com o Asaas (F12.4) às variáveis do ambiente: a conta
// do RecepClinic (ASAAS_API_KEY e ASAAS_BASE_URL) e a service role. Data de
// Brasília (decisão 11.13). Falha vai também para Sistema › Erros.
export async function syncContractNow(contractId: string): Promise<SyncResult> {
  const env = platformEnv();
  const result = await syncContractWithAsaas(platformBillingStore(env), env.asaas ? asaasBillingApi(env.asaas) : null, contractId, todayIn("America/Sao_Paulo"));
  if (result.status === "failed") logError("faturamento: Asaas", new Error(result.reason), { contrato: contractId });
  return result;
}
