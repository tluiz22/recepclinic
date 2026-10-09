import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS, withSecurityHeaders } from "./securityHeaders";

describe("cabeçalhos de segurança (F9.1)", () => {
  it("põe todos na resposta comum", () => {
    const response = withSecurityHeaders(new Response("ok", { headers: { "Content-Type": "text/html" } }));
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(response.headers.get(name)).toBe(value);
    expect(response.headers.get("Content-Type")).toBe("text/html");
  });

  it("copia a resposta de cabeçalhos imutáveis (redirecionamento), mantendo status e destino", async () => {
    const original = Response.redirect("https://app.recepclinic.com.br/admin/login", 302);
    const response = withSecurityHeaders(original);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://app.recepclinic.com.br/admin/login");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("não libera moldura nem indexação", () => {
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(SECURITY_HEADERS["X-Robots-Tag"]).toContain("noindex");
  });
});
