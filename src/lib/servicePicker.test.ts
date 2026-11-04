import { describe, expect, it } from "vitest";
import { onlyServiceOf, openType, serviceTypes } from "./servicePicker";

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

  it("tipo com um só serviço: o tipo já escolhe o serviço (cliente, 03/nov)", () => {
    const list = [
      { id: "e1", category: "exam" as const },
      { id: "c1", category: "consultation" as const },
      { id: "c2", category: "consultation" as const },
    ];
    expect(onlyServiceOf(list, "exam")?.id).toBe("e1");
    expect(onlyServiceOf(list, "consultation")).toBeNull();
    expect(onlyServiceOf(list, "return_visit")).toBeNull();
    expect(onlyServiceOf(list, null)).toBeNull();
  });
});
