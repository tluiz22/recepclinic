import { asaasClient, query, seg, toReais, type AsaasList, type AsaasTarget, type Fetcher } from "./http";

// Conta principal do RecepClinic no Asaas, lado da nota fiscal (N1): cria a
// subconta de cada emissor (clínica ou profissional com CNPJ, seção 14),
// lê a situação dela e repõe o saldo que paga a tarifa das notas (decisão de
// 30/out: reposição automática). A chave da subconta só vem na criação
// (`accessToken.apiKey`): quem chama guarda no Vault na hora.

/** Eventos de nota fiscal que o webhook da subconta recebe. */
export const INVOICE_WEBHOOK_EVENTS = [
  "INVOICE_CREATED",
  "INVOICE_UPDATED",
  "INVOICE_SYNCHRONIZED",
  "INVOICE_AUTHORIZED",
  "INVOICE_PROCESSING_CANCELLATION",
  "INVOICE_CANCELED",
  "INVOICE_CANCELLATION_DENIED",
  "INVOICE_ERROR",
] as const;

export type AsaasCompanyType = "MEI" | "LIMITED" | "INDIVIDUAL" | "ASSOCIATION";

export type NewSubaccount = {
  name: string;
  email: string;
  cpfCnpj: string;
  companyType: AsaasCompanyType;
  mobilePhone: string;
  /** Faturamento mensal declarado, em centavos (exigido pelo Asaas). */
  incomeCents: number;
  address: { postalCode: string; street: string; number: string; complement: string | null; district: string };
  /** Webhook das notas: endereço público e o token próprio desta subconta (32+ caracteres). */
  webhook: { url: string; authToken: string; email: string } | null;
};

export type CreatedSubaccount = { id: string; walletId: string; apiKey: string };

export type AsaasTransfer = { id: string; status: string; valueCents: number };

type RawAccount = { id: string; walletId: string; cpfCnpj?: string; accessToken?: { apiKey?: string } | null; apiKey?: string };

export type AsaasAccountsApi = ReturnType<typeof asaasAccountsApi>;

export function asaasAccountsApi(main: AsaasTarget, fetcher: Fetcher = fetch) {
  const http = asaasClient(main, fetcher);

  return {
    async createSubaccount(input: NewSubaccount): Promise<CreatedSubaccount> {
      const created = await http.post<RawAccount>("/accounts", {
        name: input.name,
        email: input.email,
        cpfCnpj: input.cpfCnpj,
        companyType: input.companyType,
        mobilePhone: input.mobilePhone,
        incomeValue: toReais(input.incomeCents),
        postalCode: input.address.postalCode,
        address: input.address.street,
        addressNumber: input.address.number,
        ...(input.address.complement ? { complement: input.address.complement } : {}),
        province: input.address.district,
        ...(input.webhook
          ? {
              webhooks: [
                {
                  name: "RecepClinic notas fiscais",
                  url: input.webhook.url,
                  email: input.webhook.email,
                  enabled: true,
                  interrupted: false,
                  authToken: input.webhook.authToken,
                  sendType: "SEQUENTIALLY",
                  events: [...INVOICE_WEBHOOK_EVENTS],
                },
              ],
            }
          : {}),
      });
      const apiKey = created.accessToken?.apiKey ?? created.apiKey;
      if (!apiKey) throw new Error("O Asaas criou a subconta sem devolver a chave da API");
      return { id: created.id, walletId: created.walletId, apiKey };
    },

    /** Subconta já criada para o CNPJ (sem a chave, que o Asaas não devolve de novo). */
    async findSubaccount(cpfCnpj: string): Promise<{ id: string; walletId: string } | null> {
      const list = await http.get<AsaasList<RawAccount>>(`/accounts?${query({ cpfCnpj })}`);
      const found = list.data[0];
      return found ? { id: found.id, walletId: found.walletId } : null;
    },

    /** Transfere da principal para a subconta, na hora e sem tarifa. */
    async transferToWallet(walletId: string, valueCents: number, externalReference: string): Promise<AsaasTransfer> {
      const created = await http.post<{ id: string; status: string; value: number }>("/transfers", {
        value: toReais(valueCents),
        walletId,
        externalReference,
      });
      return { id: created.id, status: created.status, valueCents: Math.round(created.value * 100) };
    },

    async getTransfer(id: string): Promise<{ id: string; status: string }> {
      const t = await http.get<{ id: string; status: string }>(`/transfers/${seg(id)}`);
      return { id: t.id, status: t.status };
    },
  };
}
