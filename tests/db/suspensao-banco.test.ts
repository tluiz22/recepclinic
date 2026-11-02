import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveBillingAccount, saveBillingContacts } from "../../src/lib/data/billing";
import { listClinicSuspensions, releaseClinicSuspension, suspendClinic } from "../../src/lib/data/suspension";
import { clinicServiceClient, createUser, deleteUsers, makePlatformStaff, withDatabase, type TestUser } from "./helpers";
import { asDb, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F12.3b — O banco recusa as gravações operacionais da clínica suspensa
// (decisão 11.3 do planejamento-faturamento-saas.md). Login da clínica: só a
// Assinatura (billing_*); o Suporte, a credencial da clínica (bot e páginas,
// calados no código) e o sistema seguem gravando.
let fixture: AgendaFixture;
let clinicId: string;
let support: TestUser;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do bloqueio no banco", "+55619866003");
  clinicId = fixture.clinicId;
  support = await createUser("bloqueio-suporte");
  await makePlatformStaff(support.id);
  await saveBillingAccount(asDb(support), clinicId, { payerName: "Clínica Ltda", payerDocument: "11222333000181", financeEmail: "fin@teste.local" });
  await suspendClinic(asDb(support), clinicId, { reason: "administrative", note: "Teste do bloqueio no banco." });
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteUsers([support]);
});

const hintOf = (result: { error: { hint?: string | null } | null }) => result.error?.hint ?? null;

describe("Suspensão no banco (F12.3b)", () => {
  it("o login da clínica não grava nas tabelas operacionais", async () => {
    const { admin, reception, ids } = fixture;
    expect(hintOf(await admin.client.from("agendas").update({ name: "Outra" }).eq("id", ids.agendaDra))).toBe("clinic_suspended");
    expect(hintOf(await admin.client.from("clinic_settings").update({ website_url: "https://x.test" }).eq("clinic_id", clinicId))).toBe("clinic_suspended");
    expect(hintOf(await admin.client.from("clinics").update({ name: "Outro nome" }).eq("id", clinicId))).toBe("clinic_suspended");
    expect(hintOf(await reception.client.from("patients").update({ full_name: "Outro" }).eq("id", ids.p1))).toBe("clinic_suspended");
    expect(hintOf(await reception.client.from("patients").insert({ clinic_id: clinicId, full_name: "Novo" }))).toBe("clinic_suspended");
    expect(hintOf(await admin.client.from("patients").delete().eq("id", ids.p2))).toBe("clinic_suspended");
  });

  it("a Assinatura segue: o Administrador altera os contatos financeiros", async () => {
    await saveBillingContacts(asDb(fixture.admin), clinicId, { financeEmail: "novo@teste.local" });
  });

  it("o Suporte e a credencial da clínica seguem gravando", async () => {
    expect((await support.client.from("agendas").update({ name: "Dra. Agenda" }).eq("id", fixture.ids.agendaDra)).error).toBeNull();
    const bot = clinicServiceClient(clinicId);
    expect((await bot.from("patients").update({ full_name: "Paciente Um" }).eq("id", fixture.ids.p1)).error).toBeNull();
  });

  it("toda tabela com clinic_id tem o bloqueio, fora as liberadas", async () => {
    const missing = await withDatabase(async (db) => {
      const { rows } = await db.query<{ table_name: string }>(`
        select c.table_name
          from information_schema.columns c
          join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
         where c.table_schema = 'public' and c.column_name = 'clinic_id'
           and c.table_name <> all (app.suspension_free_tables())
           and not exists (
             select 1 from pg_trigger g
              where g.tgrelid = format('public.%I', c.table_name)::regclass
                and g.tgfoid = 'app.guard_suspended_clinic_write'::regproc
           )`);
      return rows.map((row) => row.table_name);
    });
    expect(missing).toEqual([]);
  });

  it("liberada, o login da clínica volta a gravar", async () => {
    const [suspension] = await listClinicSuspensions(asDb(support), clinicId);
    await releaseClinicSuspension(asDb(support), suspension.id, "Fim do teste.");
    expect((await fixture.admin.client.from("agendas").update({ name: "Dra. Agenda" }).eq("id", fixture.ids.agendaDra)).error).toBeNull();
  });
});
