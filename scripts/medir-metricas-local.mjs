// Mede o tempo das contas das Métricas no ambiente LOCAL, com o login do
// Administrador da Clínica Exemplo Saúde (o RLS vale, como na tela). Rodar
// depois do scripts/metricas-volume-local.sql:
//
//   node --env-file=.env scripts/medir-metricas-local.mjs
//
// Cada caso dispara, ao mesmo tempo, as mesmas chamadas da aba (como o
// Promise.all do PerformanceTab e do DigitalTab), 5 vezes; mostra a mediana e
// a pior. Meta do redesign: menos de 1,5 s.
import { createClient } from "@supabase/supabase-js";

const url = process.env.PUBLIC_SUPABASE_URL;
if (!/127\.0\.0\.1|localhost/.test(url ?? "")) throw new Error("Só no ambiente local (PUBLIC_SUPABASE_URL do .env).");
const db = createClient(url, process.env.PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { error: loginError } = await db.auth.signInWithPassword({ email: "admin@exemplo-saude.local", password: "recepclinic-local" });
if (loginError) throw loginError;

const clinicId = "0a000000-0000-4000-8000-000000000001";
const { data: agendas } = await db.from("agendas").select("id").eq("clinic_id", clinicId);
const agendaIds = agendas.map((a) => a.id);
const now = new Date();
const days = (n) => new Date(now.getTime() - n * 86_400_000);

/** Como a tela: as contas que podem passar de 1000 linhas são lidas em páginas, na mesma ordem. */
const ORDER = { metrics_attendance: ["day", "service_id", "location_id"], metrics_return_rights: ["appointment_id"], metrics_bot_sessions: ["started_at", "session_id"] };
const call = async (fn, args) => {
  if (!ORDER[fn]) {
    const { data, error } = await db.rpc(fn, args);
    if (error) return `ERRO: ${error.message}`;
    return Array.isArray(data) ? `${data.length} linhas` : "1 linha";
  }
  let total = 0;
  for (let from = 0; ; from += 1000) {
    let query = db.rpc(fn, args);
    for (const column of ORDER[fn]) query = query.order(column);
    const { data, error } = await query.range(from, from + 999);
    if (error) return `ERRO: ${error.message}`;
    total += data.length;
    if (data.length < 1000) return `${total} linhas`;
  }
};
const scope = (start, end) => ({ p_clinic_id: clinicId, p_start: start.toISOString(), p_end: end.toISOString(), p_agenda_ids: agendaIds });

/** Aba Desempenho: período atual, retornos, oportunidades e o período anterior (comparação). */
function performance(periodDays) {
  const current = scope(days(periodDays), now);
  const previous = scope(days(2 * periodDays), days(periodDays));
  return {
    agendamentos: () => call("metrics_activity", current),
    comparecimento: () => call("metrics_attendance", { ...current, p_now: now.toISOString() }),
    lembretes: () => call("metrics_reminders", { ...current, p_now: now.toISOString() }),
    retornos: () => call("metrics_return_rights", { ...current, p_now: now.toISOString() }),
    oportunidades: () => call("metrics_return_rights", { ...scope(now, now), p_now: now.toISOString() }),
    "agendamentos (anterior)": () => call("metrics_activity", previous),
    "comparecimento (anterior)": () => call("metrics_attendance", { ...previous, p_now: now.toISOString() }),
    "lembretes (anterior)": () => call("metrics_reminders", { ...previous, p_now: now.toISOString() }),
  };
}

/** Aba Agendamento digital: tentativas do bot (atual e anterior) e falhas do funil. */
function digital(periodDays) {
  return {
    tentativas: () => call("metrics_bot_sessions", { p_clinic_id: clinicId, p_start: days(periodDays).toISOString(), p_end: now.toISOString() }),
    "tentativas (anterior)": () => call("metrics_bot_sessions", { p_clinic_id: clinicId, p_start: days(2 * periodDays).toISOString(), p_end: days(periodDays).toISOString() }),
    falhas: () => call("metrics_funnel_write_failures", { p_clinic_id: clinicId, p_start: days(periodDays).toISOString(), p_end: now.toISOString() }),
  };
}

const ms = (t) => `${Math.round(t)} ms`;
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

async function measure(title, calls, runs = 5) {
  const totals = [];
  const each = Object.fromEntries(Object.keys(calls).map((k) => [k, []]));
  const rows = {};
  for (let i = 0; i < runs; i++) {
    const t0 = performance_now();
    await Promise.all(
      Object.entries(calls).map(async ([name, fn]) => {
        const t = performance_now();
        rows[name] = await fn();
        each[name].push(performance_now() - t);
      }),
    );
    totals.push(performance_now() - t0);
  }
  console.log(`\n${title}: mediana ${ms(median(totals))}, pior ${ms(Math.max(...totals))}`);
  for (const [name, list] of Object.entries(each)) console.log(`  ${name.padEnd(28)} ${ms(median(list)).padStart(8)}  (${rows[name]})`);
}
const performance_now = () => globalThis.performance.now();

const { count } = await db.from("appointments").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId).gte("scheduled_at", days(365).toISOString()).lt("scheduled_at", now.toISOString());
console.log(`Atendimentos no último ano: ${count}`);
await measure("Desempenho, último ano, com comparação", performance(365));
await measure("Desempenho, últimos 30 dias, com comparação", performance(30));
await measure("Agendamento digital, último ano", digital(365));
await measure("Agendamento digital, últimos 30 dias", digital(30));
