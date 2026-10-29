import { describe, expect, it } from "vitest";
import { openType, serviceTypes } from "./servicePicker";

const services = [
  { category: "exam" as const },
  { category: "consultation" as const },
  { category: "consultation" as const },
];

describe("escolha do serviço no Marcar (C6)", () => {
  it("só os tipos que têm serviço, na ordem Consulta, Retorno, Exame", () => {
    expect(serviceTypes(services)).toEqual([
      { category: "consultation", count: 2 },
      { category: "exam", count: 1 },
    ]);
  });

  it("tipo aberto: o pedido, senão o do serviço escolhido, senão nenhum", () => {
    expect(openType(null, services, null)).toBeNull();
    expect(openType("exam", services, null)).toBe("exam");
    expect(openType("return_visit", services, null)).toBeNull();
    expect(openType(null, services, { category: "exam" })).toBe("exam");
    expect(openType("consultation", services, { category: "exam" })).toBe("consultation");
    expect(openType("qualquer", services, { category: "consultation" })).toBe("consultation");
  });
});
