import { describe, expect, it } from "vitest";
import { billingNoticeEmail } from "../email";
import { suspendFromDate } from "./billingNotices";

// F12.7: textos dos avisos de cobrança e a data da suspensão possível (item 20).
const base = { clinicName: "Clínica Sorriso", what: "Mensalidade", amount: "R$ 299,00", dueDate: "10/11/2026", suspendFrom: "25/11/2026", paidOn: null, payLink: "https://fatura", panelLink: "https://painel" };

describe("avisos de cobrança (F12.7)", () => {
  it("suspensão possível no 15º dia de atraso", () => {
    expect(suspendFromDate("2026-11-10")).toBe("2026-11-25");
    expect(suspendFromDate("2026-12-20")).toBe("2027-01-04");
  });

  it("atraso: data da suspensão possível e o link de pagar", () => {
    const d3 = billingNoticeEmail("fin@x.y", { ...base, kind: "overdue_d3" });
    expect(d3.subject).toBe("cobrança em atraso da Clínica Sorriso no RecepClinic");
    expect(d3.text).toContain("pode ser suspensa a partir de 25/11/2026");
    expect(d3.text).toContain("Pagar agora: https://fatura");
    const d14 = billingNoticeEmail("fin@x.y", { ...base, kind: "overdue_d14" });
    expect(d14.subject).toMatch(/^Último aviso/);
    expect(d14.text).toContain("A partir de amanhã, 25/11/2026");
  });

  it("pagamento reconhecido", () => {
    const email = billingNoticeEmail("fin@x.y", { ...base, kind: "payment_confirmed", paidOn: "09/11/2026" });
    expect(email.subject).toBe("Pagamento reconhecido: Clínica Sorriso no RecepClinic");
    expect(email.text).toContain("pago em 09/11/2026");
    expect(email.text).not.toContain("suspensa");
  });
});
