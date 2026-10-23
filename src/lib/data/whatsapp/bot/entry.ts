import { joinBlockReason } from "../../waitlist/entries";
import { formatAppointmentWhen } from "../templates";
import { go, say, sendButtons, sendList, textFor, type Bot } from "./engine";
import { parseBirthdate, pick, yesNo, type Selection } from "./input";
import { handoff, loadActive, manageIdentified, presenceConfirmed, upcomingOfContact, type ManagedAppointment } from "./manage";
import { showMenu } from "./menus";
import * as t from "./texts";
import { logError } from "../../../log";

// Entrada da conversa (cliente, 23/out/2026): com atendimento marcado no
// número, as boas-vindas perguntam se é sobre ele antes do menu. O número não
// prova quem escreve: nada do atendimento (nome, serviço, data) aparece antes
// da data de nascimento de um paciente com atendimento. "Não, outro assunto",
// nenhum atendimento ou erro na consulta: o menu de sempre.
//
// Atendimento relevante = o mesmo de Cancelar e Remarcar: marcado ou
// confirmado, depois de agora, de um paciente do contato, só desta clínica.

export const ENTRY_STATES = new Set(["ENTRY_ASK", "ENTRY_BIRTHDATE", "ENTRY_SELECT", "ENTRY_ACTIONS"]);

type EntryContext = {
  /** Datas erradas nesta conversa. */
  tries?: number;
  /** Atendimentos mostrados na lista (já validados). */
  candidates?: string[];
  /** Atendimento escolhido. */
  pendingId?: string;
};

/** Datas erradas por conversa antes de ir para o menu. */
const MAX_TRIES = 2;
/** Datas erradas no número em 24h: a partir daí, a pergunta não aparece (contra tentativa e erro). */
const MAX_WRONG_PER_DAY = 4;
const WRONG_KIND = "bot_entry_identity_wrong";

const ctxOf = (b: Bot) => b.convo.context as EntryContext;
const when = (b: Bot, a: ManagedAppointment) => formatAppointmentWhen(a.scheduledAt, b.clinic.timeZone);
/** "segunda, 10/03 às 08:00" → "seg, 10/03 às 08:00" (cabe na linha da lista). */
const shortWhen = (b: Bot, a: ManagedAppointment) => when(b, a).replace(/^([^,]{3})[^,]*,/u, "$1,");
const appointmentRowId = (id: string) => `entry_appointment_${id}`;

async function wrongToday(b: Bot): Promise<number> {
  const since = new Date(b.now.getTime() - 24 * 60 * 60_000).toISOString();
  const { count, error } = await b.db
    .from("whatsapp_messages")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", b.clinicId)
    .eq("contact_phone", b.phone)
    .eq("message_type", WRONG_KIND)
    .gte("created_at", since);
  if (error) throw error;
  return count ?? 0;
}

/** Quantos atendimentos relevantes o número tem (0 = segue para o menu). */
async function relevantCount(b: Bot): Promise<number> {
  if (!b.convo.contactId) return 0;
  const appointments = await upcomingOfContact(b);
  if (!appointments.length) return 0;
  if ((await wrongToday(b)) >= MAX_WRONG_PER_DAY) return 0;
  return appointments.length;
}

/** Começo da conversa: boas-vindas e, com atendimento marcado, a pergunta; senão, o menu. */
export async function startConversation(b: Bot): Promise<void> {
  let count = 0;
  try {
    count = await relevantCount(b);
  } catch (error) {
    // Sem a consulta, o menu de sempre (nada do atendimento é mostrado).
    logError("bot: atendimentos da entrada", error, { clinica: b.clinicId });
  }
  if (!count) return showMenu(b, { withWelcome: true });
  await say(b, "bot_welcome", textFor(b, "welcome", t.welcome(b.clinic.label), { clinica: b.clinic.label }));
  await askAbout(b, count);
}

async function askAbout(b: Bot, count: number): Promise<void> {
  const one = count === 1;
  await sendButtons(b, "bot_entry_ask", one ? t.ENTRY_ONE : t.ENTRY_MANY, one ? t.ENTRY_ONE_BUTTONS : t.ENTRY_MANY_BUTTONS);
  await go(b, "ENTRY_ASK", { count });
}

async function handleAsk(b: Bot, selection: Selection): Promise<void> {
  const answer = yesNo(selection, t.ENTRY_IDS);
  if (answer === false) return showMenu(b);
  if (answer === null) {
    await say(b, "bot_not_understood", t.ENTRY_NOT_UNDERSTOOD);
    const count = (b.convo.context as { count?: number }).count ?? 1;
    return askAbout(b, count);
  }
  await say(b, "bot_entry_ask_birthdate", t.entryAskBirthdate(b.words));
  await go(b, "ENTRY_BIRTHDATE", { tries: 0 } satisfies EntryContext);
}

