import forge from "node-forge";

// Certificado A1 (e-CNPJ) da clínica (F11.3): o servidor abre o .pfx com a
// senha só para conferir que ela está certa e ler o que a tela mostra
// (titular, CNPJ e validade). O arquivo e a senha seguem para o Vault; nada
// disso vai para log nem volta para a tela.
//
// No e-CNPJ da ICP-Brasil, o CNPJ fica no "nome alternativo" do certificado
// (OID 2.16.76.1.3.3) e, em geral, também no nome comum ("RAZÃO SOCIAL:CNPJ").

export const MAX_CERTIFICATE_BYTES = 100 * 1024;

const ICP_CNPJ_OID = "2.16.76.1.3.3";

export type CertificateInfo = {
  subjectName: string;
  /** 14 caracteres, ou null se o certificado não trouxer CNPJ (não é e-CNPJ). */
  cnpj: string | null;
  validFrom: Date;
  validUntil: Date;
};

export class CertificateError extends Error {
  constructor(
    readonly reason: "password" | "format" | "no_key",
    message: string,
  ) {
    super(message);
  }
}

export const CERTIFICATE_MESSAGES = {
  password: "Senha do certificado incorreta (ou arquivo danificado).",
  format: "O arquivo não é um certificado A1 (.pfx ou .p12).",
  no_key: "O arquivo não traz a chave do certificado: exporte o A1 de novo, com a chave privada.",
} as const;

/**
 * CNPJ no nome alternativo: os 14 caracteres que vêm logo depois do OID do
 * CNPJ (2.16.76.1.3.3). Busca nos bytes do campo, porque cada emissora
 * embrulha o valor de um jeito (OCTET STRING, PrintableString, UTF8String).
 */
export function cnpjFromAltName(der: string): string | null {
  const oid = forge.asn1.toDer(forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, forge.asn1.oidToDer(ICP_CNPJ_OID).getBytes())).getBytes();
  const at = der.indexOf(oid);
  if (at < 0) return null;
  return der.slice(at + oid.length, at + oid.length + 40).toUpperCase().match(/[0-9A-Z]{12}\d{2}/)?.[0] ?? null;
}

function cnpjOf(cert: forge.pki.Certificate): string | null {
  const altName = cert.extensions.find((e) => e.name === "subjectAltName") as { value?: string } | undefined;
  const fromAlt = altName?.value ? cnpjFromAltName(altName.value) : null;
  if (fromAlt) return fromAlt;
  const commonName = String(cert.subject.getField("CN")?.value ?? "");
  return commonName.toUpperCase().match(/:([0-9A-Z]{12}\d{2})$/)?.[1] ?? null;
}

/** Abre o .pfx com a senha e lê titular, CNPJ e validade do certificado da chave. */
export function readCertificate(pfx: Uint8Array, password: string): CertificateInfo {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.binary.raw.encode(pfx));
    try {
      p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
    } catch {
      throw new CertificateError("password", CERTIFICATE_MESSAGES.password);
    }
  } catch (error) {
    if (error instanceof CertificateError) throw error;
    throw new CertificateError("format", CERTIFICATE_MESSAGES.format);
  }

  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const key = keyBags.find((bag) => bag.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!key) throw new CertificateError("no_key", CERTIFICATE_MESSAGES.no_key);

  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((bag) => bag.cert).filter((c) => c !== undefined);
  // O certificado da chave (os outros são da cadeia da autoridade).
  const cert = certs.find((c) => {
    const publicKey = c.publicKey as forge.pki.rsa.PublicKey;
    return publicKey.n?.equals(key.n) && publicKey.e?.equals(key.e);
  });
  if (!cert) throw new CertificateError("no_key", CERTIFICATE_MESSAGES.no_key);

  const commonName = String(cert.subject.getField("CN")?.value ?? "");
  let subjectName = commonName.replace(/:[0-9A-Z]{12}\d{2}$/i, "");
  try {
    subjectName = forge.util.decodeUtf8(subjectName);
  } catch {
    // Já veio como texto.
  }
  return {
    subjectName: subjectName.trim() || commonName,
    cnpj: cnpjOf(cert),
    validFrom: cert.validity.notBefore,
    validUntil: cert.validity.notAfter,
  };
}

/** Situação do certificado: em dia, vencendo (30 dias, cliente, 12/out/2026) ou vencido. */
export const EXPIRY_WARNING_DAYS = 30;

export function certificateStatus(validUntil: Date, now: Date = new Date()): { state: "ok" | "expiring" | "expired"; daysLeft: number } {
  const daysLeft = Math.floor((validUntil.getTime() - now.getTime()) / 86_400_000);
  if (validUntil.getTime() <= now.getTime()) return { state: "expired", daysLeft: 0 };
  return { state: daysLeft < EXPIRY_WARNING_DAYS ? "expiring" : "ok", daysLeft };
}
