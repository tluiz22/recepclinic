import { asaasClient, query, seg, toCents, toReais, type AsaasList, type AsaasTarget, type Fetcher } from "./http";

// API do Asaas com a chave de uma subconta (N1): regras do município,
// configuração fiscal, tomador e a nota (agendar, autorizar, consultar,
// cancelar), saldo e situação do cadastro. Seção 13.6 (Sandbox, 29/out):
// o `authorize` responde estados fora da lista documentada (`SYNCHRONIZED`):
// todo estado desconhecido vira "pending" e é confirmado depois por `GET`.

export type AuthenticationType = "CERTIFICATE" | "TOKEN" | "USER_AND_PASSWORD";

export type MunicipalOptions = {
  authenticationType: AuthenticationType | string;
  supportsCancellation: boolean;
  usesSpecialTaxRegimes: boolean;
  usesServiceListItem: boolean;
  specialTaxRegimesList: { label: string; value: string }[];
  nationalPortalTaxCalculationRegimeList: { label: string; value: string }[];
};

export type FiscalInfoInput = {
  email: string;
  simplesNacional: boolean;
  municipalInscription: string | null;
  cnae: string | null;
  specialTaxRegime: string | null;
  serviceListItem: string | null;
  nbsCode: string | null;
  rpsSerie: string | null;
  rpsNumber: number | null;
  nationalPortalTaxCalculationRegime: string | null;
  /** Só a credencial do `authenticationType` do município; nunca guardada pelo RecepClinic. */
  credential:
    | { type: "CERTIFICATE"; file: Uint8Array; fileName: string; password: string }
    | { type: "USER_AND_PASSWORD"; username: string; password: string }
    | { type: "TOKEN"; accessToken: string }
    | null;
};

export type FiscalInfo = {
  email: string | null;
  municipalInscription: string | null;
  simplesNacional: boolean;
  cnae: string | null;
  specialTaxRegime: string | null;
  serviceListItem: string | null;
  nbsCode: string | null;
  rpsSerie: string | null;
  rpsNumber: number | null;
  certificateSent: boolean;
  passwordSent: boolean;
  accessTokenSent: boolean;
};

/** Situação do cadastro da subconta (sem `general: APPROVED` a nota não sai). */
export type AccountStatus = { general: string; documentation: string; commercialInfo: string; bankAccountInfo: string };

export type InvoiceCustomer = {
  name: string;
  cpfCnpj: string;
  email: string;
  postalCode: string;
  street: string;
  number: string;
  complement: string | null;
  district: string;
  externalReference: string;
};

export type InvoiceTaxes = {
  retainIss: boolean;
  /** Percentuais. */
  iss: number;
  pis: number;
  cofins: number;
  csll: number;
  inss: number;
  ir: number;
  nbsCode: string | null;
  taxSituationCode: string | null;
  taxClassificationCode: string | null;
  operationIndicatorCode: string | null;
  pisCofinsTaxStatus: string | null;
};

export type NewInvoice = {
  customer: string;
  serviceDescription: string;
  observations: string;
  valueCents: number;
  /** AAAA-MM-DD (competência). */
  effectiveDate: string;
  municipalServiceCode: string;
  municipalServiceName: string;
  externalReference: string;
  taxes: InvoiceTaxes;
};

/** Estado local da nota no Asaas. */
export type AsaasInvoiceState = "pending" | "authorized" | "error" | "canceling" | "canceled" | "cancel_denied";

export type AsaasInvoice = {
  id: string;
  state: AsaasInvoiceState;
  rawStatus: string;
  number: string | null;
  validationCode: string | null;
  statusDescription: string | null;
  pdfUrl: string | null;
  xmlUrl: string | null;
  externalReference: string | null;
  valueCents: number;
};

export function invoiceState(raw: string): AsaasInvoiceState {
  switch (raw) {
    case "AUTHORIZED":
      return "authorized";
    case "ERROR":
      return "error";
    case "PROCESSING_CANCELLATION":
      return "canceling";
    case "CANCELED":
      return "canceled";
    case "CANCELLATION_DENIED":
      return "cancel_denied";
    default:
      // SCHEDULED, SYNCHRONIZED e qualquer estado novo: ainda sem resultado.
      return "pending";
  }
}

export type RawInvoice = {
  id: string;
  status: string;
  number?: string | null;
  validationCode?: string | null;
  statusDescription?: string | null;
  pdfUrl?: string | null;
  xmlUrl?: string | null;
  externalReference?: string | null;
  value?: number;
  deleted?: boolean;
};