async function handleBirthdate(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const birthdate = parseBirthdate(selection.text, b.clinic.today);
  if (!birthdate) return say(b, "bot_invalid_birthdate", t.INVALID_BIRTHDATE);
  let matches: ManagedAppointment[];
  try {
    matches = (await upcomingOfContact(b)).filter((a) => a.birthdate === birthdate);
  } catch (error) {
    logError("bot: atendimentos da entrada", error, { clinica: b.clinicId });
    await say(b, "bot_entry_lookup_error", t.ENTRY_LOOKUP_ERROR);
    return showMenu(b);
  }
  if (!matches.length) {
    // A mesma resposta para data errada e para paciente sem atendimento: nada é revelado.
    const tries = (ctx.tries ?? 0) + 1;
    if (tries < MAX_TRIES) {
      await say(b, WRONG_KIND, t.ENTRY_IDENTITY_RETRY);
      return go(b, "ENTRY_BIRTHDATE", { ...ctx, tries } satisfies EntryContext);
    }
    await say(b, WRONG_KIND, t.entryIdentityFailed(b.receptionAvailable));
    return showMenu(b);
  }
  if (matches.length === 1) return showActions(b, matches[0]);
  await showChoice(b, matches.slice(0, t.MAX_LIST_ROWS - 1));
}

// ---------------------------------------------------------------------------
// Lista dos atendimentos (só os do paciente validado)
// ---------------------------------------------------------------------------

async function showChoice(b: Bot, appointments: ManagedAppointment[]): Promise<void> {
  const manyPatients = new Set(appointments.map((a) => a.patientId)).size > 1;
  await sendList(
    b,
    "bot_entry_choice",
    t.ENTRY_CHOOSE,
    t.numberedList(
      appointments.map((a) => ({
        id: appointmentRowId(a.id),
        label: shortWhen(b, a),
        description: manyPatients ? `${a.serviceName} · ${a.patientName}` : a.serviceName,
      })),
    ),
  );
  await go(b, "ENTRY_SELECT", { candidates: appointments.map((a) => a.id) } satisfies EntryContext);
}

async function handleSelect(b: Bot, selection: Selection): Promise<void> {
  const ids = ctxOf(b).candidates ?? [];
  const id = pick(selection, ids, appointmentRowId);
  if (!id) {
    await say(b, "bot_not_understood", textFor(b, "not_understood", t.notUnderstood()));
    // Só os já validados, ainda ativos.
    const appointments = (await upcomingOfContact(b)).filter((a) => ids.includes(a.id));
    if (!appointments.length) return showMenu(b);
    return showChoice(b, appointments);
  }
  const appointment = await loadActive(b, id);
  if (!appointment) {
    await say(b, "bot_appointment_inactive", t.APPOINTMENT_INACTIVE);
    return showMenu(b);
  }
  await showActions(b, appointment);
}

// ---------------------------------------------------------------------------
// Ações do atendimento escolhido
// ---------------------------------------------------------------------------

type ActionKey = keyof typeof t.ENTRY_ACTION_ITEMS;

/** Só o que vale para o atendimento: presença ainda não confirmada, lista de espera com o item e fora de série. */
function actionsFor(b: Bot, appointment: ManagedAppointment, confirmed: boolean): ActionKey[] {
  const keys: ActionKey[] = [];
  if (!confirmed) keys.push("confirm");
  keys.push("reschedule", "cancel");
  if (b.features.includes("waitlist") && joinBlockReason(appointment, b.now) === null) keys.push("waitlist");
  if (b.receptionAvailable) keys.push("reception");
  return keys;
}

async function showActions(b: Bot, appointment: ManagedAppointment): Promise<void> {
  const confirmed = await presenceConfirmed(b, appointment.id);
  const keys = actionsFor(b, appointment, confirmed);
  const { phrase, end: ending } = t.appointmentWords(appointment.category, appointment.serviceName);
  await sendList(
    b,
    "bot_entry_actions",
    t.entryAppointmentDetails(phrase, ending, appointment.patientName, when(b, appointment), confirmed),
    t.numberedList(
      keys.map((key) => ({ id: `entry_${key}`, label: t.ENTRY_ACTION_ITEMS[key], description: key === "waitlist" ? t.ENTRY_WAITLIST_DESCRIPTION : null })),
    ),
  );
  await go(b, "ENTRY_ACTIONS", { pendingId: appointment.id } satisfies EntryContext);
}

async function handleActions(b: Bot, selection: Selection): Promise<void> {
  const id = ctxOf(b).pendingId;
  const appointment = id ? await loadActive(b, id) : null;
  if (!appointment) {
    await say(b, "bot_appointment_inactive", t.APPOINTMENT_INACTIVE);
    return showMenu(b);
  }
  const keys = actionsFor(b, appointment, await presenceConfirmed(b, appointment.id));
  const key = pick(selection, keys, (k) => `entry_${k}`);
  if (!key) {
    await say(b, "bot_not_understood", textFor(b, "not_understood", t.notUnderstood()));
    return showActions(b, appointment);
  }
  if (key === "reception") {
    await go(b, "WELCOME");
    return handoff(b);
  }
  await manageIdentified(b, key, appointment);
}

export async function handleEntryState(b: Bot, state: string, selection: Selection): Promise<void> {
  switch (state) {
    case "ENTRY_ASK":
      return handleAsk(b, selection);
    case "ENTRY_BIRTHDATE":
      return handleBirthdate(b, selection);
    case "ENTRY_SELECT":
      return handleSelect(b, selection);
    case "ENTRY_ACTIONS":
      return handleActions(b, selection);
  }
}

export const ENTRY_LIMITS = { MAX_TRIES, MAX_WRONG_PER_DAY } as const;
