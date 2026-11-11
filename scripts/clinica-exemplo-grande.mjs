// Clínica Exemplo Saúde (portal `clinica-teste`) como clínica grande (cliente, 11/nov/2026):
// mais 10 profissionais fictícios, 2 por especialidade (Pediatria, Psiquiatria, Odontologia,
// Endocrinologia e Oftalmologia), cada um com agenda, Consulta, Retorno e horários, e
// atendimentos nas 2 próximas semanas com vários horários vagos. Para apresentar a consultórios
// menores, o cliente desliga e liga os profissionais pela tela (o script respeita quem está
// desligado ao rodar de novo).
//
// Sem mensagem para ninguém: a clínica tem o chip de testes ligado, então os pacientes fictícios
// têm telefone com DDD 00 (não existe) e os atendimentos já saem com o lembrete marcado como
// enviado (o envio automático só pega quem não tem `reminder_sent_at`).
//
// Uso (na raiz do projeto):
//   node --env-file=.env.staging scripts/clinica-exemplo-grande.mjs              → só mostra o que faria
//   node --env-file=.env.staging scripts/clinica-exemplo-grande.mjs --confirmar  → cria (ou renova as 2 semanas)
//   ... --remover --confirmar                                                     → apaga os 10 e os pacientes fictícios

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isNationalHoliday } from "../src/lib/holidays.ts";

if (process.env.RECEPCLINIC_PRODUCAO === "1" || /^https:\/\/app\.recepclinic\.com\.br/.test(process.env.SITE_URL ?? "")) {
  console.error("Este script é só de teste e não roda na produção (.env.production).");
  process.exit(1);
}

const confirm = process.argv.includes("--confirmar");
const removeOnly = process.argv.includes("--remover");
const CLINIC_NAME = "Clínica Exemplo Saúde";
const PHONE_PREFIX = "+550099"; // DDD 00: nenhum número real
const DAYS = 14;
const OCCUPANCY = 0.45;

const SPECIALTY = {
  ped: { kb: "Pediatria", profession: "Médico", council: "CRM", label: "Pediatra", minutes: 30, price: 35000, child: true },
  psi: { kb: "Psiquiatria", profession: "Médico", council: "CRM", label: "Psiquiatra", minutes: 50, price: 60000 },
  odo: { kb: "Odontologia (clínica geral)", profession: "Dentista", council: "CRO", label: "Dentista", minutes: 40, price: 25000 },
  end: { kb: "Endocrinologia", profession: "Médico", council: "CRM", label: "Endocrinologista", minutes: 30, price: 45000 },
  oft: { kb: "Oftalmologia", profession: "Médico", council: "CRM", label: "Oftalmologista", minutes: 20, price: 40000 },
};

// Horários: [dias da semana (1 = segunda), início, fim].
const M = ["08:00", "12:00"];
const T = ["14:00", "18:00"];
const PROFESSIONALS = [
  { name: "Dra. Helena Prado", sp: "ped", number: "70101", windows: [[[1, 3, 5], ...M], [[2, 4], ...T]], insurance: ["Unimed", "Bradesco"] },
  { name: "Dr. Rafael Moura", sp: "ped", number: "70102", windows: [[[2, 4], ...M], [[1, 3], ...T]], insurance: ["Unimed", "Saúde Caixa"] },
  { name: "Dr. Bruno Teixeira", sp: "psi", number: "70103", windows: [[[1, 2, 3, 4], "13:00", "19:00"]], insurance: [] },
  { name: "Dra. Camila Rocha", sp: "psi", number: "70104", windows: [[[2, 3, 5], ...M]], insurance: ["Bradesco"] },
  { name: "Dra. Juliana Castro", sp: "odo", number: "70105", windows: [[[1, 2, 3, 4, 5], ...M], [[1, 3], ...T]], insurance: ["Unimed"] },
  { name: "Dr. Marcelo Alves", sp: "odo", number: "70106", windows: [[[1, 3, 5], "13:00", "19:00"]], insurance: [] },
  { name: "Dra. Fernanda Lima", sp: "end", number: "70107", windows: [[[1, 3], ...M], [[1, 3], "14:00", "17:00"]], insurance: ["Unimed", "Bradesco", "Saúde Caixa"] },
  { name: "Dr. Gustavo Reis", sp: "end", number: "70108", windows: [[[2, 4, 5], "09:00", "12:00"], [[2, 4], ...T]], insurance: ["Saúde Caixa"] },
  { name: "Dr. Leonardo Souza", sp: "oft", number: "70109", windows: [[[1, 2, 3, 4, 5], ...M]], insurance: ["Unimed", "Bradesco"] },
  { name: "Dra. Patrícia Nunes", sp: "oft", number: "70110", windows: [[[1, 2, 4, 5], ...T]], insurance: ["Bradesco", "Saúde Caixa"] },
];
const NAMES = PROFESSIONALS.map((p) => p.name);

