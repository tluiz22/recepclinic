import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dismissRecall, loadRecallDismissals } from "../../src/lib/data/relationship";
import { asDb, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { addMember, adminClient, createUser, deleteUsers, type TestUser } from "./helpers";

// Retomar contato › "Retirar da lista" (cliente, 31/out/2026): Administrador e
// Recepção retiram; o Profissional só lê; outra clínica nem lê nem grava;
// retirar de novo atualiza a hora; autor e hora vêm do banco.

let clinic: AgendaFixture;
let other: AgendaFixture;
let professional: TestUser;
const PHONE = "+5584944470001";

beforeAll(async () => {
  clinic = await setupAgendaClinic("Clínica do teste do Retirar", "849444700");
  other = await setupAgendaClinic("Outra clínica do Retirar", "849444800");
  professional = await createUser("retirar-profissional");
  await addMember(clinic.clinicId, professional.id, ["professional"]);
});

afterAll(async () => {
  await clinic.cleanup();
  await other.cleanup();
  await deleteUsers([professional]);
});

describe("Retirar da lista", () => {
  it("a Recepção retira; autor e hora vêm do banco; o Profissional lê", async () => {
    await dismissRecall(asDb(clinic.reception), clinic.clinicId, PHONE, "Marcar consulta");
    const { data } = await adminClient().from("recall_dismissals").select("dismissed_by").eq("clinic_id", clinic.clinicId).single();
    expect(data?.dismissed_by).toBe(clinic.reception.id);
    const read = await loadRecallDismissals(asDb(professional), clinic.clinicId);
    expect([...read.keys()]).toEqual([`${PHONE}:Marcar consulta`]);
  });

  it("retirar de novo atualiza a hora, sem duplicar", async () => {
    const before = (await loadRecallDismissals(asDb(clinic.admin), clinic.clinicId)).get(`${PHONE}:Marcar consulta`)!;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await dismissRecall(asDb(clinic.admin), clinic.clinicId, PHONE, "Marcar consulta");
    const after = await loadRecallDismissals(asDb(clinic.admin), clinic.clinicId);
    expect(after.size).toBe(1);
    expect(after.get(`${PHONE}:Marcar consulta`)!.getTime()).toBeGreaterThan(before.getTime());
  });

  it("o Profissional e a outra clínica não retiram; a outra clínica não lê", async () => {
    await expect(dismissRecall(asDb(professional), clinic.clinicId, PHONE, "Remarcar")).rejects.toThrow();
    await expect(dismissRecall(asDb(other.reception), clinic.clinicId, PHONE, "Remarcar")).rejects.toThrow();
    expect((await loadRecallDismissals(asDb(other.reception), clinic.clinicId)).size).toBe(0);
  });
});
