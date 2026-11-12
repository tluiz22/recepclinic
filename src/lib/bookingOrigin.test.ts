import { describe, expect, it } from "vitest";
import { bookingOriginText } from "./bookingOrigin";

const tz = "America/Fortaleza";

describe("bookingOriginText", () => {
  it("portal com o lugar, a entrada ou nenhum dos dois", () => {
    const createdAt = new Date("2026-11-08T13:05:00Z");
    expect(bookingOriginText({ bookingChannel: "portal", portalEntry: "professional_link", createdAt }, tz, null)).toBe(
      "Portal · link do profissional, marcada pelo paciente em 08/11 às 10:05",
    );
    expect(bookingOriginText({ bookingChannel: "portal", portalEntry: "clinic_link", portalPlace: "instagram", createdAt }, tz, null)).toBe(
      "Portal · Instagram, marcada pelo paciente em 08/11 às 10:05",
    );
    expect(bookingOriginText({ bookingChannel: "portal" }, tz, null)).toBe("Portal, marcada pelo paciente");
  });
  it("bot, recepção e importado", () => {
    expect(bookingOriginText({ bookingChannel: "whatsapp_bot" }, tz, null)).toBe("WhatsApp · bot");
    expect(bookingOriginText({ bookingChannel: "admin" }, tz, "Carla")).toBe("Recepção · Carla");
    expect(bookingOriginText({ bookingChannel: "admin" }, tz, null)).toBe("Recepção");
    expect(bookingOriginText({ bookingChannel: "admin", imported: true }, tz, "Carla")).toBe("Importado da agenda anterior");
  });
});
