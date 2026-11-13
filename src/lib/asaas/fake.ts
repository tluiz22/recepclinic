// Asaas falso para os testes (N1): guarda em memória a conta principal, as
// subcontas, a configuração fiscal, os tomadores e as notas, e responde como
// a API (formatos conferidos no Sandbox em 29/out e na documentação). Nada
// sai da máquina. A chave decide de quem é o pedido: `MAIN_KEY` é a conta
// principal; cada subconta recebe a sua na criação.

export const FAKE_ASAAS_URL = "https://fake.asaas.local/v3";
export const FAKE_MAIN_KEY = "$aact_fake_main";

type Account = {
  id: string;
  walletId: string;
  apiKey: string;
  cpfCnpj: string;
  name: string;
  balanceCents: number;
  general: string;
  fiscalInfo: Record<string, unknown> | null;
  webhook: { url: string; authToken: string } | null;
};

type Invoice = {
  id: string;
  accountId: string;
  status: string;
  externalReference: string | null;
  customer: string;
  value: number;
  number: string | null;
  validationCode: string | null;
  statusDescription: string | null;
  pdfUrl: string | null;
  xmlUrl: string | null;
  body: Record<string, unknown>;
};

export type FakeAsaasOptions = {
  /** Estado que o `authorize` devolve (padrão SYNCHRONIZED, como no Sandbox). */
  authorizeStatus?: string;
  /** Município (padrão: Mossoró, que exige certificado e cancela). */
  municipal?: { authenticationType: string; supportsCancellation: boolean };
};

