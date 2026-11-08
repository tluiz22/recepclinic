import { describe, expect, it } from "vitest";
import { AsaasApiError, asaasBillingApi } from "./billingApi";

// F12.4: cliente da API do Asaas para cobrar as clínicas (fetch de mentira).
const env = { apiKey: "chave-teste", baseUrl: "https://api-sandbox.asaas.com/v3", webhookToken: null };

function fakeFetch(responses: Record<string, unknown>, calls: { url: string; init: RequestInit }[] = [], status = 200) {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(responses).find((k) => url.includes(k));
    return new Response(JSON.stringify(key ? responses[key] : { data: [] }), { status });
  }) as unknown as typeof fetch;
}

describe("API do Asaas (F12.4)", () => {
  it("cria o cliente com os avisos do Asaas desligados e a chave no cabeçalho", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const api = asaasBillingApi(env, fakeFetch({ "/customers": { id: "cus_1" } }, calls));
    const id = await api.createCustomer({ name: "Clínica", cpfCnpj: "11222333000181", email: "a@b.c", mobilePhone: "84988880000", externalReference: "x" });
    expect(id).toBe("cus_1");
    expect(calls[0].url).toBe("https://api-sandbox.asaas.com/v3/customers");
    expect((calls[0].init.headers as Record<string, string>).access_token).toBe("chave-teste");
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ notificationDisabled: true, mobilePhone: "84988880000" });
  });

  it("assinatura mensal com o valor em reais; cobrança volta em centavos com a data do pagamento", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const api = asaasBillingApi(
      env,
      fakeFetch(
        {
          "/subscriptions/sub_1/payments": { data: [{ id: "pay_1", subscription: "sub_1", dueDate: "2026-12-10", value: 299.9, billingType: "PIX", status: "RECEIVED", paymentDate: "2026-12-09", invoiceUrl: "https://f" }] },
          "/subscriptions": { id: "sub_1" },
        },
        calls,
      ),
    );
    await api.createSubscription({ customer: "cus_1", billingType: "PIX", valueCents: 29990, nextDueDate: "2026-12-10", description: "d", externalReference: "c" });
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ value: 299.9, cycle: "MONTHLY", billingType: "PIX", nextDueDate: "2026-12-10" });
    const [payment] = await api.listSubscriptionPayments("sub_1");
    expect(payment).toMatchObject({ id: "pay_1", valueCents: 29990, status: "RECEIVED", paidAt: "2026-12-09T12:00:00-03:00", invoiceUrl: "https://f" });
  });

  it("multa de 2% e juros de 1% ao mês na assinatura, na implantação e na assinatura do Checkout (contrato, seção 3)", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const api = asaasBillingApi(
      env,
      fakeFetch({ "/subscriptions/sub_9": { id: "sub_9" }, "/subscriptions": { id: "sub_1" }, "/payments": { id: "pay_1", dueDate: "2026-12-10", value: 1, status: "PENDING" } }, calls),
    );
    await api.createSubscription({ customer: "cus_1", billingType: "PIX", valueCents: 100, nextDueDate: "2026-12-10", description: "d", externalReference: "c" });
    await api.createPayment({ customer: "cus_1", billingType: "PIX", valueCents: 100, dueDate: "2026-12-10", description: "d", externalReference: "setup:c" });
    await api.setSubscriptionLatePayment("sub_9");
    for (const call of calls) {
      expect(JSON.parse(call.init.body as string)).toMatchObject({ fine: { value: 2, type: "PERCENTAGE" }, interest: { value: 1 } });
    }
    expect(JSON.parse(calls[2].init.body as string)).toMatchObject({ updatePendingPayments: true });
  });

  it("procura sem duplicar: ignora apagados", async () => {
    const api = asaasBillingApi(env, fakeFetch({ "/customers": { data: [{ id: "cus_old", deleted: true }, { id: "cus_ok" }] } }));
    expect(await api.findCustomer("11222333000181")).toBe("cus_ok");
  });

  it("erro do Asaas vira mensagem legível", async () => {
    const api = asaasBillingApi(env, fakeFetch({ "/payments": { errors: [{ code: "invalid_dueDate", description: "Data de vencimento inválida" }] } }, [], 400));
    await expect(api.createPayment({ customer: "c", billingType: "PIX", valueCents: 100, dueDate: "2020-01-01", description: "d", externalReference: "e" })).rejects.toThrow(
      new AsaasApiError(400, "Asaas recusou (400): Data de vencimento inválida", ["invalid_dueDate"]),
    );
  });
});
