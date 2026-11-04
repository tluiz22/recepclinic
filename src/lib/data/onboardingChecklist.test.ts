import { describe, expect, it } from "vitest";
import { CHECKLIST_GROUPS, MANUAL_ITEMS } from "./onboardingChecklist";

describe("checklist de implantação (IS3, 03/nov/2026)", () => {
  it("itens do Suporte: os cinco obrigatórios e três recomendados, nos grupos do roteiro", () => {
    expect(MANUAL_ITEMS.filter((i) => i.required).map((i) => i.key)).toEqual(["contract", "facebook_login", "whatsapp_business", "automations_off", "card_default"]);
    expect(MANUAL_ITEMS.filter((i) => !i.required).map((i) => i.key)).toEqual(["agenda_import", "business_verification", "support_number"]);
    for (const item of MANUAL_ITEMS) expect(CHECKLIST_GROUPS).toContain(item.group);
  });

  it("as mensagens automáticas e o cartão levam ao guia", () => {
    expect(MANUAL_ITEMS.find((i) => i.key === "automations_off")?.link?.href).toBe("/guia/antes-de-conectar#mensagens-automaticas");
    expect(MANUAL_ITEMS.find((i) => i.key === "card_default")?.link?.href).toBe("/guia/pagamento-meta");
  });
});
