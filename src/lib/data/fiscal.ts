// Nota fiscal: o que sobrou do módulo fiscal da F11 depois da N5 (o emissor
// antigo, com os dados fiscais por clínica e o certificado A1 no Vault, saiu):
// municípios liberados, código de serviço e ISS (usados pelo emissor,
// fiscalIssuers.ts) e os rótulos da trilha fiscal.

/** Municípios liberados (o banco tem a mesma lista: app.is_supported_fiscal_municipality). */
export const FISCAL_MUNICIPALITIES = [{ ibge: "2408003", name: "Mossoró", state: "RN" }] as const;

const SERVICE_CODE = /^\d{2}\.\d{2}\.\d{2}$/;

/** "04.01.01" ou "040101" → "04.01.01"; outro formato = null. */
export function normalizeServiceCode(input: string | null | undefined): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  if (digits.length !== 6) return null;
  const code = `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4, 6)}`;
  return SERVICE_CODE.test(code) ? code : null;
}

/** "2", "2,5" ou "2.50" → 2.5; inválido ou fora de 0 a 5 = NaN. */
export function parseIssRate(input: string | null | undefined): number {
  const text = (input ?? "").trim().replace("%", "").replace(",", ".");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) return Number.NaN;
  const rate = Number(text);
  return rate >= 0 && rate <= 5 ? rate : Number.NaN;
}

export type FiscalAuditEvent =
  | "terms_accepted"
  | "certificate_uploaded"
  | "certificate_replaced"
  | "certificate_revoked"
  | "dmed_generated"
  | "environment_changed"
  | "nfse_issue_requested"
  | "nfse_issued"
  | "nfse_rejected"
  | "nfse_cancel_requested"
  | "nfse_canceled"
  | "nfse_cancel_rejected"
  | "issuer_saved"
  | "issuer_route_changed"
  | "issuer_payer_changed"
  | "asaas_account_created"
  | "account_status_changed"
  | "fiscal_info_saved"
  | "fiscal_info_failed"
  | "issuing_enabled"
  | "issuing_disabled"
  | "issuer_suspended"
  | "issuer_released";

export const FISCAL_AUDIT_LABEL: Record<FiscalAuditEvent, string> = {
  terms_accepted: "Termo de autorização aceito",
  certificate_uploaded: "Certificado enviado",
  certificate_replaced: "Certificado trocado",
  certificate_revoked: "Certificado revogado",
  dmed_generated: "Arquivo da DMED gerado",
  environment_changed: "Ambiente da Receita trocado",
  nfse_issue_requested: "Emissão de nota pedida",
  nfse_issued: "Nota emitida",
  nfse_rejected: "Nota recusada pela Receita",
  nfse_cancel_requested: "Cancelamento de nota pedido",
  nfse_canceled: "Nota cancelada",
  nfse_cancel_rejected: "Cancelamento recusado pela Receita",
  issuer_saved: "Dados fiscais do emissor salvos",
  issuer_route_changed: "Forma de emitir do profissional trocada",
  issuer_payer_changed: "Quem paga as notas trocado",
  asaas_account_created: "Subconta criada no Asaas",
  account_status_changed: "Situação do cadastro no Asaas mudou",
  fiscal_info_saved: "Configuração fiscal aceita pelo Asaas",
  fiscal_info_failed: "Configuração fiscal recusada pelo Asaas",
  issuing_enabled: "Emissão ligada",
  issuing_disabled: "Emissão desligada",
  issuer_suspended: "Emissão suspensa por falta de pagamento",
  issuer_released: "Emissão liberada depois do pagamento",
};

