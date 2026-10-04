import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expectTypeOf, it } from "vitest";
import type { Database, Enums, Tables, TablesInsert } from "./database.types";

// Gerado por `npm run db:types` a partir do banco local; o CI confere que está
// em dia com as migrações. Estes testes valem no `npm run check`: um cliente
// tipado com `Database` acusa tabela ou coluna que não existe.

type TypedClient = SupabaseClient<Database>;

describe("tipos do banco", () => {
  it("conhecem as tabelas e enums do schema novo", () => {
    expectTypeOf<Tables<"clinics">>().toHaveProperty("name");
    expectTypeOf<Tables<"appointments">>().toHaveProperty("clinic_id");
    expectTypeOf<TablesInsert<"patients">>().toHaveProperty("birthdate");
    expectTypeOf<Enums<"clinic_role">>().toEqualTypeOf<"admin" | "professional" | "reception">();
  });

  it("acusam tabela do schema antigo e coluna inexistente", () => {
    // @ts-expect-error `staff_profiles` saiu na F2.1
    expectTypeOf<Tables<"staff_profiles">>();
    // @ts-expect-error `guardians` virou `contacts` na F2.3
    const query = (client: TypedClient) => client.from("guardians");
    // @ts-expect-error coluna inexistente
    expectTypeOf<Tables<"clinics">["clinica"]>();
    void query;
  });
});
