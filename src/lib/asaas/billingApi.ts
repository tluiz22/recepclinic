import type { AsaasEnv } from "../env";

// API do Asaas para cobrar as clínicas (F12.4, faturamento do SaaS; seção 5
// do planejamento-faturamento-saas.md). Só o que o faturamento usa: cliente,
// assinatura, cobrança avulsa e a leitura das cobranças. Valores em reais na
// API e em centavos aqui. Timeout de 60 s (recomendação do Asaas); pedido que
// falhou não é repetido às cegas: quem chama procura antes pela referência
// externa (externalReference). F12.2f: o cancelamento encerra a assinatura
// numa data (endDate, testado no sandbox em 03/nov/2026), remove assinatura e
// cobranças em aberto e estorna as pagas (arrependimento).

export type Fetcher = typeof fetch;

export class AsaasApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AsaasApiError";
  }
}

type AsaasErrorBody = { errors?: { code?: string; description?: string }[] };

async function call<T>(env: AsaasEnv, fetcher: Fetcher, method: "GET" | "POST" | "DELETE", path: string, body?: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(`${env.baseUrl}${path}`, {
      method,
      headers: { access_token: env.apiKey, "Content-Type": "application/json", "User-Agent": "RecepClinic" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new AsaasApiError(0, `Asaas fora do ar ou sem resposta (${error instanceof Error ? error.message : String(error)})`);
  }
  const text = await response.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const description = (json as AsaasErrorBody | null)?.errors?.map((e) => e.description ?? e.code).filter(Boolean).join("; ");
    throw new AsaasApiError(response.status, `Asaas recusou (${response.status}): ${description || "sem detalhe"}`);
  }
  return json as T;
}

const reais = (cents: number) => Math.round(cents) / 100;
// O Checkout exige uma imagem por item: 1 pixel na cor do RecepClinic.
const CHECKOUT_IMAGE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const cents = (value: number) => Math.round(value * 100);

export type AsaasBillingType = "PIX" | "CREDIT_CARD";

export type AsaasPayment = {
  id: string;
  subscription: string | null;
  externalReference: string | null;
  dueDate: string;
  valueCents: number;
  billingType: string;
  status: string;
  paidAt: string | null;
  invoiceUrl: string | null;
  /** Removida no Asaas (F12.2f: cancelamento). */
  deleted?: boolean;
};

type RawPayment = {
  id: string;
  subscription?: string | null;
  externalReference?: string | null;
  dueDate: string;
  value: number;
  billingType: string;
  status: string;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  confirmedDate?: string | null;
  invoiceUrl?: string | null;
  deleted?: boolean;
};

type List<T> = { data: T[]; hasMore?: boolean };

function toPayment(raw: RawPayment): AsaasPayment {
  const paid = raw.paymentDate ?? raw.confirmedDate ?? raw.clientPaymentDate ?? null;
  return {
    id: raw.id,
    subscription: raw.subscription ?? null,
    externalReference: raw.externalReference ?? null,
    dueDate: raw.dueDate,
    valueCents: cents(raw.value),
    billingType: raw.billingType,
    status: raw.status,
    // O Asaas manda só a data; meio-dia de Brasília evita virar o dia.
    paidAt: paid ? `${paid}T12:00:00-03:00` : null,
    invoiceUrl: raw.invoiceUrl ?? null,
    deleted: raw.deleted === true,
  };
}

export type AsaasBillingApi = ReturnType<typeof asaasBillingApi>;

export function asaasBillingApi(env: AsaasEnv, fetcher: Fetcher = fetch) {
  const get = <T>(path: string) => call<T>(env, fetcher, "GET", path);
  const post = <T>(path: string, body: Record<string, unknown>) => call<T>(env, fetcher, "POST", path, body);
  const del = <T>(path: string) => call<T>(env, fetcher, "DELETE", path);
  const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

  return {
    /** Cliente pelo CNPJ/CPF (o primeiro não apagado), ou null. */
    async findCustomer(cpfCnpj: string): Promise<string | null> {
      const list = await get<List<{ id: string; deleted?: boolean }>>(`/customers?${q({ cpfCnpj, limit: "10" })}`);
      return list.data.find((c) => !c.deleted)?.id ?? null;
    },

    /** Cliente novo, com os avisos do Asaas desligados (decisão 11.11: só os nossos). */
    async createCustomer(input: { name: string; cpfCnpj: string; email: string; mobilePhone: string | null; externalReference: string }): Promise<string> {
      const created = await post<{ id: string }>("/customers", {
        name: input.name,
        cpfCnpj: input.cpfCnpj,
        email: input.email,
        ...(input.mobilePhone ? { mobilePhone: input.mobilePhone } : {}),
        externalReference: input.externalReference,
        notificationDisabled: true,
      });
      return created.id;
    },

    async findSubscription(externalReference: string): Promise<string | null> {
      const list = await get<List<{ id: string; deleted?: boolean }>>(`/subscriptions?${q({ externalReference })}`);
      return list.data.find((s) => !s.deleted)?.id ?? null;
    },

    async createSubscription(input: {
      customer: string;
      billingType: AsaasBillingType;
      valueCents: number;
      nextDueDate: string;
      description: string;
      externalReference: string;
    }): Promise<string> {
      const created = await post<{ id: string }>("/subscriptions", {
        customer: input.customer,
        billingType: input.billingType,
        value: reais(input.valueCents),
        nextDueDate: input.nextDueDate,
        cycle: "MONTHLY",
        description: input.description,
        externalReference: input.externalReference,
      });
      return created.id;
    },

    async findPayment(externalReference: string): Promise<AsaasPayment | null> {
      const list = await get<List<RawPayment & { deleted?: boolean }>>(`/payments?${q({ externalReference })}`);
      const found = list.data.find((p) => !p.deleted);
      return found ? toPayment(found) : null;
    },

    async createPayment(input: {
      customer: string;
      billingType: AsaasBillingType;
      valueCents: number;
      dueDate: string;
      description: string;
      externalReference: string;
    }): Promise<AsaasPayment> {
      const created = await post<RawPayment>("/payments", {
        customer: input.customer,
        billingType: input.billingType,
        value: reais(input.valueCents),
        dueDate: input.dueDate,
        description: input.description,
        externalReference: input.externalReference,
      });
      return toPayment(created);
    },

    /** Estado real de uma cobrança (o webhook só avisa; F12.5). */
    async getPayment(id: string): Promise<AsaasPayment> {
      return toPayment(await get<RawPayment>(`/payments/${encodeURIComponent(id)}`));
    },

    /** Cobranças geradas pela assinatura (até 100, as mais novas primeiro não é garantido: o espelho ordena). */
    async listSubscriptionPayments(subscription: string): Promise<AsaasPayment[]> {
      const list = await get<List<RawPayment>>(`/subscriptions/${encodeURIComponent(subscription)}/payments?${q({ limit: "100" })}`);
      return list.data.map(toPayment);
    },

    /** Nenhuma mensalidade com vencimento depois de `endDate` (a desse dia ainda sai). */
    async endSubscriptionOn(subscription: string, endDate: string): Promise<void> {
      await post(`/subscriptions/${encodeURIComponent(subscription)}`, { endDate });
    },

    /** Remove a assinatura; o Asaas remove junto as cobranças dela em aberto. */
    async deleteSubscription(subscription: string): Promise<void> {
      await del(`/subscriptions/${encodeURIComponent(subscription)}`);
    },

    async deletePayment(id: string): Promise<void> {
      await del(`/payments/${encodeURIComponent(id)}`);
    },

    /** Estorno integral de uma cobrança paga (Pix ou cartão). */
    async refundPayment(id: string): Promise<void> {
      await post(`/payments/${encodeURIComponent(id)}/refund`, {});
    },

    /**
     * F12.2g: Checkout do Asaas para a clínica informar outro cartão. Cria uma
     * assinatura nova no cartão, com a 1ª cobrança em `nextDueDate` (nada é
     * cobrado na hora; testado no sandbox em 03/nov/2026). Devolve o link.
     */
    async createCardCheckout(input: {
      customer: string;
      valueCents: number;
      nextDueDate: string;
      itemName: string;
      description: string;
      successUrl: string;
      cancelUrl: string;
      externalReference: string;
    }): Promise<{ id: string; link: string }> {
      const created = await post<{ id: string; link: string }>("/checkouts", {
        billingTypes: ["CREDIT_CARD"],
        chargeTypes: ["RECURRENT"],
        minutesToExpire: 60,
        callback: { successUrl: input.successUrl, cancelUrl: input.cancelUrl, expiredUrl: input.cancelUrl },
        items: [{ name: input.itemName.slice(0, 30), description: input.description.slice(0, 150), quantity: 1, value: reais(input.valueCents), imageBase64: CHECKOUT_IMAGE }],
        subscription: { cycle: "MONTHLY", nextDueDate: input.nextDueDate },
        customer: input.customer,
        externalReference: input.externalReference,
      });
      return { id: created.id, link: created.link };
    },

    /** Assinaturas do cliente (não removidas), para achar a criada pelo Checkout. */
    async listCustomerSubscriptions(customer: string): Promise<{ id: string; billingType: string; nextDueDate: string; dateCreated: string }[]> {
      const list = await get<List<{ id: string; billingType: string; nextDueDate: string; dateCreated: string; deleted?: boolean; status?: string }>>(
        `/subscriptions?${q({ customer, limit: "100" })}`,
      );
      return list.data.filter((sub) => !sub.deleted && sub.status !== "INACTIVE").map(({ id, billingType, nextDueDate, dateCreated }) => ({ id, billingType, nextDueDate, dateCreated }));
    },
  };
}
