import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

// Jornada do bot, E3 (cliente, 31/out/2026): número novo marcando para outra
// pessoa informa o paciente primeiro (nome completo e nascimento) e depois
// quem escreve (paciente menor: "o responsável"); a consulta com idade limite
// na clínica avisa antes da identificação, com o profissional escolhido (ou a
// clínica, no "Primeiro horário"). Clínica da agenda sem convênios.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "e3-numero";
type Sent = { to: string; kind: "text" | "list" | "buttons"; body: string; options: { id: string; title: string }[] };

let f: AgendaFixture;
let sent: Sent[] = [];
let seq = 0;

const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica Pediatria E3",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "sem template no teste" }),
  text: async (to, body) => (sent.push({ to, kind: "text", body, options: [] }), { sent: true, messageId: `wamid.e3.out.${++seq}`, body }),
  list: async (to: string, body: string, _button: string, sections: ListSection[]) => (
    sent.push({ to, kind: "list", body, options: sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title }))) }),
    { sent: true, messageId: `wamid.e3.out.${++seq}` }
  ),
  buttons: async (to: string, body: string, buttons: ReplyButton[]) => (
    sent.push({ to, kind: "buttons", body, options: buttons }),
    { sent: true, messageId: `wamid.e3.out.${++seq}` }
  ),
};

const deps = (): WebhookDeps => ({
  resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
  clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
  senderFor: async () => sender,
});

async function say(phone: string, input: string | { id: string }): Promise<Sent[]> {
  sent = [];
  const message =
    typeof input === "string"
      ? { id: `wamid.e3.in.${++seq}`, from: phone.slice(1), type: "text", text: { body: input } }
      : { id: `wamid.e3.in.${++seq}`, from: phone.slice(1), type: "interactive", interactive: { list_reply: { id: input.id, title: "" } } };
  const summary = await processWebhook(
    { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, messages: [message] } }] }] },
    deps(),
    new Date(),
  );
  expect(summary.errors).toBe(0);
  return sent;
}

const optionId = (reply: Sent[], titleStart: string) => reply.at(-1)!.options.find((o) => o.title.includes(titleStart))!.id;
const bodies = (reply: Sent[]) => reply.map((m) => m.body);

async function settings(values: { profile?: "pediatric" | "mixed"; consultation_age_limit_years?: number | null }) {
  await adminClient().from("clinic_settings").update(values).eq("clinic_id", f.clinicId);
}

async function lastLinkPatient(phone: string) {
  const { data } = await adminClient()
    .from("booking_links")
    .select("patient_id, patients ( full_name, birthdate, contacts ( full_name ) )")
    .eq("clinic_id", f.clinicId)
    .eq("contact_phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data as unknown as { patients: { full_name: string; birthdate: string; contacts: { full_name: string } } };
}

/** "Oi" › Consultas › Marcar consulta (consulta única) › profissional; Dr. Segundo só tem consultório. */
async function consultationWith(phone: string, professional: "Dr. Segundo" | "Primeiro horário"): Promise<Sent[]> {
  await adminClient().from("conversation_state").update({ state: "WELCOME", context: {} }).eq("clinic_id", f.clinicId).eq("contact_phone", phone);
  await say(phone, "Oi");
  await say(phone, "1");
  const agendas = await say(phone, "1");
  let reply = await say(phone, { id: optionId(agendas, professional) });
  if (reply.at(-1)!.body === "Prefere consultório ou atendimento domiciliar?") reply = await say(phone, "1");
  return reply;
}

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Pediatria E3", "+55849912280");
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "e3-waba", status: "connected" });
  await settings({ profile: "pediatric", consultation_age_limit_years: 12 });
});

afterAll(async () => f.cleanup());

