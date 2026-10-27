import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getReceptionHours, saveReceptionHours } from "../../src/lib/data/config/receptionHours";
import { DataError } from "../../src/lib/data/errors";
import type { ReceptionHours } from "../../src/lib/receptionHours";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F8.5b — Horário da recepção: sugerido pelas agendas até a clínica salvar;
// só o Administrador grava; erro por dia.

let fx: AgendaFixture;
const weekday = { open: "08:00", close: "18:00" };
const hours: ReceptionHours = [null, weekday, weekday, weekday, weekday, weekday, { open: "08:00", close: "12:00" }];

beforeAll(async () => {
  fx = await setupAgendaClinic("Clínica (horário da recepção)", "+55849777300");
});

afterAll(async () => {
  await fx.cleanup();
});

describe("horário da recepção (F8.5b)", () => {
  it("sem salvar: sugerido pelos horários ativos das agendas (segunda, 8h às 15h)", async () => {
    expect(await getReceptionHours(asDb(fx.reception), fx.clinicId)).toEqual({
      hours: [null, { open: "08:00", close: "15:00" }, null, null, null, null, null],
      saved: false,
    });
  });

  it("o Administrador salva; a Recepção lê o salvo", async () => {
    await saveReceptionHours(asDb(fx.admin), fx.clinicId, hours);
    expect(await getReceptionHours(asDb(fx.reception), fx.clinicId)).toEqual({ hours, saved: true });
  });

  it("a Recepção não grava", async () => {
    expect(await codeOf(() => saveReceptionHours(asDb(fx.reception), fx.clinicId, [null, null, null, null, null, null, null]))).not.toBe("ok");
    expect((await getReceptionHours(asDb(fx.admin), fx.clinicId)).hours).toEqual(hours);
  });

  it("fechamento antes da abertura: erro no dia, nada gravado", async () => {
    const wrong: ReceptionHours = [...hours];
    wrong[2] = { open: "18:00", close: "08:00" };
    const error = await saveReceptionHours(asDb(fx.admin), fx.clinicId, wrong).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).fields).toEqual({ abre_2: "Terça: o fechamento precisa ser depois da abertura." });
    expect((await getReceptionHours(asDb(fx.admin), fx.clinicId)).hours).toEqual(hours);
  });
});
