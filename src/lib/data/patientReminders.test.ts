import { describe, expect, it } from "vitest";
import { DataError } from "./errors";
import { cleanReminder, REMINDER_MAX } from "./patientReminders";

// Lembretes da equipe (CRM P3): texto de 1 a 500 e data; ao criar, nunca antes de hoje.

const fails = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof DataError ? Object.keys(error.fields) : "outro";
  }
  return null;
};

describe("cleanReminder", () => {
  it("tira os espaços das pontas e aceita hoje e depois", () => {
    expect(cleanReminder("  Cobrar a guia  ", "2026-10-28", "2026-10-28")).toEqual({ body: "Cobrar a guia", dueOn: "2026-10-28" });
    expect(cleanReminder("Ligar", "2026-11-05", "2026-10-28").dueOn).toBe("2026-11-05");
  });

  it("recusa vazio, longo, data inválida e, ao criar, data no passado", () => {
    expect(fails(() => cleanReminder("   ", "2026-10-28", "2026-10-28"))).toEqual(["body"]);
    expect(fails(() => cleanReminder("x".repeat(REMINDER_MAX + 1), "2026-10-28", "2026-10-28"))).toEqual(["body"]);
    expect(fails(() => cleanReminder("Ligar", "", "2026-10-28"))).toEqual(["due_on"]);
    expect(fails(() => cleanReminder("Ligar", "2026-02-30", "2026-10-28"))).toEqual(["due_on"]);
    expect(fails(() => cleanReminder("Ligar", "2026-10-27", "2026-10-28"))).toEqual(["due_on"]);
  });

  it("ao corrigir, vale data no passado (o lembrete atrasado)", () => {
    expect(cleanReminder("Ligar", "2026-10-01", null).dueOn).toBe("2026-10-01");
  });
});
