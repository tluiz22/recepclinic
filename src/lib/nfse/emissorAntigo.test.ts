import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// N5 — o emissor antigo da NFS-e (DPS assinada e enviada à Sefin pelo
// servidor, com o certificado A1 no Vault) saiu: nada no código volta a usá-lo.
// As notas antigas seguem só para consulta (danfse.ts gera o PDF do XML).

const ROOT = new URL("../../", import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|astro|mjs)$/.test(name) ? [path] : [];
  });
}

describe("emissor antigo removido (N5)", () => {
  it("src/lib/nfse só tem o gerador do PDF das notas antigas", () => {
    expect(readdirSync(join(ROOT, "lib/nfse")).filter((f) => !f.endsWith(".test.ts")).sort()).toEqual(["danfse.ts", "fixtures", "logo.ts"]);
  });

  it("nenhum arquivo importa o cliente da Sefin, a DPS, a assinatura ou a simulação, nem chama as funções antigas", () => {
    const banned = /nfse\/(client|dps|sign|simulator)|begin_nfse_issue|finish_nfse_issue|begin_nfse_cancel|finish_nfse_cancel|get_fiscal_certificate_secret|set_fiscal_certificate|revoke_fiscal_certificate|list_pending_nfse_invoices|clinic_fiscal_settings|clinic_fiscal_certificates|NFSE_SIMULATION/;
    const offenders = files(ROOT)
      .filter((f) => !f.endsWith("emissorAntigo.test.ts") && !f.endsWith("database.types.ts"))
      .filter((f) => banned.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.replace(ROOT, "src/"))).toEqual([]);
  });
});
