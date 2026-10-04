import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, clinicServiceClient, signInSeedUser, withDatabase } from "./helpers";

// Varredura de isolamento sobre os dados de teste (supabase/seed.sql): as
// tabelas são descobertas pelo catálogo, então uma tabela nova entra sozinha.
const CLINIC_A = "0a000000-0000-4000-8000-000000000001"; // Clínica Exemplo Saúde
const CLINIC_B = "0b000000-0000-4000-8000-000000000001"; // Odonto Exemplo

// Exceções deliberadas, cada uma com o motivo:
// - platform_audit_log: o registro do Suporte sobrevive à exclusão da clínica
//   (sem FK) e só é gravado por gatilho (sem gatilho de auditoria próprio).
// - clinic_usage_monthly: só gatilhos gravam; o Suporte não altera.
// - platform_access_log: leituras do Suporte (F3.2); como o registro das
//   alterações, sobrevive à exclusão da clínica e só a função grava.
const NO_DIRECT_FK = new Set(["platform_audit_log", "platform_access_log"]);
const NO_AUDIT_TRIGGER = new Set(["platform_audit_log", "platform_access_log", "clinic_usage_monthly"]);
const NOT_IN_DATA_SWEEP = new Set(["platform_audit_log"]);

let clinicTables: string[] = [];
let allTables: string[] = [];

const countRows = (table: string, clinicId: string) =>
  withDatabase(async (db) => {
    const column = table === "clinics" ? "id" : "clinic_id";
    const { rows } = await db.query(`select count(*)::int as n from public.${table} where ${column} = $1`, [clinicId]);
    return rows[0].n as number;
  });

beforeAll(async () => {
  await withDatabase(async (db) => {
    const { rows: tables } = await db.query(
      `select c.relname as name
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by 1`,
    );
    allTables = tables.map((row) => row.name);
    const { rows: withClinic } = await db.query(
      `select table_name as name from information_schema.columns
        where table_schema = 'public' and column_name = 'clinic_id'
        order by 1`,
    );
    clinicTables = withClinic.map((row) => row.name);
  });
  expect(clinicTables.length).toBeGreaterThan(25);
});

describe("estrutura (catálogo)", () => {
  it("toda tabela tem RLS ligado", async () => {
    const withoutRls = await withDatabase(async (db) => {
      const { rows } = await db.query(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
      );
      return rows.map((row) => row.relname);
    });
    expect(withoutRls).toEqual([]);
  });

  it("toda tabela com clinic_id aponta direto para a clínica, com exclusão em cascata", async () => {
    const missing = await withDatabase(async (db) => {
      const { rows } = await db.query(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = any($1)
            and not exists (
              select 1 from pg_constraint k
               where k.conrelid = c.oid and k.contype = 'f'
                 and k.confrelid = 'public.clinics'::regclass
                 and k.confdeltype = 'c' and array_length(k.conkey, 1) = 1
            )`,
        [clinicTables],
      );
      return rows.map((row) => row.relname).filter((name) => !NO_DIRECT_FK.has(name));
    });
    expect(missing).toEqual([]);
  });

  it("toda tabela com clinic_id registra as alterações do Suporte", async () => {
    const missing = await withDatabase(async (db) => {
      const { rows } = await db.query(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = any($1)
            and not exists (
              select 1 from pg_trigger t
               where t.tgrelid = c.oid and not t.tgisinternal
                 and t.tgfoid = 'app.audit_platform_staff_write'::regproc
            )`,
        [clinicTables],
      );
      return rows.map((row) => row.relname).filter((name) => !NO_AUDIT_TRIGGER.has(name));
    });
    expect(missing).toEqual([]);
  });
});

describe("varredura de isolamento (dados de teste)", () => {
  let adminB: SupabaseClient;
  let support: SupabaseClient;
  let dataTables: string[];

  beforeAll(async () => {
    adminB = await signInSeedUser("admin@odonto-exemplo.local");
    support = await signInSeedUser("suporte@recepclinic.local");
    dataTables = ["clinics", ...clinicTables.filter((name) => !NOT_IN_DATA_SWEEP.has(name))];
  });

  it("cobertura: a clínica de exemplo tem dados em todas as tabelas", async () => {
    const empty: string[] = [];
    for (const table of dataTables) {
      if ((await countRows(table, CLINIC_A)) === 0) empty.push(table);
    }
    expect(empty).toEqual([]);
  });

  it("controle positivo: o Suporte enxerga os dados da clínica de exemplo em todas as tabelas", async () => {
    const hidden: string[] = [];
    for (const table of dataTables) {
      const column = table === "clinics" ? "id" : "clinic_id";
      const { data, error } = await support.from(table).select(column).eq(column, CLINIC_A).limit(1);
      if (error || !data?.length) hidden.push(`${table}${error ? ` (${error.code})` : ""}`);
    }
    expect(hidden).toEqual([]);
  });

  const outsiders = () => [
    { who: "Administrador de outra clínica", client: adminB },
    { who: "bot de outra clínica", client: clinicServiceClient(CLINIC_B) },
    { who: "acesso anônimo", client: anonClient() },
  ];

  it("leitura: ninguém de fora vê uma linha da clínica de exemplo", async () => {
    const leaks: string[] = [];
    for (const { who, client } of outsiders()) {
      for (const table of dataTables) {
        const column = table === "clinics" ? "id" : "clinic_id";
        const { data } = await client.from(table).select(column).eq(column, CLINIC_A).limit(1);
        if (data?.length) leaks.push(`${who}: ${table}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("escrita: ninguém de fora apaga nem altera dados da clínica de exemplo", async () => {
    const before = new Map<string, number>();
    for (const table of dataTables) before.set(table, await countRows(table, CLINIC_A));

    for (const { client } of outsiders()) {
      for (const table of dataTables) {
        const column = table === "clinics" ? "id" : "clinic_id";
        await client.from(table).delete().eq(column, CLINIC_A);
        // Tentar mover as linhas para a própria clínica (B).
        if (table !== "clinics") await client.from(table).update({ clinic_id: CLINIC_B }).eq("clinic_id", CLINIC_A);
      }
    }

    const changed: string[] = [];
    for (const table of dataTables) {
      const after = await countRows(table, CLINIC_A);
      if (after !== before.get(table)) changed.push(`${table}: ${before.get(table)} → ${after}`);
    }
    expect(changed).toEqual([]);
  });

  it("o bot da clínica de exemplo enxerga a própria clínica, e não a outra", async () => {
    const bot = clinicServiceClient(CLINIC_A);
    const { data: own } = await bot.from("appointments").select("clinic_id").limit(1);
    expect(own).toEqual([{ clinic_id: CLINIC_A }]);
    const { data: other } = await bot.from("appointments").select("clinic_id").eq("clinic_id", CLINIC_B);
    expect(other).toEqual([]);
  });

  it("todas as tabelas do banco entraram na varredura ou têm exceção registrada", () => {
    const covered = new Set([...dataTables, ...NOT_IN_DATA_SWEEP, "platform_staff"]);
    expect(allTables.filter((name) => !covered.has(name))).toEqual([]);
  });
});
