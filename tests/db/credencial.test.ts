import { beforeAll, describe, expect, it } from "vitest";
import { createClinicServiceClient, mintClinicServiceToken } from "../../src/lib/data/clinicService";
import { resolveClinicByBookingLink, resolveClinicByPhoneNumberId, resolveClinicByService } from "../../src/lib/data/platform";
import { adminClient, anonClient, signInSeedUser } from "./helpers";
import { createClient } from "@supabase/supabase-js";

// F3.3 — credencial limitada à clínica e descoberta da clínica, como a
// aplicação usa, contra o Supabase local.
const CLINIC_A = "0a000000-0000-4000-8000-000000000001";
const CLINIC_B = "0b000000-0000-4000-8000-000000000001";
const MISSING = "0f000000-0000-4000-8000-0000000000ff";

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

let linkA: string;
let serviceB: string;

beforeAll(async () => {
  const admin = adminClient();
  const { data: link, error: linkError } = await admin.from("booking_links").select("id").eq("clinic_id", CLINIC_A).limit(1).single();
  if (linkError) throw linkError;
  linkA = link.id;
  const { data: service, error: serviceError } = await admin.from("services").select("id").eq("clinic_id", CLINIC_B).limit(1).single();
  if (serviceError) throw serviceError;
  serviceB = service.id;
});

describe("credencial limitada (createClinicServiceClient)", () => {
  it("enxerga a própria clínica e nada da outra", async () => {
    const bot = createClinicServiceClient(CLINIC_A, env());
    const { data: clinics } = await bot.from("clinics").select("id");
    expect(clinics).toEqual([{ id: CLINIC_A }]);

    const { data: services } = await bot.from("services").select("clinic_id");
    expect(services?.length).toBeGreaterThan(0);
    expect(new Set(services?.map((row) => row.clinic_id))).toEqual(new Set([CLINIC_A]));

    const { data: otherLink } = await bot.from("booking_links").select("id").eq("clinic_id", CLINIC_B);
    expect(otherLink).toEqual([]);
  });

  it("lê o link de agendamento da própria clínica", async () => {
    const { data } = await createClinicServiceClient(CLINIC_A, env()).from("booking_links").select("id").eq("id", linkA);
    expect(data).toEqual([{ id: linkA }]);
    const { data: fromB } = await createClinicServiceClient(CLINIC_B, env()).from("booking_links").select("id").eq("id", linkA);
    expect(fromB).toEqual([]);
  });

  it("não grava na outra clínica", async () => {
    const bot = createClinicServiceClient(CLINIC_B, env());
    const { error } = await bot.from("contacts").insert({ clinic_id: CLINIC_A, full_name: "Intruso", phone: "+5585900000001" });
    expect(error).not.toBeNull();
  });

  it("token vencido ou assinado com outro segredo é recusado", async () => {
    const { supabaseUrl, supabaseAnonKey, supabaseJwtSecret } = env();
    const clientWith = (token: string) =>
      createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });

    const expired = mintClinicServiceToken(CLINIC_A, supabaseJwtSecret, { now: Date.now() - 3_600_000, ttlSeconds: 60 });
    const { data: expiredData, error: expiredError } = await clientWith(expired).from("clinics").select("id");
    expect(expiredError).not.toBeNull();
    expect(expiredData).toBeNull();

    const forged = mintClinicServiceToken(CLINIC_A, "x".repeat(40));
    const { data: forgedData, error: forgedError } = await clientWith(forged).from("clinics").select("id");
    expect(forgedError).not.toBeNull();
    expect(forgedData).toBeNull();
  });
});

describe("descoberta da clínica nas portas públicas", () => {
  it("link de agendamento → clínica do link", async () => {
    expect(await resolveClinicByBookingLink(linkA, env())).toBe(CLINIC_A);
    expect(await resolveClinicByBookingLink(MISSING, env())).toBeNull();
    expect(await resolveClinicByBookingLink("nao-e-uuid", env())).toBeNull();
  });

  it("serviço (preparo) → clínica do serviço", async () => {
    expect(await resolveClinicByService(serviceB, env())).toBe(CLINIC_B);
    expect(await resolveClinicByService(MISSING, env())).toBeNull();
  });

  it("número do WhatsApp → clínica; número desconhecido, nenhuma", async () => {
    expect(await resolveClinicByPhoneNumberId("local-phone-number-id-b", env())).toBe(CLINIC_B);
    expect(await resolveClinicByPhoneNumberId("numero-desconhecido", env())).toBeNull();
    expect(await resolveClinicByPhoneNumberId("  ", env())).toBeNull();
  });

  it("as funções de descoberta são só da plataforma", async () => {
    const callers = [
      { who: "anônimo", client: anonClient() },
      { who: "Administrador", client: await signInSeedUser("admin@exemplo-saude.local") },
      { who: "Suporte", client: await signInSeedUser("suporte@recepclinic.local") },
      { who: "bot", client: createClinicServiceClient(CLINIC_A, env()) },
    ];
    const allowed: string[] = [];
    for (const { who, client } of callers) {
      const { error: linkError } = await client.rpc("resolve_booking_link_clinic", { p_link_id: linkA });
      const { error: serviceError } = await client.rpc("resolve_service_clinic", { p_service_id: serviceB });
      if (!linkError) allowed.push(`${who}: link`);
      if (!serviceError) allowed.push(`${who}: serviço`);
    }
    expect(allowed).toEqual([]);
  });
});
