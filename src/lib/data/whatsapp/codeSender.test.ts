import { describe, expect, it } from "vitest";
import { createPortalCodeSender, portalCodeTemplateState } from "./codeSender";

const config = { phoneNumberId: "1380810041790028", wabaId: "1608311683725577", token: "tok-recepclinic" };

function fakeFetch(respond: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const { status = 200, body } = respond(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetcher, calls };
}

describe("código do portal pelo número do RecepClinic (seção 14)", () => {
  it("sem as variáveis, não há remetente", () => {
    expect(createPortalCodeSender(null)).toBeNull();
  });

  it("manda o template de autenticação pelo número e token do RecepClinic, sem guardar o código no texto", async () => {
    const meta = fakeFetch(() => ({ body: { messages: [{ id: "wamid.1" }] } }));
    const outcome = await createPortalCodeSender(config, meta.fetcher)!.send("+5584999990001", "482913");
    expect(outcome).toMatchObject({ sent: true, messageId: "wamid.1" });
    expect(outcome.body).not.toContain("482913");
    expect(meta.calls).toHaveLength(1);
    expect(meta.calls[0].url).toMatch(/\/1380810041790028\/messages$/);
    expect(new Headers(meta.calls[0].init?.headers).get("Authorization")).toBe("Bearer tok-recepclinic");
    expect(JSON.parse(String(meta.calls[0].init?.body))).toMatchObject({
      to: "5584999990001",
      type: "template",
      template: {
        name: "rc_codigo_portal_v1",
        language: { code: "pt_BR" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "482913" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "482913" }] },
        ],
      },
    });
  });

  it("recusa da Meta (ex.: 131042, pagamento) volta como não enviado, com o motivo", async () => {
    const meta = fakeFetch(() => ({ status: 400, body: { error: { code: 131042, message: "Business eligibility payment issue" } } }));
    const outcome = await createPortalCodeSender(config, meta.fetcher)!.send("+5584999990001", "111111");
    expect(outcome.sent).toBe(false);
    expect(outcome.sent === false && outcome.reason).toMatch(/131042/);
  });

  it("situação do template na conta do RecepClinic, para o Suporte", async () => {
    expect(await portalCodeTemplateState(null)).toEqual({ status: "unconfigured" });
    const approved = fakeFetch(() => ({ body: { data: [{ id: "1014112705045978", name: "rc_codigo_portal_v1", language: "pt_BR", status: "APPROVED" }] } }));
    expect(await portalCodeTemplateState(config, approved.fetcher)).toEqual({ status: "approved", rejectionReason: null });
    expect(approved.calls[0].url).toContain("/1608311683725577/message_templates?");
    const none = fakeFetch(() => ({ body: { data: [] } }));
    expect(await portalCodeTemplateState(config, none.fetcher)).toEqual({ status: "missing", rejectionReason: null });
    const down = fakeFetch(() => ({ status: 400, body: { error: { code: 100, message: "Unsupported get request" } } }));
    expect(await portalCodeTemplateState(config, down.fetcher)).toMatchObject({ status: "error" });
  });
});