const FIRST = ["Ana", "Bruna", "Carlos", "Daniela", "Eduardo", "Fabiana", "Gabriel", "Heloísa", "Igor", "Joana", "Lucas", "Marina", "Nicolas", "Olívia", "Paulo", "Renata", "Sérgio", "Tatiana", "Vitor", "Yasmin"];
const LAST = ["Almeida", "Barros", "Cardoso", "Duarte", "Esteves", "Freitas", "Gomes", "Holanda", "Lopes", "Macedo", "Pereira", "Queiroz", "Ramos", "Siqueira", "Vieira"];
const KIDS = ["Alice", "Bernardo", "Cecília", "Davi", "Elisa", "Felipe", "Giovana", "Heitor", "Isabela", "Joaquim", "Laura", "Miguel", "Nina", "Otávio", "Pietra", "Theo"];

// Sorteio repetível por dia (rodar duas vezes no mesmo dia dá o mesmo resultado).
let seed = Number(new Date().toISOString().slice(0, 10).replaceAll("-", ""));
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(rand() * list.length)];

function databaseUrl() {
  const pooler = readFileSync(new URL("../supabase/.temp/pooler-url", import.meta.url), "utf8").trim();
  return pooler.replace("@", `:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@`);
}

async function insert(db, table, row) {
  const cols = Object.keys(row);
  const sql = `insert into public.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
  return (await db.query(sql, Object.values(row))).rows[0];
}

async function insertMany(db, table, rows, chunk = 200) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  for (let i = 0; i < rows.length; i += chunk) {
    const values = [];
    const tuples = rows.slice(i, i + chunk).map((r) => `(${cols.map((c) => (values.push(r[c] ?? null), `$${values.length}`)).join(", ")})`);
    await db.query(`insert into public.${table} (${cols.join(", ")}) values ${tuples.join(", ")}`, values);
  }
}

/** Remove os 10 profissionais (com agendas, serviços e atendimentos) e os pacientes fictícios. */
async function removeAll(db, clinicId) {
  const { rows } = await db.query("select id from public.professionals where clinic_id = $1 and display_name = any($2)", [clinicId, NAMES]);
  const profIds = rows.map((r) => r.id);
  const { rows: ag } = await db.query("select id from public.agendas where clinic_id = $1 and professional_id = any($2)", [clinicId, profIds]);
  const agendaIds = ag.map((r) => r.id);
  const { rows: sv } = await db.query("select id from public.services where clinic_id = $1 and professional_id = any($2)", [clinicId, profIds]);
  const serviceIds = sv.map((r) => r.id);
  const { rows: ct } = await db.query("select id from public.contacts where clinic_id = $1 and phone like $2", [clinicId, `${PHONE_PREFIX}%`]);
  const contactIds = ct.map((r) => r.id);
  const { rows: pt } = await db.query("select id from public.patients where clinic_id = $1 and contact_id = any($2)", [clinicId, contactIds]);
  const patientIds = pt.map((r) => r.id);
  // Atendimento de paciente real numa agenda fictícia (marcado na validação) não é apagado: o script para.
  const { rows: foreign } = await db.query(
    "select count(*)::int n from public.appointments where clinic_id = $1 and agenda_id = any($2) and not (patient_id = any($3))",
    [clinicId, agendaIds, patientIds],
  );
  if (foreign[0].n > 0) throw new Error(`${foreign[0].n} atendimento(s) de pacientes reais nas agendas fictícias: desmarque antes de renovar ou remover.`);
  const { rows: other } = await db.query(
    "select count(*)::int n from public.appointments where clinic_id = $1 and patient_id = any($2) and not (agenda_id = any($3))",
    [clinicId, patientIds, agendaIds],
  );
  if (other[0].n > 0) throw new Error(`${other[0].n} atendimento(s) de pacientes fictícios em outras agendas: desmarque antes de renovar ou remover.`);

  const del = async (sql, params) => (await db.query(sql, params)).rowCount;
  const counts = {
    atendimentos: await del("delete from public.appointments where clinic_id = $1 and agenda_id = any($2)", [clinicId, agendaIds]),
    horarios: await del("delete from public.availability_windows where clinic_id = $1 and agenda_id = any($2)", [clinicId, agendaIds]),
  };
  await del("delete from public.service_locations where clinic_id = $1 and service_id = any($2)", [clinicId, serviceIds]);
  await del("delete from public.service_agendas where clinic_id = $1 and service_id = any($2)", [clinicId, serviceIds]);
  counts.servicos = await del("delete from public.services where clinic_id = $1 and id = any($2)", [clinicId, serviceIds]);
  counts.agendas = await del("delete from public.agendas where clinic_id = $1 and id = any($2)", [clinicId, agendaIds]);
  await del("delete from public.professional_insurance_plans where clinic_id = $1 and professional_id = any($2)", [clinicId, profIds]);
  await del("delete from public.professional_specialties where clinic_id = $1 and professional_id = any($2)", [clinicId, profIds]);
  counts.profissionais = await del("delete from public.professionals where clinic_id = $1 and id = any($2)", [clinicId, profIds]);
  counts.pacientes = await del("delete from public.patients where clinic_id = $1 and id = any($2)", [clinicId, patientIds]);
  counts.contatos = await del("delete from public.contacts where clinic_id = $1 and id = any($2)", [clinicId, contactIds]);
  return counts;
}

// --- Datas (horário de Brasília, sem horário de verão desde 2019) -------------
const pad = (n) => String(n).padStart(2, "0");
const localDate = (d) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
const at = (date, hhmm) => new Date(`${date}T${hhmm}:00-03:00`);
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const weekdayOf = (date) => new Date(`${date}T12:00:00-03:00`).getUTCDay();

const db = new pg.Client({ connectionString: databaseUrl(), ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  const { rows: clinics } = await db.query("select c.id, c.max_professionals, s.timezone from public.clinics c join public.clinic_settings s on s.clinic_id = c.id where c.name = $1", [CLINIC_NAME]);
  if (clinics.length !== 1) throw new Error(`Clínica "${CLINIC_NAME}" não encontrada (ou repetida).`);
  const clinic = clinics[0];
  if (!["America/Sao_Paulo", "America/Bahia", "America/Fortaleza", "America/Recife", "America/Belem", "America/Maceio", "America/Araguaina"].includes(clinic.timezone)) {
    throw new Error(`Fuso ${clinic.timezone} não previsto (o script usa -03:00).`);
  }
  const { rows: existing } = await db.query("select display_name, is_active from public.professionals where clinic_id = $1 and display_name = any($2)", [clinic.id, NAMES]);
  const wasActive = new Map(existing.map((r) => [r.display_name, r.is_active]));

  // Plano do que será feito.
  const now = new Date();
  const days = [];
  for (let n = 0; n <= DAYS; n += 1) {
    const date = localDate(new Date(now.getTime() + n * 86400_000));
    const wd = weekdayOf(date);
    if (wd >= 1 && wd <= 5 && !isNationalHoliday(date)) days.push(date);
  }
  console.log(`${CLINIC_NAME}: ${existing.length ? `renovar os ${existing.length} profissionais fictícios` : "criar 10 profissionais"}; dias úteis de ${days[0]} a ${days.at(-1)} (${days.length}).`);
  if (removeOnly) console.log("Modo --remover: apaga os 10 profissionais, as agendas, os atendimentos e os pacientes fictícios.");
  if (!confirm) {
    console.log("Simulação: nada gravado. Para gravar, acrescente --confirmar.");
    process.exit(0);
  }

  await db.query("begin");
  if (existing.length || removeOnly) console.log("Removido:", await removeAll(db, clinic.id));
  if (removeOnly) {
    await db.query("commit");
    process.exit(0);
  }

  const { rows: realActive } = await db.query("select count(*)::int n from public.professionals where clinic_id = $1 and is_active", [clinic.id]);
  const activeAfter = realActive[0].n + PROFESSIONALS.filter((p) => wasActive.get(p.name) ?? true).length;
  if (clinic.max_professionals < activeAfter) {
    await db.query("update public.clinics set max_professionals = $2 where id = $1", [clinic.id, activeAfter]);
    console.log(`Limite de profissionais: ${clinic.max_professionals} → ${activeAfter}.`);
  }

  const { rows: locs } = await db.query("select id from public.locations where clinic_id = $1 and type = 'clinic' and is_active order by created_at limit 1", [clinic.id]);
  if (!locs.length) throw new Error("A clínica não tem local de consultório ativo.");
  const locationId = locs[0].id;
  const { rows: plans } = await db.query("select id, name from public.insurance_plans where clinic_id = $1", [clinic.id]);
  const planId = new Map(plans.map((p) => [p.name, p.id]));
  const { rows: kb } = await db.query("select id, name from public.kb_specialties where name = any($1)", [Object.values(SPECIALTY).map((s) => s.kb)]);
  const kbId = new Map(kb.map((k) => [k.name, k.id]));

  // --- Cadastro -------------------------------------------------------------
  const built = [];
  for (const p of PROFESSIONALS) {
    const sp = SPECIALTY[p.sp];
    const prof = await insert(db, "professionals", {
      clinic_id: clinic.id,
      display_name: p.name,
      profession: sp.profession,
      specialty: sp.label,
      council: sp.council,
      council_number: p.number,
      council_state: "DF",
      rqe: sp.council === "CRM" ? p.number : null,
      accepts_private: true,
      show_in_portal: true,
    });
    await insert(db, "professional_specialties", { clinic_id: clinic.id, professional_id: prof.id, specialty_id: kbId.get(sp.kb), position: 0 });
    for (const name of p.insurance) {
      if (planId.has(name)) await insert(db, "professional_insurance_plans", { clinic_id: clinic.id, professional_id: prof.id, insurance_plan_id: planId.get(name) });
    }
    const agenda = await insert(db, "agendas", { clinic_id: clinic.id, name: p.name, kind: "professional", professional_id: prof.id });
    const services = {};
    for (const [key, row] of [
      ["consulta", { name: "Consulta", category: "consultation", duration_minutes: sp.minutes, price_cents: sp.price, return_deadline_days: null }],
      ["retorno", { name: "Retorno", category: "return_visit", duration_minutes: 15, price_cents: 0, return_deadline_days: 30 }],
    ]) {
      const s = await insert(db, "services", { clinic_id: clinic.id, ...row });
      await insert(db, "service_agendas", { clinic_id: clinic.id, service_id: s.id, agenda_id: agenda.id });
      await insert(db, "service_locations", { clinic_id: clinic.id, service_id: s.id, location_id: locationId, price_cents: null });
      services[key] = s.id;
    }
    for (const [weekdays, start, end] of p.windows) {
      for (const weekday of weekdays) {
        await insert(db, "availability_windows", { clinic_id: clinic.id, agenda_id: agenda.id, location_id: locationId, service_id: null, weekday, start_time: start, end_time: end });
      }
    }
    built.push({ ...p, sp, profId: prof.id, agendaId: agenda.id, services });
  }

  // --- Pacientes fictícios (telefone DDD 00) --------------------------------
  const contactRows = [];
  const patientRows = [];
  const adults = [];
  const kids = [];
  let seq = 0;
  const newContact = (fullName) => {
    seq += 1;
    const row = { id: randomUUID(), clinic_id: clinic.id, full_name: fullName, phone: `${PHONE_PREFIX}${String(seq).padStart(7, "0")}` };
    contactRows.push(row);
    return row;
  };
  const birth = (age) => localDate(new Date(now.getTime() - (age * 365.25 + Math.floor(rand() * 300)) * 86400_000));
  for (let i = 0; i < 45; i += 1) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]} ${LAST[(i * 3 + 5) % LAST.length]}`;
    const c = newContact(name);
    const patient = { id: randomUUID(), clinic_id: clinic.id, contact_id: c.id, full_name: name, birthdate: birth(18 + Math.floor(rand() * 55)), is_contact_self: true, created_via: "admin" };
    patientRows.push(patient);
    adults.push(patient);
  }
  for (let i = 0; i < 20; i += 1) {
    const parent = adults[i * 2];
    const name = `${KIDS[i % KIDS.length]} ${parent.full_name.split(" ").slice(1).join(" ")}`;
    const patient = { id: randomUUID(), clinic_id: clinic.id, contact_id: parent.contact_id, full_name: name, birthdate: birth(1 + Math.floor(rand() * 12)), is_contact_self: false, created_via: "admin" };
    patientRows.push(patient);
    kids.push(patient);
  }
  await insertMany(db, "contacts", contactRows);
  await insertMany(db, "patients", patientRows);

  // --- Atendimentos: ~45% dos horários, o resto vago ------------------------
  const appointments = [];
  const busyPatient = new Map(); // paciente → [início, fim)
  for (const p of built) {
    const minutes = p.sp.minutes;
    for (const date of days) {
      const wd = weekdayOf(date);
      for (const [weekdays, start, end] of p.windows) {
        if (!weekdays.includes(wd)) continue;
        for (let m = toMin(start); m + minutes <= toMin(end); m += minutes) {
          const startsAt = at(date, toHhmm(m));
          if (startsAt <= now || rand() > OCCUPANCY) continue;
          const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
          const pool = p.sp.child ? kids : p.sp.kb === "Psiquiatria" ? adults : rand() < 0.2 ? kids : adults;
          let patient;
          for (let tries = 0; tries < 10 && !patient; tries += 1) {
            const candidate = pick(pool);
            if (!(busyPatient.get(candidate.id) ?? []).some(([s, e]) => startsAt < e && endsAt > s)) patient = candidate;
          }
          if (!patient) continue;
          busyPatient.set(patient.id, [...(busyPatient.get(patient.id) ?? []), [startsAt, endsAt]]);
          const createdAt = new Date(Math.min(now.getTime() - 3600_000, startsAt.getTime() - (2 + Math.floor(rand() * 10)) * 86400_000));
          const confirmed = startsAt.getTime() - now.getTime() < 2 * 86400_000 && rand() < 0.6;
          appointments.push({
            id: randomUUID(),
            clinic_id: clinic.id,
            patient_id: patient.id,
            service_id: p.services.consulta,
            agenda_id: p.agendaId,
            location_id: locationId,
            scheduled_at: startsAt,
            duration_minutes: minutes,
            booking_channel: pick(["admin", "admin", "whatsapp_bot", "portal"]),
            status: "scheduled",
            created_at: createdAt,
            // Lembrete já "enviado": o envio automático não pega (chip de testes ligado).
            reminder_sent_at: createdAt,
            reminder_response: confirmed ? "confirmed" : null,
            reminder_response_at: confirmed ? new Date(now.getTime() - 3600_000) : null,
            patient_confirmed_at: confirmed ? new Date(now.getTime() - 3600_000) : null,
          });
        }
      }
    }
  }
  appointments.sort((a, b) => a.scheduled_at - b.scheduled_at);
  await insertMany(db, "appointments", appointments);

  // Quem o cliente tinha desligado continua desligado.
  const off = built.filter((p) => wasActive.get(p.name) === false);
  if (off.length) {
    // Como a tela (Configurações › Profissionais): só o profissional.
    await db.query("update public.professionals set is_active = false where clinic_id = $1 and id = any($2)", [clinic.id, off.map((p) => p.profId)]);
  }

  await db.query("commit");
  console.log(`Criado: 10 profissionais (${off.length} desligados), ${contactRows.length} contatos, ${patientRows.length} pacientes, ${appointments.length} atendimentos.`);
  for (const p of built) {
    const n = appointments.filter((a) => a.agenda_id === p.agendaId).length;
    console.log(`  ${p.name.padEnd(22)} ${p.sp.label.padEnd(17)} ${n} atendimentos`);
  }
} catch (error) {
  await db.query("rollback").catch(() => {});
  console.error("Erro (nada gravado):", error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
