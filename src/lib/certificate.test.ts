import forge from "node-forge";
import { beforeAll, describe, expect, it } from "vitest";
import { certificateStatus, CertificateError, cnpjFromAltName, readCertificate } from "./certificate";

// Certificado A1 (F11.3): um .pfx de teste gerado aqui, no formato do e-CNPJ
// ("RAZÃO SOCIAL:CNPJ" no nome comum e o CNPJ no nome alternativo).
let keys: forge.pki.rsa.KeyPair;

beforeAll(() => {
  keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
});

function makePfx(commonName: string, password: string, { withKey = true, altCnpj }: { withKey?: boolean; altCnpj?: string } = {}): Uint8Array {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date("2026-01-01T00:00:00Z");
  cert.validity.notAfter = new Date("2027-01-01T00:00:00Z");
  cert.setSubject([{ name: "commonName", value: commonName, valueTagClass: forge.asn1.Type.UTF8 as never }]);
  cert.setIssuer([{ name: "commonName", value: "AC Teste" }]);
  if (altCnpj) cert.setExtensions([{ name: "subjectAltName", altNames: [{ type: 0, value: otherName(altCnpj) }] } as never]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(withKey ? keys.privateKey : null, [cert], password, { algorithm: "3des" });
  return forge.util.binary.raw.decode(forge.asn1.toDer(p12).getBytes());
}

// otherName do ICP-Brasil: OID 2.16.76.1.3.3 e o CNPJ num OCTET STRING.
function otherName(cnpj: string): string {
  const { asn1 } = forge;
  const oid = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer("2.16.76.1.3.3").getBytes());
  const value = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, cnpj)]);
  return asn1.toDer(oid).getBytes() + asn1.toDer(value).getBytes();
}

describe("certificado A1", () => {
  it("lê titular, CNPJ e validade com a senha certa", () => {
    const info = readCertificate(makePfx("CLÍNICA TESTE LTDA:11222333000181", "segredo"), "segredo");
    expect(info).toEqual({
      subjectName: "CLÍNICA TESTE LTDA",
      cnpj: "11222333000181",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validUntil: new Date("2027-01-01T00:00:00Z"),
    });
  });

  it("senha errada, arquivo que não é certificado e .pfx sem a chave", () => {
    const reason = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error instanceof CertificateError ? error.reason : "outro";
      }
      return "ok";
    };
    const pfx = makePfx("CLINICA:11222333000181", "segredo");
    expect(reason(() => readCertificate(pfx, "errada"))).toBe("password");
    expect(reason(() => readCertificate(new TextEncoder().encode("não sou um pfx"), "x"))).toBe("format");
    expect(reason(() => readCertificate(makePfx("CLINICA:11222333000181", "s", { withKey: false }), "s"))).toBe("no_key");
  });

  it("CNPJ pelo nome alternativo do ICP-Brasil (vale mais que o nome comum)", () => {
    const info = readCertificate(makePfx("CLINICA SEM CNPJ NO NOME", "s", { altCnpj: "11444777000161" }), "s");
    expect(info.cnpj).toBe("11444777000161");
    expect(info.subjectName).toBe("CLINICA SEM CNPJ NO NOME");
    expect(cnpjFromAltName("lixo")).toBeNull();
  });

  it("sem CNPJ nenhum (não é e-CNPJ)", () => {
    expect(readCertificate(makePfx("FULANO DE TAL", "s"), "s").cnpj).toBeNull();
  });

  it("situação: em dia, vencendo em menos de 30 dias e vencido", () => {
    const now = new Date("2026-10-12T12:00:00Z");
    expect(certificateStatus(new Date("2027-01-01T00:00:00Z"), now).state).toBe("ok");
    expect(certificateStatus(new Date("2026-11-01T00:00:00Z"), now)).toEqual({ state: "expiring", daysLeft: 19 });
    expect(certificateStatus(new Date("2026-10-12T11:00:00Z"), now)).toEqual({ state: "expired", daysLeft: 0 });
  });
});
