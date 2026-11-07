import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { createInsurancePlan } from "../../src/lib/data/config/insurance";
import { openConversation } from "../../src/lib/data/whatsapp/conversations";
import { createBot } from "../../src/lib/data/whatsapp/bot/engine";
import { clinicTermsOf, composeAnswer } from "../../src/lib/data/whatsapp/bot/knowledge/answers";
import { loadKbClinicData } from "../../src/lib/data/whatsapp/bot/knowledge/clinicData";
import { compileKnowledge, matchQuestion, type KbContent } from "../../src/lib/knowledge/match";
import catalog from "../../src/lib/knowledge/__fixtures__/catalogo-inicial.json";
import type { ClinicSender } from "../../src/lib/data/whatsapp/send";
import { asDb, setupAgendaClinic, type AgendaFixture, linkPlanToAllProfessionals } from "./agendaFixture";
import { adminClient } from "./helpers";

// BC 3.2 — fontes da base: os dados saem só da clínica da credencial do bot.
const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const sender = (label: string): ClinicSender => ({
  clinicId: "",
  clinicLabel: label,
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "teste" }),
  text: async () => ({ sent: false, reason: "teste" }),
  list: async () => ({ sent: false, reason: "teste" }),
  buttons: async () => ({ sent: false, reason: "teste" }),
});

const kb = compileKnowledge(1, catalog as KbContent);
let a: AgendaFixture;
let b: AgendaFixture;

async function botOf(clinicId: string, tokenClinicId = clinicId, label = "da Clínica") {
  const db = createClinicServiceClient(tokenClinicId, env());
  const convo = await openConversation(db, clinicId, "+5585999990001", null);
  return createBot({ db, clinicId, sender: sender(label), now: new Date() }, convo);
}

async function ask(clinicId: string, text: string) {
  const data = await loadKbClinicData(await botOf(clinicId, clinicId, clinicId === a.clinicId ? "da Clínica A" : "da Clínica B"));
  const m = matchQuestion(kb, text, clinicTermsOf(data));
  if (m.kind !== "answer") return { data, answer: null };
  return { data, answer: composeAnswer(kb, m.entry, m.terms, text, data) };
}

beforeAll(async () => {
  a = await setupAgendaClinic("Clínica A das fontes", "859771100");
  b = await setupAgendaClinic("Clínica B das fontes", "859771200");
  const unimed = await createInsurancePlan(asDb(a.admin), a.clinicId, { name: "Unimed", alternativeNames: [], ansCode: null });
  const amil = await createInsurancePlan(asDb(b.admin), b.clinicId, { name: "Amil", alternativeNames: [], ansCode: null });
  await linkPlanToAllProfessionals(a.clinicId, unimed.id);
  await linkPlanToAllProfessionals(b.clinicId, amil.id);
  await adminClient().from("clinic_settings").update({ bot_payment_info: "Pix da clínica A", website_url: "https://a.exemplo.test" }).eq("clinic_id", a.clinicId);
  await adminClient().from("clinic_settings").update({ bot_payment_info: "Dinheiro da clínica B", website_url: null }).eq("clinic_id", b.clinicId);
  await adminClient().from("services").update({ price_cents: 99900 }).eq("id", b.ids.consulta);
});

afterAll(async () => {
  await a.cleanup();
  await b.cleanup();
});

describe("dados de cada clínica", () => {
  it("a clínica A recebe só o cadastro dela", async () => {
    const { data } = await ask(a.clinicId, "oi");
    expect(data.insurance.plans.map((p) => p.name)).toEqual(["Unimed"]);
    expect(data.paymentInfo).toBe("Pix da clínica A");
    expect(data.website).toBe("https://a.exemplo.test");
    expect(data.catalog.services.every((s) => Object.values(a.ids).includes(s.id))).toBe(true);
    expect(data.professionals.length).toBeGreaterThan(0);
  });

  it("mesma pergunta, respostas diferentes por clínica", async () => {
    expect((await ask(a.clinicId, "aceitam unimed?")).answer).toMatchObject({ text: "Sim, atendemos *Unimed*." });
    expect((await ask(b.clinicId, "aceitam unimed?")).answer).toMatchObject({ text: "Não encontrei *Unimed* entre os convênios que atendemos: Amil." });
    const priceA = (await ask(a.clinicId, "quanto custa a consulta?")).answer as { text: string };
    const priceB = (await ask(b.clinicId, "quanto custa a consulta?")).answer as { text: string };
    expect(priceA.text).toContain("Pix da clínica A");
    expect(priceA.text).not.toContain("999");
    expect(priceB.text).toContain("Dinheiro da clínica B");
    expect(priceB.text.replace(/ /g, " ")).toContain("R$ 999,00");
  });

  it("sem o dado na clínica, não responde", async () => {
    expect((await ask(b.clinicId, "vocês têm site?")).answer).toBeNull();
  });

  it("alteração no cadastro vale na mensagem seguinte (sem cache dos dados da clínica)", async () => {
    await adminClient().from("clinic_settings").update({ bot_payment_info: "Só cartão" }).eq("clinic_id", a.clinicId);
    expect((await ask(a.clinicId, "aceita pix?")).answer).toMatchObject({ text: "Formas de pagamento: Só cartão" });
    await adminClient().from("insurance_plans").update({ is_active: false }).eq("clinic_id", a.clinicId);
    expect((await ask(a.clinicId, "aceitam unimed?")).answer).toBeNull();
  });

  it("credencial de uma clínica não lê os dados da outra", async () => {
    await expect(botOf(b.clinicId, a.clinicId).then(loadKbClinicData)).rejects.toThrow();
  });
});
