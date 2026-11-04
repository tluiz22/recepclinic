import { describe, expect, it } from "vitest";
import { guideEmail, inviteEmail } from "./email";
import { GUIDE_BEFORE_CONNECT_PATH, GUIDE_META_PAYMENT_PATH } from "./guides";

describe("guias para o dono da clínica (IS1, 03/nov/2026)", () => {
  it("caminhos públicos", () => {
    expect(GUIDE_BEFORE_CONNECT_PATH).toBe("/guia/antes-de-conectar");
    expect(GUIDE_META_PAYMENT_PATH).toBe("/guia/pagamento-meta");
  });

  it("e-mail do guia, com o botão para a página", () => {
    const email = guideEmail("adm@clinica.test", { clinicName: "Clínica X", link: "https://app.test/guia/antes-de-conectar" });
    expect(email.subject).toBe("Antes de conectar o WhatsApp da Clínica X ao RecepClinic");
    expect(email.html).toContain('href="https://app.test/guia/antes-de-conectar"');
    expect(email.text).toContain("Abrir o guia: https://app.test/guia/antes-de-conectar");
  });

  it("convite: o guia só quando informado (primeiro Administrador da clínica nova)", () => {
    const base = { clinicName: "Clínica X", link: "https://app.test/api/admin/auth/confirmar?x=1" };
    expect(inviteEmail("a@b.test", base).text).not.toContain("/guia/");
    expect(inviteEmail("a@b.test", { ...base, guideLink: "https://app.test/guia/antes-de-conectar" }).text).toContain("https://app.test/guia/antes-de-conectar");
  });
});
