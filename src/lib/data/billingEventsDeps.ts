import { asaasBillingApi } from "../asaas/billingApi";
import { platformEnv } from "../env";
import { platformBillingEventStore } from "./platform";

// Fila do webhook do Asaas e conciliação (F12.5) com as variáveis do ambiente.
export function billingEventDeps() {
  const env = platformEnv();
  return { store: platformBillingEventStore(env), api: env.asaas ? asaasBillingApi(env.asaas) : null, webhookToken: env.asaas?.webhookToken ?? null };
}