export function toInvoice(raw: RawInvoice): AsaasInvoice {
  return {
    id: raw.id,
    state: invoiceState(raw.status),
    rawStatus: raw.status,
    number: raw.number || null,
    validationCode: raw.validationCode || null,
    statusDescription: raw.statusDescription || null,
    pdfUrl: raw.pdfUrl || null,
    xmlUrl: raw.xmlUrl || null,
    externalReference: raw.externalReference ?? null,
    valueCents: toCents(raw.value ?? 0),
  };
}

const optional = (form: FormData, key: string, value: string | number | null) => {
  if (value !== null && value !== "") form.append(key, String(value));
};

export type AsaasFiscalApi = ReturnType<typeof asaasFiscalApi>;

export function asaasFiscalApi(subaccount: AsaasTarget, fetcher: Fetcher = fetch) {
  const http = asaasClient(subaccount, fetcher);

  return {
    async municipalOptions(): Promise<MunicipalOptions> {
      const raw = await http.get<Partial<MunicipalOptions>>("/fiscalInfo/municipalOptions");
      return {
        authenticationType: raw.authenticationType ?? "CERTIFICATE",
        supportsCancellation: raw.supportsCancellation === true,
        usesSpecialTaxRegimes: raw.usesSpecialTaxRegimes === true,
        usesServiceListItem: raw.usesServiceListItem === true,
        specialTaxRegimesList: raw.specialTaxRegimesList ?? [],
        nationalPortalTaxCalculationRegimeList: raw.nationalPortalTaxCalculationRegimeList ?? [],
      };
    },

    /** Configuração fiscal (multipart); o certificado passa direto ao Asaas. */
    async saveFiscalInfo(input: FiscalInfoInput): Promise<FiscalInfo> {
      const form = new FormData();
      form.append("email", input.email);
      form.append("simplesNacional", String(input.simplesNacional));
      form.append("culturalProjectsPromoter", "false");
      optional(form, "municipalInscription", input.municipalInscription);
      optional(form, "cnae", input.cnae);
      optional(form, "specialTaxRegime", input.specialTaxRegime);
      optional(form, "serviceListItem", input.serviceListItem);
      optional(form, "nbsCode", input.nbsCode);
      optional(form, "rpsSerie", input.rpsSerie);
      optional(form, "rpsNumber", input.rpsNumber);
      optional(form, "nationalPortalTaxCalculationRegime", input.nationalPortalTaxCalculationRegime);
      const cred = input.credential;
      if (cred?.type === "CERTIFICATE") {
        form.append("certificateFile", new Blob([cred.file as BlobPart], { type: "application/x-pkcs12" }), cred.fileName);
        form.append("certificatePassword", cred.password);
      } else if (cred?.type === "USER_AND_PASSWORD") {
        form.append("username", cred.username);
        form.append("password", cred.password);
      } else if (cred?.type === "TOKEN") {
        form.append("accessToken", cred.accessToken);
      }
      return normalizeFiscalInfo(await http.post<RawFiscalInfo>("/fiscalInfo", form));
    },

    async getFiscalInfo(): Promise<FiscalInfo | null> {
      try {
        return normalizeFiscalInfo(await http.get<RawFiscalInfo>("/fiscalInfo"));
      } catch (error) {
        if ((error as { status?: number }).status === 404) return null;
        throw error;
      }
    },

    async accountStatus(): Promise<AccountStatus> {
      const raw = await http.get<Partial<AccountStatus>>("/myAccount/status");
      return {
        general: raw.general ?? "PENDING",
        documentation: raw.documentation ?? "PENDING",
        commercialInfo: raw.commercialInfo ?? "PENDING",
        bankAccountInfo: raw.bankAccountInfo ?? "PENDING",
      };
    },

    /** Saldo da subconta em centavos (pode ser negativo: a tarifa da nota é debitada aqui). */
    async balanceCents(): Promise<number> {
      const raw = await http.get<{ balance: number }>("/finance/balance");
      return toCents(raw.balance ?? 0);
    },

    async findCustomer(cpfCnpj: string): Promise<string | null> {
      const list = await http.get<AsaasList<{ id: string; deleted?: boolean }>>(`/customers?${query({ cpfCnpj, limit: "10" })}`);
      return list.data.find((c) => !c.deleted)?.id ?? null;
    },

    /** Tomador da nota: e-mail e endereço completos (exigência do Asaas, 13.6); régua de cobrança desligada. */
    async upsertCustomer(input: InvoiceCustomer): Promise<string> {
      const body = {
        name: input.name,
        cpfCnpj: input.cpfCnpj,
        email: input.email,
        postalCode: input.postalCode,
        address: input.street,
        addressNumber: input.number,
        ...(input.complement ? { complement: input.complement } : {}),
        province: input.district,
        externalReference: input.externalReference,
        notificationDisabled: true,
      };
      const existing = await this.findCustomer(input.cpfCnpj);
      if (existing) {
        await http.post(`/customers/${seg(existing)}`, body);
        return existing;
      }
      return (await http.post<{ id: string }>("/customers", body)).id;
    },

    async createInvoice(input: NewInvoice): Promise<AsaasInvoice> {
      const t = input.taxes;
      const created = await http.post<RawInvoice>("/invoices", {
        customer: input.customer,
        serviceDescription: input.serviceDescription,
        observations: input.observations,
        value: toReais(input.valueCents),
        deductions: 0,
        effectiveDate: input.effectiveDate,
        municipalServiceCode: input.municipalServiceCode,
        municipalServiceName: input.municipalServiceName,
        externalReference: input.externalReference,
        taxes: {
          retainIss: t.retainIss,
          iss: t.iss,
          pis: t.pis,
          cofins: t.cofins,
          csll: t.csll,
          inss: t.inss,
          ir: t.ir,
          ...(t.nbsCode ? { nbsCode: t.nbsCode } : {}),
          ...(t.taxSituationCode ? { taxSituationCode: t.taxSituationCode } : {}),
          ...(t.taxClassificationCode ? { taxClassificationCode: t.taxClassificationCode } : {}),
          ...(t.operationIndicatorCode ? { operationIndicatorCode: t.operationIndicatorCode } : {}),
          ...(t.pisCofinsTaxStatus ? { pisCofinsTaxStatus: t.pisCofinsTaxStatus } : {}),
        },
      });
      return toInvoice(created);
    },

    async authorizeInvoice(id: string): Promise<AsaasInvoice> {
      return toInvoice(await http.post<RawInvoice>(`/invoices/${seg(id)}/authorize`, {}));
    },

    async getInvoice(id: string): Promise<AsaasInvoice> {
      return toInvoice(await http.get<RawInvoice>(`/invoices/${seg(id)}`));
    },

    /** Nota pela referência externa (id da nota local): antes de repetir um pedido sem resposta. */
    async findInvoice(externalReference: string): Promise<AsaasInvoice | null> {
      const list = await http.get<AsaasList<RawInvoice>>(`/invoices?${query({ externalReference, limit: "10" })}`);
      const found = list.data.find((i) => !i.deleted);
      return found ? toInvoice(found) : null;
    },

    async cancelInvoice(id: string): Promise<AsaasInvoice> {
      return toInvoice(await http.post<RawInvoice>(`/invoices/${seg(id)}/cancel`, { cancelOnlyOnAsaas: false }));
    },

    /** Baixa o PDF ou o XML (links abertos sem login, 13.6): para copiar ao bucket privado. */
    async download(url: string): Promise<Uint8Array> {
      let response: Response;
      try {
        response = await fetcher(url, { signal: AbortSignal.timeout(60_000) });
      } catch (error) {
        throw new Error(`Arquivo da nota sem resposta (${error instanceof Error ? error.message : String(error)})`);
      }
      if (!response.ok) throw new Error(`Arquivo da nota indisponível (${response.status})`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

type RawFiscalInfo = Partial<Omit<FiscalInfo, "rpsNumber">> & { rpsNumber?: number | string | null };

function normalizeFiscalInfo(raw: RawFiscalInfo): FiscalInfo {
  return {
    email: raw.email ?? null,
    municipalInscription: raw.municipalInscription ?? null,
    simplesNacional: raw.simplesNacional === true,
    cnae: raw.cnae ?? null,
    specialTaxRegime: raw.specialTaxRegime ?? null,
    serviceListItem: raw.serviceListItem ?? null,
    nbsCode: raw.nbsCode ?? null,
    rpsSerie: raw.rpsSerie ?? null,
    rpsNumber: raw.rpsNumber === null || raw.rpsNumber === undefined ? null : Number(raw.rpsNumber),
    certificateSent: raw.certificateSent === true,
    passwordSent: raw.passwordSent === true,
    accessTokenSent: raw.accessTokenSent === true,
  };
}
