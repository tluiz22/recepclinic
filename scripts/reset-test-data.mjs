// Limpa os dados de teste para recomeçar o monitoramento do zero (set/2026).
//
// Apaga, no Supabase: mensagens do WhatsApp, eventos do funil (Fase 15),
// links de agendar/remarcar, agendamentos, estado das conversas, crianças e
// responsáveis. E, no Google Calendar, os eventos ligados a esses
// agendamentos (`appointments.google_event_id`) — sem avisar ninguém por
// WhatsApp. Não toca em: configurações, locais, disponibilidade, tipos de
// exame, contatos do resumo diário, perfis (`staff_profiles`), logins, nem
// em eventos do Calendar sem agendamento (bloqueios administrativos e
// eventos criados à mão no celular).
//
// Uso (na raiz do projeto, com o .env local):
//   node --env-file=.env scripts/reset-test-data.mjs              → só simula
//   node --env-file=.env scripts/reset-test-data.mjs --confirmar  → apaga
//
// IRREVERSÍVEL com --confirmar: não há backup automático no plano gratuito
// do Supabase.

import { createClient } from "@supabase/supabase-js";
import { JWT } from "google-auth-library";

const confirm = process.argv.includes("--confirmar");

const {
  PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  GOOGLE_CALENDAR_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
} = process.env;

for (const [name, value] of Object.entries({
  PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  GOOGLE_CALENDAR_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
})) {
  if (!value) {
    console.error(`Variável ${name} ausente — rode com: node --env-file=.env scripts/reset-test-data.mjs`);
    process.exit(1);
  }
}

// Mesma normalização de `src/lib/google/calendar.ts` (PEM com \n literais,
// entre aspas, ou o PEM inteiro em base64).
function normalizePrivateKey(raw) {
  let key = raw.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  if (!key.includes("-----BEGIN")) key = Buffer.from(key, "base64").toString("utf8").trim();
  key = key.replace(/\\n/g, "\n").trim();
  return key.endsWith("\n") ? key : `${key}\n`;
}

const supabase = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const google = new JWT({
  email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: normalizePrivateKey(GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
  scopes: ["https://www.googleapis.com/auth/calendar"],
});

// Ordem respeita as chaves estrangeiras: quem aponta pra outra tabela sai
// antes dela. `filter` só existe porque o Supabase recusa DELETE sem filtro.
const TABLES = [
  { table: "whatsapp_messages", label: "Mensagens do WhatsApp", filter: ["id", "is", null] },
  { table: "bot_funnel_events", label: "Eventos do funil", filter: ["id", "is", null] },
  { table: "booking_links", label: "Links de agendar/remarcar", filter: ["id", "is", null] },
  { table: "appointments", label: "Agendamentos", filter: ["id", "is", null] },
  { table: "conversation_state", label: "Estado das conversas", filter: ["guardian_phone", "is", null] },
  { table: "patients", label: "Crianças", filter: ["id", "is", null] },
  { table: "guardians", label: "Responsáveis", filter: ["id", "is", null] },
];

async function countRows(table) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`Erro ao contar ${table}: ${error.message}`);
  return count ?? 0;
}

async function fetchCalendarEventIds() {
  const ids = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("appointments")
      .select("google_event_id")
      .not("google_event_id", "is", null)
      .range(from, from + 999);
    if (error) throw new Error(`Erro ao ler appointments: ${error.message}`);
    // Exame em grupo (Fase 11): vários agendamentos no mesmo evento.
    for (const row of data) ids.add(row.google_event_id);
    if (data.length < 1000) break;
  }
  return [...ids];
}

async function deleteCalendarEvent(eventId) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`;
  try {
    await google.request({ url, method: "DELETE" });
    return "apagado";
  } catch (err) {
    const status = err?.response?.status;
    // 404/410: já não existe (apagado antes, à mão ou por outro teste).
    if (status === 404 || status === 410) return "já não existia";
    throw new Error(`Erro ao apagar evento ${eventId} no Calendar: ${err?.message ?? err}`);
  }
}

console.log(confirm ? "=== LIMPEZA (apagando de verdade) ===" : "=== SIMULAÇÃO (nada será apagado) ===");
console.log(`Supabase: ${PUBLIC_SUPABASE_URL}`);
console.log(`Calendar: ${GOOGLE_CALENDAR_ID}\n`);

const eventIds = await fetchCalendarEventIds();
console.log(`Google Calendar — eventos ligados a agendamentos: ${eventIds.length}`);
for (const { table, label } of TABLES) {
  console.log(`${label.padEnd(28)} (${table}): ${await countRows(table)}`);
}

if (!confirm) {
  console.log("\nNada foi apagado. Para apagar, rode de novo com --confirmar.");
  process.exit(0);
}

// 1. Calendar primeiro: os ids vêm de `appointments`, que é apagada depois.
const calendarResult = { apagado: 0, "já não existia": 0 };
for (const eventId of eventIds) {
  calendarResult[await deleteCalendarEvent(eventId)] += 1;
}
console.log(
  `\nCalendar: ${calendarResult.apagado} apagados, ${calendarResult["já não existia"]} já não existiam.`
);

// 2. Retorno aponta pra consulta de origem (Fase 17) — solta o vínculo antes
// de apagar, senão a própria tabela bloqueia o DELETE.
{
  const { error } = await supabase
    .from("appointments")
    .update({ origin_appointment_id: null })
    .not("origin_appointment_id", "is", null);
  if (error) throw new Error(`Erro ao soltar origin_appointment_id: ${error.message}`);
}

// 3. Tabelas, na ordem das chaves estrangeiras.
for (const { table, label, filter } of TABLES) {
  const [column, operator, value] = filter;
  const { error } = await supabase.from(table).delete().not(column, operator, value);
  if (error) throw new Error(`Erro ao apagar ${table}: ${error.message}`);
  console.log(`${label.padEnd(28)} (${table}): apagado — restam ${await countRows(table)}`);
}

console.log("\nLimpeza concluída.");
