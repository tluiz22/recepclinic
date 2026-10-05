import { describe, expect, it } from "vitest";
import { AREA_LABELS, featureLabel, parseFeatureSelection } from "./features";

describe("formulário da matriz de acesso", () => {
  it("só os itens conhecidos, sem repetição, na ordem do catálogo", () => {
    expect(parseFeatureSelection(["waitlist", "whatsapp_bot", "waitlist", "inventado", "toString"])).toEqual(["whatsapp_bot", "waitlist"]);
    expect(parseFeatureSelection([])).toEqual([]);
  });

  it("rótulos das áreas e dos itens", () => {
    expect(AREA_LABELS).toEqual({ agenda: "Agenda", whatsapp: "WhatsApp", metrics: "Métricas" });
    expect(featureLabel("whatsapp_bot")).toBe("Bot de WhatsApp");
  });
});
