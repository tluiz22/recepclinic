import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, withDatabase, type TestUser } from "./helpers";

// Frente Usabilidade, U2: os sinais da aba Usabilidade são só do Suporte e vêm de dados já gravados.

let clinicA: string;
let clinicB: string;
let staff: TestUser;
let admin: TestUser;
const range = { p_start: "2000-01-01T00:00:00Z", p_end: "2100-01-01T00:00:00Z" };

beforeAll(async () => {
  clinicA = await createClinic("Usabilidade A");
  clinicB = await createClinic("Usabilidade B");
  staff = await createUser("usab-suporte");
  admin = await createUser("usab-admin");
  await makePlatformStaff(staff.id);
  await addMember(clinicA, admin.id, ["admin"]);
  await withDatabase(async (db) => {
    const s = (await db.query("insert into public.portal_sessions (clinic_id, token_hash, expires_at) values ($1, 'h-usab', now() + interval '1 hour') returning id", [clinicA])).rows[0].id;
    for (const attempts of [0, 2]) {
      await db.query(
        "insert into public.portal_codes (clinic_id, session_id, phone, code_hash, attempts, expires_at) values ($1, $2, '+5584999990000', 'x', $3, now() + interval '10 minutes')",
        [clinicA, s, attempts],
      );
    }
    await db.query(
      "insert into public.portal_sessions (clinic_id, token_hash, expires_at) values ($1, 'h-usab-b', now() + interval '1 hour')",
      [clinicB],
    );
  });
});

afterAll(async () => {
  await deleteClinics([clinicA, clinicB]);
  await deleteUsers([staff, admin]);
});

describe("metrics_usability", () => {
  it("o Suporte recebe os cinco sinais, com os códigos errados contados", async () => {
    const { data, error } = await staff.client.rpc("metrics_usability", { p_clinic_id: clinicA, ...range });
    expect(error).toBeNull();
    expect((data as { signal: string }[]).map((r) => r.signal).sort()).toEqual(["admin_cancel_5min", "code_wrong", "hold_expired", "portal_cancel_1h", "resched_1h"]);
    expect(data).toEqual(expect.arrayContaining([{ signal: "code_wrong", affected: 1, base: 2 }]));
  });

  it("uma clínica não mistura com a outra", async () => {
    const { data } = await staff.client.rpc("metrics_usability", { p_clinic_id: clinicB, ...range });
    expect(data).toEqual(expect.arrayContaining([{ signal: "code_wrong", affected: 0, base: 0 }]));
  });

  it("o Administrador da clínica não recebe nada", async () => {
    const { data } = await admin.client.rpc("metrics_usability", { p_clinic_id: clinicA, ...range });
    expect((data as { affected: number; base: number }[]).every((r) => r.affected === 0 && r.base === 0)).toBe(true);
  });
});
