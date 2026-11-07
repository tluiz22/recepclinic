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

async function call<T>(env: AsaasEnv, fetcher: Fetcher, method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: Record<string, unknown>): Promise<T> {
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
  /** F12.2i: cartão que pagou (token do Asaas e o final), para ligá-lo à assinatura. */
  card?: { token: string | null; last4: string | null } | null;
};

type RawCard = { creditCardNumber?: string | null; creditCardToken?: string | null } | null;

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
  creditCard?: RawCard;
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
    card: raw.creditCard ? { token: raw.creditCard.creditCardToken ?? null, last4: raw.creditCard.creditCardNumber ?? null } : null,
  };
}

/**
 * Atraso (contrato, seção 3; cliente, 07/nov/2026): multa de 2% e juros de 1% ao mês, que o Asaas soma
 * no pagamento depois do vencimento (proporcional aos dias).
 */
export const LATE_PAYMENT = { fine: { value: 2, type: "PERCENTAGE" }, interest: { value: 1 } } as const;

export type AsaasCustomerAddress = { postalCode: string; street: string; number: string; complement: string | null; district: string };

const customerAddress = (a: AsaasCustomerAddress) => ({
  postalCode: a.postalCode,
  address: a.street,
  addressNumber: a.number,
  ...(a.complement ? { complement: a.complement } : {}),
  province: a.district,
});

export type AsaasBillingApi = ReturnType<typeof asaasBillingApi>;

export function asaasBillingApi(env: AsaasEnv, fetcher: Fetcher = fetch) {
  const get = <T>(path: string) => call<T>(env, fetcher, "GET", path);
  const post = <T>(path: string, body: Record<string, unknown>) => call<T>(env, fetcher, "POST", path, body);
  const del = <T>(path: string) => call<T>(env, fetcher, "DELETE", path);
  const put = <T>(path: string, body: Record<string, unknown>) => call<T>(env, fetcher, "PUT", path, body);
  const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

  return {
    /** Cliente pelo CNPJ/CPF (o primeiro não apagado), ou null. */
    async findCustomer(cpfCnpj: string): Promise<string | null> {
      const list = await get<List<{ id: string; deleted?: boolean }>>(`/customers?${q({ cpfCnpj, limit: "10" })}`);
      return list.data.find((c) => !c.deleted)?.id ?? null;
    },

    /** Cliente novo, com os avisos do Asaas desligados (decisão 11.11: só os nossos). */
    async createCustomer(input: {
      name: string;
      cpfCnpj: string;
      email: string;
      mobilePhone: string | null;
      externalReference: string;
      address?: AsaasCustomerAddress | null;
    }): Promise<string> {
      const created = await post<{ id: string }>("/customers", {
        name: input.name,
        cpfCnpj: input.cpfCnpj,
        email: input.email,
        ...(input.mobilePhone ? { mobilePhone: input.mobilePhone } : {}),
        ...(input.address ? customerAddress(input.address) : {}),
        externalReference: input.externalReference,
        notificationDisabled: true,
      });
      return created.id;
    },

    /**
     * Endereço do cliente (cliente, 07/nov/2026): o Checkout do Asaas o exige.
     * O Asaas completa cidade e UF pelo CEP (conferido no sandbox, 07/nov/2026).
     */
    async updateCustomerAddress(customer: string, address: AsaasCustomerAddress): Promise<void> {
      await post(`/customers/${encodeURIComponent(customer)}`, customerAddress(address));
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
        ...LATE_PAYMENT,
      });
      return created.id;
    },

    /** Multa e juros na assinatura (a do Checkout nasce sem); vale também para as cobranças dela em aberto. */
    async setSubscriptionLatePayment(subscription: string): Promise<void> {
      await post(`/subscriptions/${encodeURIComponent(subscription)}`, { ...LATE_PAYMENT, updatePendingPayments: true });
    },

    /** Troca cartão → Pix (cliente, 07/nov/2026): a assinatura e as cobranças pendentes dela (sandbox, 07/nov/2026). */
    async setSubscriptionBillingType(subscription: string, billingType: AsaasBillingType): Promise<void> {
      await post(`/subscriptions/${encodeURIComponent(subscription)}`, { billingType, updatePendingPayments: true });
    },

    /** Uma cobrança em aberto (a vencida e a avulsa, que a assinatura não muda; sandbox, 07/nov/2026). */
    async setPaymentBillingType(id: string, billingType: AsaasBillingType): Promise<void> {
      await post(`/payments/${encodeURIComponent(id)}`, { billingType });
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
        ...LATE_PAYMENT,
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

    /**
     * F12.2i: liga à assinatura o cartão que pagou a implantação, pelo token
     * do pagamento, sem cobrar nada (testado no sandbox em 04/nov/2026).
     * `remoteIp`: o IP de quem informou o cartão (exigência do Asaas).
     */
    async setSubscriptionCard(subscription: string, token: string, remoteIp: string): Promise<{ last4: string | null }> {
      const sub = await put<{ creditCard?: RawCard }>(`/subscriptions/${encodeURIComponent(subscription)}/creditCard`, { creditCardToken: token, remoteIp });
      return { last4: sub.creditCard?.creditCardNumber ?? null };
    },

    /** F12.2i: o final do cartão da assinatura (null = sem cartão). */
    async getSubscriptionCard(subscription: string): Promise<{ last4: string | null } | null> {
      const sub = await get<{ creditCard?: RawCard }>(`/subscriptions/${encodeURIComponent(subscription)}`);
      return sub.creditCard ? { last4: sub.creditCard.creditCardNumber ?? null } : null;
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
