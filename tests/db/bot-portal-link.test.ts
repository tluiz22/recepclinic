import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import { afterLinkBooking } from "../../src/lib/data/portal/links";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { promptExpiredPortalLinks } from "../../src/lib/data/whatsapp/bot/notCompleted";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { adminClient } from "./helpers";
import { asDb, at, MON1, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F3b da recepção digital: Marcar consulta, retorno e exame mandam o link do portal (uma jornada só); o chat segue só
// onde o portal ainda não marca (sem endereço do portal, domiciliar, turma). Encaixe sem nada marcado: o link põe na
// lista de espera. Link vencido sem marcar: "Não concluímos a sua marcação" e o novo link.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "f3b-numero";
type Sent = { to: string; kind: "text" | "list" | "buttons"; body: string; options: { id: string; title: string }[] };

let f: AgendaFixture;
let sent: Sent[] = [];
let seq = 0;
let segundoId: string;

const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica F3b",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "sem template no teste" }),
  text: async (to, body) => (sent.push({ to, kind: "text", body, options: [] }), { sent: true, messageId: `wamid.f3b.out.${++seq}`, body }),
  list: async (to: string, body: string, _button: string, sections: ListSection[]) => (
    sent.push({ to, kind: "list", body, options: sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title }))) }),
    { sent: true, messageId: `wamid.f3b.out.${++seq}` }
  ),
  buttons: async (to: string, body: string, buttons: ReplyButton[]) => (
    sent.push({ to, kind: "buttons", body, options: buttons }),
    { sent: true, messageId: `wamid.f3b.out.${++seq}` }
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
      ? { id: `wamid.f3b.in.${++seq}`, from: phone.slice(1), type: "text", text: { body: input } }
      : { id: `wamid.f3b.in.${++seq}`, from: phone.slice(1), type: "interactive", interactive: { list_reply: { id: input.id, title: "" } } };
  const summary = await processWebhook(
    { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, messages: [message] } }] }] },
    deps(),
    new Date(),
  );
  expect(summary.errors).toBe(0);
  return sent;
}

const optionId = (reply: Sent[], titleStart: string) => reply.at(-1)!.options.find((o) => o.title.includes(titleStart))!.id;
const restart = (phone: string) => adminClient().from("conversation_state").update({ state: "WELCOME", context: {} }).eq("clinic_id", f.clinicId).eq("contact_phone", phone);

async function lastPortalLink(phone: string) {
  const { data } = await adminClient()
    .from("portal_links")
    .select("id, purpose, professional_id, service_id, join_waitlist, funnel_session_id, expires_at")
    .eq("clinic_id", f.clinicId)
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/** Dr. Segundo (Cardiologia) › Consultas › Marcar consulta. */
/** Toca na opção da última lista pelo título. */
const choose = async (phone: string, reply: Sent[], title: string) => say(phone, { id: optionId(reply, title) });

/** Dr. Segundo (Cardiologia) › Consultas › a opção do submenu. */
async function consultations(phone: string, option = "Marcar consulta"): Promise<Sent[]> {
  await restart(phone);
  let reply = await say(phone, "Oi");
  // Número com agendamento: "Identificamos um agendamento…" (entrada da conversa); "Não, outro assunto" leva ao menu.
  if (reply.at(-1)!.options.some((o) => o.id === "entry_no")) reply = await say(phone, { id: "entry_no" });
  reply = await choose(phone, reply, "Cardiologia");
  reply = await choose(phone, reply, "Consultas");
  return choose(phone, reply, option);
}
const bookWithSegundo = (phone: string) => consultations(phone);

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica F3b", "+55849912390");
  const db = adminClient();
  await db.from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "f3b-waba", status: "connected" });
  await db.from("clinics").update({ portal_slug: `f3b-${Date.now()}` }).eq("id", f.clinicId);
  // O portal marca consulta individual no consultório (F3b): sem o domiciliar e sem a turma nesta clínica.
  await db.from("availability_windows").delete().eq("clinic_id", f.clinicId).eq("location_id", f.ids.home);
  await db.from("services").update({ is_active: false }).eq("id", f.ids.turma);
  const { data: agendas } = await db.from("agendas").select("id, professional_id").in("id", [f.ids.agendaDra, f.ids.agendaDra2]);
  segundoId = agendas!.find((a) => a.id === f.ids.agendaDra2)!.professional_id!;
  const { data: specialty } = await db.from("kb_specialties").select("id").eq("name", "Cardiologia").single();
  const { data: ped } = await db.from("kb_specialties").select("id").eq("name", "Pediatria").single();
  const draId = agendas!.find((a) => a.id === f.ids.agendaDra)!.professional_id!;
  await db.from("professional_specialties").insert([
    { clinic_id: f.clinicId, professional_id: segundoId, specialty_id: specialty!.id, position: 0 },
    { clinic_id: f.clinicId, professional_id: draId, specialty_id: ped!.id, position: 0 },
  ]);
});

