import forge from "node-forge";

// Certificado A1 de teste (F11.3), no formato do e-CNPJ ("RAZÃO SOCIAL:CNPJ").
const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });

export function makeTestPfx(
  cnpj: string,
  password: string,
  { validFrom = new Date(Date.now() - 86_400_000), validUntil = new Date(Date.now() + 365 * 86_400_000) }: { validFrom?: Date; validUntil?: Date } = {},
): Uint8Array {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = validFrom;
  cert.validity.notAfter = validUntil;
  cert.setSubject([{ name: "commonName", value: `CLINICA DE TESTE LTDA:${cnpj}` }]);
  cert.setIssuer([{ name: "commonName", value: "AC Teste" }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: "3des" });
  return forge.util.binary.raw.decode(forge.asn1.toDer(p12).getBytes());
}
