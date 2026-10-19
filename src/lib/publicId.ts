import { isUuid } from "./clinicAccess";

// Ids nos links das páginas do paciente (relato do cliente, 18/out/2026): o
// WhatsApp lê um UUID no fim do endereço como chave Pix aleatória, sublinha só
// ele e, no toque, copia em vez de abrir. O link leva o mesmo id em 22
// caracteres (base64url dos 16 bytes); as páginas aceitam também o UUID, para
// os links que já foram enviados.

const SHORT = /^[A-Za-z0-9_-]{22}$/;

/** Id do link: o UUID em 22 caracteres. */
export function shortId(uuid: string): string {
  return Buffer.from(uuid.replace(/-/g, ""), "hex").toString("base64url");
}

/** UUID do id que veio no endereço (curto ou o UUID antigo); null se não for nenhum dos dois. */
export function parsePublicId(value: string | null | undefined): string | null {
  if (!value) return null;
  if (isUuid(value)) return value.toLowerCase();
  if (!SHORT.test(value)) return null;
  const hex = Buffer.from(value, "base64url").toString("hex");
  if (hex.length !== 32 || shortId(hex) !== value) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const bookingPath = (linkId: string) => `/agendar/${shortId(linkId)}`;
export const preparationPath = (serviceId: string) => `/preparo/${shortId(serviceId)}`;
export const guidancePath = (clinicId: string) => `/orientacoes/${shortId(clinicId)}`;