export function createFakeAsaas(options: FakeAsaasOptions = {}) {
  let seq = 0;
  const next = (prefix: string) => `${prefix}_${String(++seq).padStart(6, "0")}`;
  const accounts = new Map<string, Account>();
  const customers = new Map<string, { id: string; accountId: string; body: Record<string, unknown> }>();
  const invoices = new Map<string, Invoice>();
  const transfers: { id: string; walletId: string; valueCents: number; externalReference: string | null }[] = [];
  const calls: { method: string; path: string; key: string }[] = [];
  let failNext: { path: RegExp; status: number; description: string } | null = null;
  let timeoutNext: RegExp | null = null;
  const main = { balanceCents: 100_000 };
  const files = new Map<string, Uint8Array>();
  const mainCustomers = new Map<string, { id: string; cpfCnpj: string; body: Record<string, unknown> }>();
  const payments = new Map<string, { id: string; customer: string; value: number; dueDate: string; billingType: string; status: string; externalReference: string | null; description: string; invoiceUrl: string; paymentDate?: string }>();

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const error = (status: number, description: string, code = "invalid_action") => json({ errors: [{ code, description }] }, status);

  const rawInvoice = (i: Invoice) => ({
    object: "invoice",
    id: i.id,
    status: i.status,
    customer: i.customer,
    externalReference: i.externalReference,
    value: i.value,
    number: i.number,
    validationCode: i.validationCode,
    statusDescription: i.statusDescription,
    pdfUrl: i.pdfUrl,
    xmlUrl: i.xmlUrl,
  });

  function authorizeNow(i: Invoice) {
    i.status = "AUTHORIZED";
    i.number = String(1000 + invoices.size);
    i.validationCode = `VC${i.id}`;
    i.pdfUrl = `${FAKE_ASAAS_URL.replace("/v3", "")}/file/${i.id}.pdf`;
    i.xmlUrl = `${FAKE_ASAAS_URL.replace("/v3", "")}/file/${i.id}.xml`;
    files.set(i.pdfUrl, new TextEncoder().encode(`%PDF-1.4 nota ${i.id}`));
    files.set(i.xmlUrl, new TextEncoder().encode(`<?xml version="1.0"?><NFSe><numero>${i.number}</numero></NFSe>`));
    const account = accounts.get(i.accountId);
    if (account) account.balanceCents -= 49;
  }

  async function bodyOf(init: RequestInit | undefined): Promise<Record<string, unknown>> {
    if (!init?.body) return {};
    if (init.body instanceof FormData) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of init.body.entries()) out[k] = typeof v === "string" ? v : `[arquivo ${(v as File).name}]`;
      return out;
    }
    return JSON.parse(String(init.body)) as Record<string, unknown>;
  }

  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (files.has(url)) return new Response(files.get(url) as BodyInit, { status: 200 });
    if (!url.startsWith(FAKE_ASAAS_URL)) return new Response("not found", { status: 404 });
    const method = init?.method ?? "GET";
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/v3/, "").replace(/\/+$/, "");
    const key = String((init?.headers as Record<string, string> | undefined)?.access_token ?? "");
    calls.push({ method, path, key });
    if (timeoutNext && timeoutNext.test(path)) {
      timeoutNext = null;
      throw new Error("The operation was aborted due to timeout");
    }
    if (failNext && failNext.path.test(path)) {
      const f = failNext;
      failNext = null;
      return error(f.status, f.description);
    }
    const body = await bodyOf(init);

    if (key === FAKE_MAIN_KEY) {
      if (method === "POST" && path === "/accounts") {
        const cpfCnpj = String(body.cpfCnpj);
        if ([...accounts.values()].some((a) => a.cpfCnpj === cpfCnpj)) return error(400, "O CPF/CNPJ informado já está em uso.");
        const id = next("acc");
        const hooks = body.webhooks as { url: string; authToken: string }[] | undefined;
        const account: Account = {
          id,
          walletId: next("wal"),
          apiKey: `$aact_fake_sub_${id}`,
          cpfCnpj,
          name: String(body.name),
          balanceCents: 0,
          general: "PENDING",
          fiscalInfo: null,
          webhook: hooks?.[0] ? { url: hooks[0].url, authToken: hooks[0].authToken } : null,
        };
        accounts.set(id, account);
        return json({ object: "account", id, walletId: account.walletId, cpfCnpj, accessToken: { apiKey: account.apiKey } });
      }
      if (method === "GET" && path === "/accounts") {
        const cpfCnpj = parsed.searchParams.get("cpfCnpj");
        return json({ data: [...accounts.values()].filter((a) => a.cpfCnpj === cpfCnpj).map((a) => ({ id: a.id, walletId: a.walletId, cpfCnpj: a.cpfCnpj })) });
      }
      if (method === "POST" && path === "/transfers") {
        const account = [...accounts.values()].find((a) => a.walletId === body.walletId);
        if (!account) return error(400, "Carteira não encontrada.");
        const valueCents = Math.round(Number(body.value) * 100);
        if (valueCents > main.balanceCents) return error(400, "Saldo insuficiente.");
        main.balanceCents -= valueCents;
        account.balanceCents += valueCents;
        const t = { id: next("tra"), walletId: account.walletId, valueCents, externalReference: (body.externalReference as string) ?? null };
        transfers.push(t);
        return json({ object: "transfer", id: t.id, status: "DONE", value: valueCents / 100, walletId: t.walletId });
      }
      // Cobrança das notas (N4b): clientes e cobranças avulsas na conta principal.
      if (path === "/customers" && method === "GET") {
        const cpfCnpj = parsed.searchParams.get("cpfCnpj");
        return json({ data: [...mainCustomers.values()].filter((c) => c.cpfCnpj === cpfCnpj).map((c) => ({ id: c.id })) });
      }
      if (path === "/customers" && method === "POST") {
        const id = next("cus");
        mainCustomers.set(id, { id, cpfCnpj: String(body.cpfCnpj), body });
        return json({ id });
      }
      if (path === "/payments" && method === "POST") {
        const id = next("pay");
        const p = { id, customer: String(body.customer), value: Number(body.value), dueDate: String(body.dueDate), billingType: String(body.billingType), status: "PENDING", externalReference: (body.externalReference as string) ?? null, description: String(body.description ?? ""), invoiceUrl: `https://fake.asaas.local/i/${id}` };
        payments.set(id, p);
        return json(p);
      }
      if (path === "/payments" && method === "GET") {
        const ref = parsed.searchParams.get("externalReference");
        return json({ data: [...payments.values()].filter((p) => p.externalReference === ref) });
      }
      const pay = path.match(/^\/payments\/([^/]+)$/);
      if (pay && method === "GET") {
        const p = payments.get(decodeURIComponent(pay[1]));
        return p ? json(p) : error(404, "Cobrança não encontrada.");
      }
      return error(404, `rota falsa sem resposta: ${method} ${path}`);
    }

    const account = [...accounts.values()].find((a) => a.apiKey === key);
    if (!account) return error(401, "A chave de API fornecida é inválida", "invalid_access_token");

    if (method === "GET" && path === "/fiscalInfo/municipalOptions") {
      return json({
        authenticationType: options.municipal?.authenticationType ?? "CERTIFICATE",
        supportsCancellation: options.municipal?.supportsCancellation ?? true,
        usesSpecialTaxRegimes: true,
        usesServiceListItem: true,
        specialTaxRegimesList: [
          { label: "-", value: "0" },
          { label: "Microempresa Municipal", value: "1" },
          { label: "Sociedade de Profissionais", value: "3" },
        ],
        nationalPortalTaxCalculationRegimeList: [],
      });
    }
    if (path === "/fiscalInfo") {
      if (method === "POST") {
        if (!body.email) return error(400, "O e-mail é obrigatório.");
        const prev = account.fiscalInfo ?? {};
        account.fiscalInfo = {
          ...prev,
          ...body,
          certificateSent: Boolean(body.certificateFile) || prev.certificateSent === true,
          simplesNacional: body.simplesNacional === "true",
        };
        delete account.fiscalInfo.certificateFile;
        delete account.fiscalInfo.certificatePassword;
        return json({ object: "customerFiscalInfo", ...account.fiscalInfo, rpsNumber: body.rpsNumber ? Number(body.rpsNumber) : null });
      }
      return account.fiscalInfo ? json({ object: "customerFiscalInfo", ...account.fiscalInfo }) : error(404, "Sem informações fiscais.");
    }
    if (method === "GET" && path === "/myAccount/status") {
      return json({ id: account.id, general: account.general, documentation: account.general, commercialInfo: account.general, bankAccountInfo: "APPROVED" });
    }
    if (method === "GET" && path === "/finance/balance") return json({ balance: account.balanceCents / 100 });
    if (path === "/customers" && method === "GET") {
      const cpfCnpj = parsed.searchParams.get("cpfCnpj");
      return json({ data: [...customers.values()].filter((c) => c.accountId === account.id && c.body.cpfCnpj === cpfCnpj).map((c) => ({ id: c.id })) });
    }
    if (path === "/customers" && method === "POST") {
      const id = next("cus");
      customers.set(id, { id, accountId: account.id, body });
      return json({ id });
    }
    const customerMatch = path.match(/^\/customers\/([^/]+)$/);
    if (customerMatch && method === "POST") {
      const c = customers.get(decodeURIComponent(customerMatch[1]));
      if (!c) return error(404, "Cliente não encontrado.");
      c.body = { ...c.body, ...body };
      return json({ id: c.id });
    }
    if (path === "/invoices" && method === "POST") {
      const customer = customers.get(String(body.customer));
      if (!customer || customer.accountId !== account.id) return error(400, "Cliente inválido.");
      if (!customer.body.email || !customer.body.postalCode) return error(400, "E-mail do cliente incompleto; Endereço do cliente incompleto");
      const id = next("inv");
      const invoice: Invoice = {
        id,
        accountId: account.id,
        status: "SCHEDULED",
        externalReference: (body.externalReference as string) ?? null,
        customer: customer.id,
        value: Number(body.value),
        number: null,
        validationCode: null,
        statusDescription: null,
        pdfUrl: null,
        xmlUrl: null,
        body,
      };
      invoices.set(id, invoice);
      return json(rawInvoice(invoice));
    }
    if (path === "/invoices" && method === "GET") {
      const ref = parsed.searchParams.get("externalReference");
      return json({ data: [...invoices.values()].filter((i) => i.accountId === account.id && (!ref || i.externalReference === ref)).map(rawInvoice) });
    }
    const invoiceMatch = path.match(/^\/invoices\/([^/]+)(?:\/(authorize|cancel))?$/);
    if (invoiceMatch) {
      const invoice = invoices.get(decodeURIComponent(invoiceMatch[1]));
      if (!invoice || invoice.accountId !== account.id) return error(404, "Nota não encontrada.");
      const action = invoiceMatch[2];
      if (action === "authorize" && method === "POST") {
        if (account.general !== "APPROVED") return error(400, "Você precisa ter seu cadastro geral aprovado para emitir notas fiscais.");
        if (!account.fiscalInfo) return error(400, "Configure as informações fiscais.");
        invoice.status = options.authorizeStatus ?? "SYNCHRONIZED";
        if (invoice.status === "AUTHORIZED") authorizeNow(invoice);
        return json(rawInvoice(invoice));
      }
      if (action === "cancel" && method === "POST") {
        if (!(options.municipal?.supportsCancellation ?? true)) return error(400, "O município não permite cancelamento.");
        if (invoice.status !== "AUTHORIZED" && invoice.status !== "CANCELLATION_DENIED") return error(400, "Só nota autorizada pode ser cancelada.");
        invoice.status = "PROCESSING_CANCELLATION";
        return json(rawInvoice(invoice));
      }
      if (!action && method === "GET") return json(rawInvoice(invoice));
    }
    return error(404, `rota falsa sem resposta: ${method} ${path}`);
  }) as unknown as typeof fetch;

  return {
    fetch: fetcher,
    baseUrl: FAKE_ASAAS_URL,
    mainKey: FAKE_MAIN_KEY,
    main,
    accounts,
    customers,
    invoices,
    transfers,
    calls,
    mainCustomers,
    payments,
    /** A cobrança foi paga (ou venceu). */
    setPaymentStatus(id: string, status: string) {
      const p = payments.get(id);
      if (p) {
        p.status = status;
        if (status === "RECEIVED") p.paymentDate = new Date().toISOString().slice(0, 10);
      }
    },
    /** Aprova o cadastro da subconta (no Sandbox: POST /sandbox/myAccount/approve). */
    approve(accountId: string) {
      const a = accounts.get(accountId);
      if (a) a.general = "APPROVED";
    },
    /** A prefeitura autoriza a nota (o que o webhook INVOICE_AUTHORIZED avisa). */
    authorize(invoiceId: string) {
      const i = invoices.get(invoiceId);
      if (i) authorizeNow(i);
    },
    reject(invoiceId: string, description = "Código de serviço inválido para o município.") {
      const i = invoices.get(invoiceId);
      if (i) {
        i.status = "ERROR";
        i.statusDescription = description;
      }
    },
    finishCancel(invoiceId: string, denied = false) {
      const i = invoices.get(invoiceId);
      if (i) {
        i.status = denied ? "CANCELLATION_DENIED" : "CANCELED";
        if (denied) i.statusDescription = "Prazo de cancelamento expirado.";
      }
    },
    failNext(path: RegExp, status: number, description: string) {
      failNext = { path, status, description };
    },
    timeoutNext(path: RegExp) {
      timeoutNext = path;
    },
    /** Evento de webhook como o Asaas manda. */
    webhookEvent(invoiceId: string, event: string, eventId = next("evt")) {
      const i = invoices.get(invoiceId);
      if (!i) throw new Error("nota falsa inexistente");
      return { id: eventId, event, dateCreated: new Date().toISOString(), account: { id: i.accountId, ownerId: "acc_main" }, invoice: rawInvoice(i) };
    },
  };
}

export type FakeAsaas = ReturnType<typeof createFakeAsaas>;
