import { describe, expect, it } from "vitest";
import { summarizeOrigins } from "./performance";

describe("summarizeOrigins", () => {
  it("sem marcações: tudo zerado e sem detalhe", () => {
    expect(summarizeOrigins([])).toEqual({ total: 0, reception: 0, whatsapp: 0, portalLink: 0, entries: [], places: [], placeUnknown: 0 });
  });

  it("detalha o link do portal e esconde o que não tem valor", () => {
    const o = summarizeOrigins([
      { origin: "reception", entry: null, place: null, total: 4 },
      { origin: "whatsapp", entry: "whatsapp", place: null, total: 3 },
      { origin: "portal_link", entry: "clinic_link", place: "instagram", total: 5 },
      { origin: "portal_link", entry: "clinic_link", place: null, total: 1 },
      { origin: "portal_link", entry: "professional_link", place: "site", total: 2 },
    ]);
    expect(o).toMatchObject({ total: 15, reception: 4, whatsapp: 3, portalLink: 8, placeUnknown: 1 });
    expect(o.entries).toEqual([{ key: "clinic_link", total: 6 }, { key: "professional_link", total: 2 }]);
    expect(o.places).toEqual([{ key: "instagram", total: 5 }, { key: "site", total: 2 }]);
  });
});
