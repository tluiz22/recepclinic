import forge from "node-forge";
import { SignedXml } from "xml-crypto";

// Assinatura XML (XML-DSig envelopada) da DPS e do pedido de evento (F11.4):
// RSA-SHA256, resumo SHA-256, C14N inclusiva, referência ao Id do elemento
// assinado e o certificado no KeyInfo, sem prefixo (a Sefin recusa prefixos).
// A chave sai do .pfx só na memória, na hora; nunca vai para log nem disco.

const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";

export type CertificateKeys = { keyPem: string; certPem: string; chainPem: string[] };

/**
 * Chave e certificado do .pfx, em PEM. Pelo node-forge, porque o OpenSSL 3
 * do Node recusa os algoritmos antigos que muitos A1 da ICP-Brasil usam.
 */
export function keysFromPfx(pfx: Uint8Array, password: string): CertificateKeys {
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.binary.raw.encode(pfx)), false, password);
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const key = keyBags.find((bag) => bag.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!key) throw new Error("Certificado sem chave");
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((bag) => bag.cert).filter((c) => c !== undefined);
  const own = certs.find((c) => {
    const publicKey = c.publicKey as forge.pki.rsa.PublicKey;
    return publicKey.n?.equals(key.n) && publicKey.e?.equals(key.e);
  });
  if (!own) throw new Error("Certificado da chave não encontrado");
  return {
    keyPem: forge.pki.privateKeyToPem(key),
    certPem: forge.pki.certificateToPem(own),
    chainPem: certs.filter((c) => c !== own).map((c) => forge.pki.certificateToPem(c)),
  };
}

/** Assina o elemento `signedTag` (com Id) e põe a assinatura no fim de `parentTag`. */
export function signXml(xml: string, signedTag: "infDPS" | "infPedReg", parentTag: "DPS" | "pedRegEvento", keys: CertificateKeys): string {
  const signer = new SignedXml({
    privateKey: keys.keyPem,
    publicCert: keys.certPem,
    signatureAlgorithm: RSA_SHA256,
    canonicalizationAlgorithm: C14N,
  });
  signer.addReference({ xpath: `//*[local-name(.)='${signedTag}']`, digestAlgorithm: SHA256, transforms: [ENVELOPED, C14N] });
  signer.computeSignature(xml, { location: { reference: `//*[local-name(.)='${parentTag}']`, action: "append" } });
  return signer.getSignedXml();
}