describe("clínica Pediátrica com idade limite", () => {
  it("consulta, número novo: aviso com o profissional; criança, nascimento, responsável, conferência e link", async () => {
    const phone = "+5584991228099";
    let reply = await consultationWith(phone, "Dr. Segundo");
    // Pediátrica: a consulta não pergunta "para quem".
    expect(bodies(reply).slice(-2)).toEqual(["Dr. Segundo atende pacientes até 11 anos.", "Qual é o nome completo da criança?"]);
    reply = await say(phone, "Lia Pereira Costa");
    expect(reply[0].body).toBe("Qual a data de nascimento da criança? (formato dd/mm/aaaa)");
    reply = await say(phone, "05/05/2019");
    expect(reply[0].body).toBe("Qual é o nome completo do responsável?");
    reply = await say(phone, "Paula Pereira");
    expect(reply[0].body).toBe("Confira o nome do responsável: *Paula Pereira*\n\nEstá correto? Responda Sim ou Não.");
    reply = await say(phone, "não");
    expect(reply[0].body).toBe("Qual é o nome completo do responsável?");
    await say(phone, "Paula Pereira Costa");
    reply = await say(phone, "sim");
    expect(reply[0].body).toContain("*Lia Pereira Costa*");
    expect(reply[0].body).toContain("*05/05/2019*");
    reply = await say(phone, "sim");
    expect(reply[0].body).toContain("/agendar/");
    // O número da conversa continua sendo o que recebe os lembretes: o responsável é o contato dele.
    expect((await lastLinkPatient(phone)).patients).toEqual({
      full_name: "Lia Pereira Costa",
      birthdate: "2019-05-05",
      contacts: { full_name: "Paula Pereira Costa" },
    });
  });

  it("\"Primeiro horário\": o aviso usa a clínica", async () => {
    const reply = await consultationWith("+5584991228098", "Primeiro horário");
    expect(bodies(reply).slice(-2)).toEqual(["A clínica atende pacientes até 11 anos.", "Qual é o nome completo da criança?"]);
  });

  it("criança acima do limite: a marcação incompatível não segue", async () => {
    const phone = "+5584991228097";
    await consultationWith(phone, "Dr. Segundo");
    await say(phone, "Caio Alves");
    const reply = await say(phone, "01/01/2012");
    expect(reply.at(-1)).toMatchObject({ kind: "buttons", body: "Dr. Segundo atende pacientes até 11 anos.\n\nDeseja agendar para outra criança?" });
  });

  it("criança já cadastrada no número: reaproveita o cadastro, sem pedir o responsável", async () => {
    const phone = "+5584991228001"; // contato do Paciente Um (2020)
    await consultationWith(phone, "Dr. Segundo");
    // Contato conhecido: a data acha o cadastro.
    let reply = await say(phone, "01/01/2020");
    expect(reply[0].body).toContain("*Paciente Um*");
    reply = await say(phone, "sim");
    expect(reply[0].body).toContain("/agendar/");
  });

  it("exame: \"para quem\", a mesma ordem e sem o aviso da consulta", async () => {
    const phone = "+5584991228096";
    await adminClient().from("conversation_state").update({ state: "WELCOME", context: {} }).eq("clinic_id", f.clinicId).eq("contact_phone", phone);
    await say(phone, "Oi");
    await say(phone, "2"); // Exames
    await say(phone, "1"); // Marcar exame
    let reply = await say(phone, "1"); // Exame
    expect(reply.at(-1)!.body).toBe("É para você ou para outra pessoa?");
    reply = await say(phone, { id: "for_other" });
    expect(bodies(reply)).toEqual(["Qual é o nome completo da criança?"]);
    await say(phone, "Davi Rocha");
    reply = await say(phone, "02/02/2021");
    expect(reply[0].body).toBe("Qual é o nome completo do responsável?");
  });
});

describe("sem idade limite e paciente adulto", () => {
  it("sem idade limite: sem aviso", async () => {
    await settings({ consultation_age_limit_years: null });
    try {
      const reply = await consultationWith("+5584991228095", "Dr. Segundo");
      expect(bodies(reply).slice(-1)).toEqual(["Qual é o nome completo da criança?"]);
      expect(bodies(reply).join("\n")).not.toContain("atende pacientes até");
    } finally {
      await settings({ consultation_age_limit_years: 12 });
    }
  });

  it("clínica Mista, paciente adulto: pergunta o nome de quem escreve, sem \"responsável\"", async () => {
    await settings({ profile: "mixed", consultation_age_limit_years: null });
    try {
      const phone = "+5584991228094";
      let reply = await consultationWith(phone, "Dr. Segundo");
      expect(reply.at(-1)!.body).toBe("É para você ou para outra pessoa?");
      reply = await say(phone, { id: "for_other" });
      expect(reply[0].body).toBe("Qual é o nome completo do paciente?");
      await say(phone, "José Lima");
      reply = await say(phone, "03/03/1950");
      expect(reply[0].body).toBe("Qual é o seu nome completo?");
      reply = await say(phone, "Marta Lima");
      expect(reply[0].body).toBe("Confira o seu nome: *Marta Lima*\n\nEstá correto? Responda Sim ou Não.");
    } finally {
      await settings({ profile: "pediatric", consultation_age_limit_years: 12 });
    }
  });
});