afterAll(async () => f.cleanup());

describe("bot leva ao portal (F3b)", () => {
  it("Marcar consulta: o link do portal do profissional escolhido, sem perguntas no chat", async () => {
    const phone = "+5584991239001";
    const reply = await bookWithSegundo(phone);
    expect(reply).toHaveLength(1);
    expect(reply[0].body).toMatch(/^Para escolher o dia e o horário de \*consulta com Dr\. Segundo\*, toque no link abaixo\. Ele vale por 30 minutos e é só para este número:\nhttps:\/\/agendar\.exemplo\.test\/s\/[A-Za-z0-9_-]{22}$/);
    const link = await lastPortalLink(phone);
    expect(link).toMatchObject({ purpose: "book", professional_id: segundoId, join_waitlist: false });
    expect(link!.funnel_session_id).not.toBeNull();
    const { data: convo } = await adminClient().from("conversation_state").select("state").eq("clinic_id", f.clinicId).eq("contact_phone", phone).single();
    expect(convo!.state).toBe("WELCOME");
    // Outro link do mesmo número desfaz o anterior.
    await bookWithSegundo(phone);
    const { data: links } = await adminClient().from("portal_links").select("revoked_at").eq("clinic_id", f.clinicId).eq("phone", phone).order("created_at");
    expect(links!.map((l) => l.revoked_at !== null)).toEqual([true, false]);
  });

  it("Exames (agenda da equipe): o link do exame", async () => {
    const phone = "+5584991239002";
    await restart(phone);
    let reply = await say(phone, "Oi");
    reply = await choose(phone, reply, "Exames");
    if (!reply.at(-1)!.options.some((o) => o.title.includes("Marcar exame"))) reply = await choose(phone, reply, "Exames");
    reply = await choose(phone, reply, "Marcar exame");
    expect(reply[0].body).toContain("de *Exame*, toque no link abaixo");
    expect(await lastPortalLink(phone)).toMatchObject({ purpose: "exam", service_id: f.ids.exame });
  });

  it("sem o endereço do portal: a marcação segue no chat, como antes", async () => {
    const phone = "+5584991239003";
    const { data: clinic } = await adminClient().from("clinics").select("portal_slug").eq("id", f.clinicId).single();
    await adminClient().from("clinics").update({ portal_slug: null }).eq("id", f.clinicId);
    try {
      const reply = await bookWithSegundo(phone);
      expect(reply.at(-1)!.body).toBe("É para você ou para outra pessoa?");
      expect(await lastPortalLink(phone)).toBeNull();
    } finally {
      await adminClient().from("clinics").update({ portal_slug: clinic!.portal_slug }).eq("id", f.clinicId);
    }
  });

  it("Encaixe sem nada marcado: o link avisa e marca na lista de espera", async () => {
    const phone = "+5584991239004";
    let reply = await consultations(phone, "Encaixe ou antecipar");
    reply = await say(phone, { id: optionId(reply, "Marcar consulta") });
    expect(reply[0].body).toContain("Ao marcar, você entra na lista de espera");
    const link = await lastPortalLink(phone);
    expect(link).toMatchObject({ purpose: "book", join_waitlist: true });

    // Marcou pelo portal: o link fica usado, o funil fecha e o atendimento entra na lista.
    const { appointment } = await bookAppointment(
      asDb(f.reception),
      f.clinicId,
      { patientId: f.ids.p1, serviceId: f.ids.consulta2, agendaId: f.ids.agendaDra2, start: at(MON1, "08:30"), locationId: f.ids.office, channel: "portal", actorId: null, anyTime: true, acceptedWarnings: true },
    );
    const service = createClinicServiceClient(f.clinicId, env()) as unknown as DbClient;
    await afterLinkBooking(service, f.clinicId, link!.id, appointment.id);
    const db = adminClient();
    expect((await db.from("portal_links").select("used_at").eq("id", link!.id).single()).data!.used_at).not.toBeNull();
    expect((await db.from("waitlist_entries").select("created_via").eq("appointment_id", appointment.id).single()).data).toEqual({ created_via: "booking_link" });
    const { data: funnel } = await db.from("bot_funnel_events").select("step, source, appointment_id").eq("session_id", link!.funnel_session_id!).eq("step", "confirmed").single();
    expect(funnel).toEqual({ step: "confirmed", source: "web", appointment_id: appointment.id });
  });

  it("Remarcar (F3c; I7): o link do portal com os dias do mesmo profissional, sem a antecedência", async () => {
    const phone = "+5584991239001"; // contato do Paciente Um (fixture)
    await adminClient().from("appointments").update({ status: "canceled", canceled_at: new Date().toISOString() }).eq("patient_id", f.ids.p1).in("status", ["scheduled", "confirmed"]);
    const { appointment } = await bookAppointment(
      asDb(f.reception),
      f.clinicId,
      { patientId: f.ids.p1, serviceId: f.ids.consulta2, agendaId: f.ids.agendaDra2, start: at(MON1, "08:00"), locationId: f.ids.office, channel: "admin", actorId: null, anyTime: true, acceptedWarnings: true },
    );
    let reply = await consultations(phone, "Remarcar");
    if (reply.at(-1)!.body.includes("data de nascimento")) reply = await say(phone, "01/01/2020");
    if (reply.at(-1)!.options.length && !reply.at(-1)!.body.includes("toque no link")) reply = await say(phone, { id: reply.at(-1)!.options[0].id });
    const text = reply.map((m) => m.body).join("\n");
    expect(text).toMatch(/Para escolher o novo dia e horário para a consulta de \*Paciente Um\*, toque no link abaixo\. Ele vale por 30 minutos e é só para este número:\nhttps:\/\/agendar\.exemplo\.test\/s\//);
    expect(await lastPortalLink(phone)).toMatchObject({ purpose: "reschedule" });
    const { data } = await adminClient().from("portal_links").select("appointment_id").eq("clinic_id", f.clinicId).eq("phone", phone).eq("purpose", "reschedule").single();
    expect(data!.appointment_id).toBe(appointment.id);
  });

  it("link vencido sem marcar: \"Não concluímos a sua marcação\" uma vez, e \"Novo link\" manda outro", async () => {
    const phone = "+5584991239005";
    await bookWithSegundo(phone);
    const link = await lastPortalLink(phone);
    await adminClient().from("portal_links").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", link!.id);
    const service = createClinicServiceClient(f.clinicId, env()) as unknown as DbClient;
    sent = [];
    expect(await promptExpiredPortalLinks(service, f.clinicId, { ...sender, clinicId: f.clinicId })).toBe(1);
    expect(sent.at(-1)!.body).toBe("Não concluímos a sua marcação. Como prefere seguir?");
    expect(await promptExpiredPortalLinks(service, f.clinicId, { ...sender, clinicId: f.clinicId })).toBe(0);
    const reply = await say(phone, { id: "nc_retry" });
    expect(reply[0].body).toMatch(/^Aqui está um novo link para marcar:\nhttps:\/\/agendar\.exemplo\.test\/s\//);
    expect(await lastPortalLink(phone)).toMatchObject({ purpose: "book", professional_id: segundoId, funnel_session_id: link!.funnel_session_id });
  });
});
