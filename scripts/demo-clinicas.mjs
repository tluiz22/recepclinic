// Clínicas de demonstração para a venda (cliente, 11/out/2026): uma por plano,
// com nomes e dados fictícios. Monta do zero as 3 clínicas (e só elas) com os
// atendimentos a partir de hoje: rodar de novo antes de uma demonstração
// deixa a agenda em dia. Os logins de Administrador são mantidos entre uma
// rodada e outra (a senha é criada por scripts/link-de-senha.mjs).
//
//   Básico                       Pediatria Sol Nascente   demo.basico@recepclinic.com.br
//   Básico + Exames + Espera     Odonto Sorriso Leve      demo.odonto@recepclinic.com.br
//   Completo (3 profissionais)   Clínica Vida Plena       demo.completo@recepclinic.com.br
//
// Os itens de cada plano seguem src/lib/plans.ts.
//
// Uso (na raiz do projeto):
//   node --env-file=.env.staging scripts/demo-clinicas.mjs              → só mostra o que faria
//   node --env-file=.env.staging scripts/demo-clinicas.mjs --confirmar  → monta as 3 clínicas
//
// O chip de testes (só com pedido do cliente): passa a conexão de WhatsApp da
// clínica de testes para a Vida Plena, e devolve. Com o chip, a Vida Plena
// fica com os envios automáticos desligados (os telefones são fictícios).
//   node --env-file=.env.staging scripts/demo-clinicas.mjs --chip-para-demo --confirmar
//   node --env-file=.env.staging scripts/demo-clinicas.mjs --chip-devolver --confirmar
//
// Com o .env local, usa o banco local (senha dos logins: recepclinic-local).

import { readFileSync } from "node:fs";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const confirm = process.argv.includes("--confirmar");
const chipToDemo = process.argv.includes("--chip-para-demo");
const chipBack = process.argv.includes("--chip-devolver");

const { PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, SUPABASE_DB_PASSWORD: dbPassword } = process.env;
if (!url || !key) {
  console.error("Faltam PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY: rode com node --env-file=.env.staging");
  process.exit(1);
}
const local = /127\.0\.0\.1|localhost/.test(url);

function databaseUrl() {
  if (local) return "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  if (!dbPassword) {
    console.error("Falta SUPABASE_DB_PASSWORD no .env.staging.");
    process.exit(1);
  }
  const pooler = readFileSync(new URL("../supabase/.temp/pooler-url", import.meta.url), "utf8").trim();
  return pooler.replace("@", `:${encodeURIComponent(dbPassword)}@`);
}

const TZ = "America/Sao_Paulo";
// Clínica de testes ligada ao chip (+55 61 9903-3143) no staging.
const TEST_CLINIC_NAME = "Consultorio Tluiz22";

const METRICS = ["metrics_overview", "metrics_appointments", "metrics_no_shows", "metrics_recall", "metrics_funnel", "metrics_financial", "metrics_personal"];
const BASIC = ["whatsapp_bot", "reminders", "daily_summary"];
const COMPLETE = [...BASIC, "exams", "waitlist", ...METRICS, "custom_messages", "custom_templates", "home_visit", "insurance", "team_summary"];

// ---------------------------------------------------------------------------
// Datas: dias úteis a partir de hoje, no fuso das clínicas
// ---------------------------------------------------------------------------

const todayLocal = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

function addDays(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const isWeekend = (iso) => [0, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay());

/** n-ésimo dia útil: 0 = hoje (ou o próximo, no fim de semana); negativo = para trás. */
function businessDay(n) {
  let day = todayLocal;
  while (isWeekend(day)) day = addDays(day, 1);
  const step = n < 0 ? -1 : 1;
  for (let left = Math.abs(n); left > 0; ) {
    day = addDays(day, step);
    if (!isWeekend(day)) left -= 1;
  }
  return day;
}

// ---------------------------------------------------------------------------
// As 3 clínicas
// ---------------------------------------------------------------------------

const CLINICS = [
  {
    id: "de000000-0000-4000-8000-000000000001",
    name: "Pediatria Sol Nascente",
    plan: "Básico",
    email: "demo.basico@recepclinic.com.br",
    features: BASIC,
    maxProfessionals: 1,
    settings: {
      profile: "pediatric",
      consultation_age_limit_years: 14,
      brand_color: "#EA580C",
      bot_payment_info: "Pix, cartão de crédito e débito.",
      bot_notes: "Atendemos de segunda a sexta, das 8h às 12h e das 14h às 18h.",
    },
    professionals: [{ key: "laura", name: "Dra. Laura Mendes", profession: "Médica", specialty: "Pediatria", council: "CRM", number: "123456", state: "SP", admin: true }],
    locations: [{ key: "office", name: "Consultório", type: "clinic", address: "Rua das Acácias, 120, sala 4 · Jardim Primavera, São Paulo" }],
    agendas: [{ key: "laura", professional: "laura" }],
    services: [
      { key: "consulta", name: "Consulta pediátrica", category: "consultation", minutes: 30, price: 35000, agendas: ["laura"], locations: ["office"] },
      { key: "retorno", name: "Retorno pediátrico", category: "return_visit", minutes: 20, price: 0, returnDays: 30, agendas: ["laura"], locations: ["office"] },
    ],
    windows: [
      ...[1, 2, 3, 4, 5].map((weekday) => ({ agenda: "laura", location: "office", weekday, start: "08:00", end: "12:00" })),
      ...[1, 3].map((weekday) => ({ agenda: "laura", location: "office", weekday, start: "14:00", end: "18:00" })),
    ],
    insurance: [],
    people: [
      { key: "lucas", name: "Lucas Almeida", age: 4, contact: "Fernanda Almeida" },
      { key: "sofia", name: "Sofia Almeida", age: 1, contact: "Fernanda Almeida" },
      { key: "miguel", name: "Miguel Rocha", age: 7, contact: "André Rocha" },
      { key: "alice", name: "Alice Campos", age: 2, contact: "Juliana Campos" },
      { key: "davi", name: "Davi Nogueira", age: 10, contact: "Patrícia Nogueira" },
      { key: "helena", name: "Helena Prado", age: 5, contact: "Ricardo Prado" },
      { key: "theo", name: "Théo Barros", age: 3, contact: "Camila Barros" },
      { key: "laura_p", name: "Laura Fontes", age: 8, contact: "Bruno Fontes" },
    ],
    appointments: [
      { ref: "lucas_past", person: "lucas", service: "consulta", agenda: "laura", day: -6, time: "09:00", status: "completed" },
      { person: "miguel", service: "consulta", agenda: "laura", day: -6, time: "10:00", status: "no_show" },
      { person: "alice", service: "consulta", agenda: "laura", day: -3, time: "08:30", status: "completed" },
      { person: "davi", service: "consulta", agenda: "laura", day: -1, time: "14:00", status: "completed" },
      { person: "helena", service: "consulta", agenda: "laura", day: 0, time: "08:00", status: "confirmed" },
      { person: "lucas", service: "retorno", agenda: "laura", day: 0, time: "08:30", origin: "lucas_past" },
      { person: "theo", service: "consulta", agenda: "laura", day: 0, time: "09:00", status: "canceled" },
      { person: "sofia", service: "consulta", agenda: "laura", day: 0, time: "10:00" },
      { person: "laura_p", service: "consulta", agenda: "laura", day: 1, time: "08:00", status: "confirmed" },
      { person: "theo", service: "consulta", agenda: "laura", day: 1, time: "09:30", channel: "whatsapp_bot" },
      { person: "miguel", service: "consulta", agenda: "laura", day: 2, time: "10:00", channel: "whatsapp_bot" },
      { person: "alice", service: "consulta", agenda: "laura", day: 4, time: "08:30", channel: "whatsapp_bot" },
    ],
  },
  {
    id: "de000000-0000-4000-8000-000000000002",
    name: "Odonto Sorriso Leve",
    plan: "Básico + Exames e procedimentos + Lista de espera",
    email: "demo.odonto@recepclinic.com.br",
    features: [...BASIC, "exams", "waitlist"],
    maxProfessionals: 1,
    settings: {
      profile: "mixed",
      brand_color: "#0891B2",
      message_noun: "consultório",
      message_noun_article: "o",
      bot_payment_info: "Pix, cartão de crédito em até 3x e débito.",
      bot_notes: "Atendemos de segunda a sexta, das 8h às 18h.",
    },
    professionals: [{ key: "felipe", name: "Dr. Felipe Andrade", profession: "Cirurgião-dentista", specialty: "Clínica geral e estética", council: "CRO", number: "54321", state: "SP", admin: true }],
    locations: [{ key: "office", name: "Consultório", type: "clinic", address: "Av. Brasil, 845, sala 12 · Centro, Campinas" }],
    agendas: [{ key: "felipe", professional: "felipe" }],
    services: [
      { key: "avaliacao", name: "Avaliação odontológica", category: "consultation", minutes: 40, price: 15000, agendas: ["felipe"], locations: ["office"] },
      { key: "retorno", name: "Retorno", category: "return_visit", minutes: 20, price: 0, returnDays: 30, agendas: ["felipe"], locations: ["office"] },
      { key: "limpeza", name: "Limpeza (profilaxia)", category: "exam", minutes: 40, price: 22000, agendas: ["felipe"], locations: ["office"] },
      { key: "restauracao", name: "Restauração", category: "exam", minutes: 60, price: 28000, agendas: ["felipe"], locations: ["office"] },
      { key: "clareamento", name: "Clareamento", category: "exam", minutes: 60, price: 90000, agendas: ["felipe"], locations: ["office"], preparation: "Evite café, chá e refrigerante escuro nas 48 horas antes e depois da sessão." },
    ],
    windows: [1, 2, 3, 4, 5].flatMap((weekday) => [
      { agenda: "felipe", location: "office", weekday, start: "08:00", end: "12:00" },
      { agenda: "felipe", location: "office", weekday, start: "14:00", end: "18:00" },
    ]),
    insurance: [],
    people: [
      { key: "marcia", name: "Márcia Teixeira", age: 42 },
      { key: "roberto", name: "Roberto Siqueira", age: 55 },
      { key: "gabriela", name: "Gabriela Moura", age: 29 },
      { key: "enzo", name: "Enzo Moura", age: 9, contact: "Gabriela Moura" },
      { key: "claudio", name: "Cláudio Ferraz", age: 61 },
      { key: "bianca", name: "Bianca Lins", age: 34 },
      { key: "tiago", name: "Tiago Duarte", age: 23 },
      { key: "vera", name: "Vera Lúcia Santos", age: 68 },
    ],
    appointments: [
      { ref: "marcia_past", person: "marcia", service: "avaliacao", agenda: "felipe", day: -5, time: "08:00", status: "completed" },
      { person: "roberto", service: "limpeza", agenda: "felipe", day: -5, time: "09:00", status: "completed" },
      { person: "tiago", service: "avaliacao", agenda: "felipe", day: -2, time: "14:00", status: "no_show" },
      { person: "marcia", service: "restauracao", agenda: "felipe", day: 0, time: "08:00", status: "confirmed" },
      { person: "gabriela", service: "limpeza", agenda: "felipe", day: 0, time: "09:30", channel: "whatsapp_bot" },
      { person: "enzo", service: "avaliacao", agenda: "felipe", day: 0, time: "10:30", status: "canceled" },
      { person: "claudio", service: "avaliacao", agenda: "felipe", day: 0, time: "14:00", status: "confirmed" },
      { person: "marcia", service: "retorno", agenda: "felipe", day: 1, time: "08:00", origin: "marcia_past" },
      { person: "bianca", service: "clareamento", agenda: "felipe", day: 1, time: "14:00", channel: "whatsapp_bot" },
      { person: "vera", service: "limpeza", agenda: "felipe", day: 2, time: "09:00" },
      { person: "roberto", service: "restauracao", agenda: "felipe", day: 3, time: "15:00", channel: "whatsapp_bot" },
      // Lista de espera: quer antecipar a avaliação marcada para daqui a 8 dias úteis.
      { person: "tiago", service: "avaliacao", agenda: "felipe", day: 8, time: "16:00", channel: "whatsapp_bot", waitlist: true },
    ],
  },
  {
    id: "de000000-0000-4000-8000-000000000003",
    name: "Clínica Vida Plena",
    plan: "Completo",
    email: "demo.completo@recepclinic.com.br",
    features: COMPLETE,
    maxProfessionals: 3,
    settings: {
      profile: "mixed",
      brand_color: "#4F46E5",
      require_insurance_details: true,
      bot_payment_info: "Pix, cartão de crédito em até 3x e débito.",
      bot_insurance_info: "Atendemos Unimed, SulAmérica e Bradesco Saúde. Traga a carteirinha e um documento com foto.",
      bot_notes: "Estacionamento conveniado ao lado da clínica. Chegue 10 minutos antes.",
    },
    professionals: [
      { key: "marcos", name: "Dr. Marcos Ribeiro", profession: "Médico", specialty: "Clínica médica", council: "CRM", number: "234567", state: "SP", admin: true },
      { key: "camila", name: "Dra. Camila Torres", profession: "Médica", specialty: "Pediatria", council: "CRM", number: "345678", state: "SP" },
      { key: "renata", name: "Dra. Renata Lopes", profession: "Médica", specialty: "Cardiologia", council: "CRM", number: "456789", state: "SP" },
    ],
    locations: [
      { key: "office", name: "Clínica Vida Plena", type: "clinic", address: "Rua Harmonia, 300 · Vila Mariana, São Paulo" },
      { key: "home", name: "Atendimento domiciliar", type: "home_visit" },
    ],
    agendas: [
      { key: "marcos", professional: "marcos" },
      { key: "camila", professional: "camila" },
      { key: "renata", professional: "renata" },
      { key: "exames", name: "Exames", kind: "resource" },
    ],
    services: [
      { key: "clinica", name: "Consulta de clínica médica", category: "consultation", minutes: 30, price: 40000, agendas: ["marcos"], locations: ["office", "home"], homePrice: 60000 },
      { key: "pediatrica", name: "Consulta pediátrica", category: "consultation", minutes: 30, price: 38000, agendas: ["camila"], locations: ["office"] },
      { key: "cardio", name: "Consulta cardiológica", category: "consultation", minutes: 40, price: 50000, agendas: ["renata"], locations: ["office"] },
      { key: "retorno", name: "Retorno", category: "return_visit", minutes: 20, price: 0, returnDays: 30, agendas: ["marcos", "camila", "renata"], locations: ["office"] },
      { key: "ecg", name: "Eletrocardiograma", category: "exam", minutes: 20, price: 15000, agendas: ["exames"], locations: ["office"], preparation: "Use roupa confortável e *evite* hidratante no peito no dia do exame." },
    ],
    windows: [
      ...[1, 2, 3, 4, 5].map((weekday) => ({ agenda: "marcos", location: "office", weekday, start: "08:00", end: "12:00" })),
      { agenda: "marcos", location: "home", weekday: 4, start: "14:00", end: "17:00" },
      ...[1, 3, 5].map((weekday) => ({ agenda: "camila", location: "office", weekday, start: "08:00", end: "12:00" })),
      ...[2, 4].map((weekday) => ({ agenda: "camila", location: "office", weekday, start: "14:00", end: "18:00" })),
      ...[2, 4].map((weekday) => ({ agenda: "renata", location: "office", weekday, start: "08:00", end: "12:00" })),
      ...[1, 3].map((weekday) => ({ agenda: "renata", location: "office", weekday, start: "14:00", end: "18:00" })),
      ...[1, 2, 3, 4, 5].map((weekday) => ({ agenda: "exames", location: "office", weekday, start: "07:00", end: "09:00", service: "ecg" })),
    ],
    insurance: ["Unimed", "SulAmérica", "Bradesco Saúde"],
    teamRecipients: [{ label: "Recepção", phone: "+5511900003999" }],
    people: [
      { key: "antonio", name: "Antônio Carvalho", age: 64, insurance: "Unimed" },
      { key: "beatriz", name: "Beatriz Monteiro", age: 37, insurance: "SulAmérica" },
      { key: "pedro", name: "Pedro Monteiro", age: 6, contact: "Beatriz Monteiro", insurance: "SulAmérica" },
      { key: "carla", name: "Carla Mendes", age: 45 },
      { key: "jorge", name: "Jorge Batista", age: 72, insurance: "Bradesco Saúde", address: "Rua dos Ipês, 55, ap. 31 · Vila Mariana" },
      { key: "luiza", name: "Luíza Farias", age: 3, contact: "Renan Farias" },
      { key: "eduardo", name: "Eduardo Pires", age: 51, insurance: "Unimed" },
      { key: "simone", name: "Simone Araújo", age: 58 },
      { key: "rafaela", name: "Rafaela Costa", age: 26 },
      { key: "henrique", name: "Henrique Dias", age: 39, insurance: "Bradesco Saúde" },
      { key: "isabela", name: "Isabela Gomes", age: 11, contact: "Mônica Gomes" },
      { key: "olavo", name: "Olavo Pacheco", age: 67, insurance: "Unimed" },
      { key: "nathalia", name: "Nathália Rezende", age: 31 },
      { key: "gustavo", name: "Gustavo Lima", age: 44, insurance: "SulAmérica" },
    ],
    appointments: [
      // Últimas semanas (para as métricas).
      { ref: "antonio_past", person: "antonio", service: "clinica", agenda: "marcos", day: -15, time: "08:00", status: "completed" },
      { person: "carla", service: "clinica", agenda: "marcos", day: -15, time: "09:00", status: "no_show" },
      { person: "beatriz", service: "cardio", agenda: "renata", day: -14, time: "08:00", status: "completed", channel: "whatsapp_bot" },
      { person: "pedro", service: "pediatrica", agenda: "camila", day: -12, time: "08:30", status: "completed", channel: "whatsapp_bot" },
      { person: "eduardo", service: "cardio", agenda: "renata", day: -11, time: "09:00", status: "completed" },
      { person: "simone", service: "clinica", agenda: "marcos", day: -10, time: "10:00", status: "no_show", channel: "whatsapp_bot" },
      { person: "henrique", service: "ecg", agenda: "exames", day: -9, time: "07:00", status: "completed" },
      { person: "olavo", service: "clinica", agenda: "marcos", day: -8, time: "08:30", status: "completed", channel: "whatsapp_bot" },
      { person: "rafaela", service: "clinica", agenda: "marcos", day: -7, time: "11:00", status: "canceled", channel: "whatsapp_bot" },
      { person: "isabela", service: "pediatrica", agenda: "camila", day: -6, time: "09:00", status: "completed", channel: "whatsapp_bot" },
      { ref: "gustavo_past", person: "gustavo", service: "cardio", agenda: "renata", day: -5, time: "14:00", status: "completed", channel: "whatsapp_bot" },
      { person: "nathalia", service: "clinica", agenda: "marcos", day: -4, time: "09:30", status: "completed" },
      { person: "carla", service: "clinica", agenda: "marcos", day: -3, time: "08:00", status: "completed", channel: "whatsapp_bot" },
      { person: "luiza", service: "pediatrica", agenda: "camila", day: -2, time: "10:00", status: "no_show" },
      { person: "jorge", service: "clinica", agenda: "marcos", day: -1, time: "09:00", status: "completed" },
      // Cancelado pela clínica (bloqueio): fica em "Aguardando remarcação".
      { person: "simone", service: "cardio", agenda: "renata", day: -1, time: "15:00", status: "canceled", massCanceled: true },
      // Hoje e próximos dias.
      { person: "antonio", service: "retorno", agenda: "marcos", day: 0, time: "08:00", origin: "antonio_past", status: "confirmed" },
      { person: "eduardo", service: "clinica", agenda: "marcos", day: 0, time: "08:30", channel: "whatsapp_bot" },
      { person: "rafaela", service: "clinica", agenda: "marcos", day: 0, time: "09:30", status: "canceled", channel: "whatsapp_bot" },
      { person: "henrique", service: "ecg", agenda: "exames", day: 0, time: "07:20", status: "confirmed", channel: "whatsapp_bot" },
      { person: "pedro", service: "pediatrica", agenda: "camila", day: 0, time: "08:00", status: "confirmed", channel: "whatsapp_bot" },
      { person: "isabela", service: "pediatrica", agenda: "camila", day: 0, time: "08:30" },
      { person: "gustavo", service: "retorno", agenda: "renata", day: 1, time: "08:00", origin: "gustavo_past", channel: "whatsapp_bot" },
      { person: "olavo", service: "cardio", agenda: "renata", day: 1, time: "09:00", status: "confirmed" },
      { person: "beatriz", service: "clinica", agenda: "marcos", day: 1, time: "10:00", channel: "whatsapp_bot" },
      { person: "jorge", service: "clinica", agenda: "marcos", day: 2, time: "08:00", channel: "admin" },
      { person: "nathalia", service: "ecg", agenda: "exames", day: 2, time: "07:00", channel: "whatsapp_bot" },
      { person: "luiza", service: "pediatrica", agenda: "camila", day: 2, time: "09:00", channel: "whatsapp_bot" },
      { person: "carla", service: "cardio", agenda: "renata", day: 3, time: "10:00", channel: "whatsapp_bot" },
      // Consulta domiciliar (quinta à tarde).
      { person: "jorge", service: "clinica", agenda: "marcos", weekday: 4, time: "14:30", location: "home", channel: "admin" },
      // Lista de espera: quer antecipar a consulta com a cardiologista.
      { person: "simone", service: "cardio", agenda: "renata", day: 9, time: "16:00", channel: "whatsapp_bot", waitlist: true },
    ],
    blocks: [{ agenda: "marcos", day: 5, start: "08:00", end: "12:00", reason: "Congresso de clínica médica" }],
    // Quantas conversas chegam a cada etapa do funil (FUNNEL_STEPS).
    funnel: { sessions: 24, reached: [24, 21, 19, 18, 16, 15] },
  },
];

// Etapas do funil de marcação (src/lib/data/botFunnel.ts) e de onde vêm.
const FUNNEL_STEPS = [
  ["started", "bot"],
  ["BOOK_FOR_WHOM", "bot"],
  ["patient_identified", "bot"],
  ["link_sent", "bot"],
  ["page_opened", "web"],
  ["confirmed", "web"],
];

// ---------------------------------------------------------------------------
// Logins (Auth): criados uma vez, mantidos entre as rodadas
// ---------------------------------------------------------------------------

const auth = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUser(email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await auth.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === email);
    if (user) return user.id;
    if (data.users.length < 200) return null;
  }
}

async function ensureUser(email) {
  const existing = await findUser(email);
  if (existing) return existing;
  const { data, error } = await auth.auth.admin.createUser({ email, email_confirm: true, ...(local ? { password: "recepclinic-local" } : {}) });
  if (error) throw error;
  return data.user.id;
}

// ---------------------------------------------------------------------------
// Montagem de uma clínica
// ---------------------------------------------------------------------------

const phoneOf = (clinicIndex, n) => `+55119000${clinicIndex + 1}${String(n).padStart(4, "0")}`;
const birthdate = (age) => addDays(todayLocal, -Math.round(age * 365.25 + 40));

/** Dia do atendimento: dia útil relativo a hoje, ou o próximo dia da semana pedido. */
function dayOf(appointment) {
  if (appointment.weekday === undefined) return businessDay(appointment.day);
  let day = addDays(todayLocal, 1);
  while (new Date(`${day}T12:00:00Z`).getUTCDay() !== appointment.weekday) day = addDays(day, 1);
  return day;
}

async function insert(db, table, row) {
  const columns = Object.keys(row);
  const values = Object.values(row);
  const sql = `insert into public.${table} (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
  const { rows } = await db.query(sql, values);
  return rows[0];
}

/** Instante no fuso das clínicas (o banco converte). */
const at = async (db, day, time) => (await db.query("select (($1::date + $2::time) at time zone $3) as t", [day, time, TZ])).rows[0].t;

async function buildClinic(db, clinic, index, adminId) {
  await db.query("delete from public.clinics where id = $1", [clinic.id]);
  await insert(db, "clinics", { id: clinic.id, name: clinic.name, max_professionals: clinic.maxProfessionals });
  const settings = { timezone: TZ, ...clinic.settings };
  const sets = Object.keys(settings).map((column, i) => `${column} = $${i + 2}`);
  await db.query(`update public.clinic_settings set ${sets.join(", ")} where clinic_id = $1`, [clinic.id, ...Object.values(settings)]);
  for (const feature of clinic.features) await insert(db, "clinic_features", { clinic_id: clinic.id, feature_key: feature });
  await insert(db, "clinic_members", { clinic_id: clinic.id, user_id: adminId, roles: clinic.professionals.some((p) => p.admin) ? "{admin,professional}" : "{admin}" });

  const ids = { professional: {}, location: {}, agenda: {}, service: {}, insurance: {}, patient: {}, appointment: {} };
  for (const p of clinic.professionals) {
    ids.professional[p.key] = (
      await insert(db, "professionals", {
        clinic_id: clinic.id,
        user_id: p.admin ? adminId : null,
        display_name: p.name,
        profession: p.profession,
        specialty: p.specialty,
        council: p.council,
        council_number: p.number,
        council_state: p.state,
      })
    ).id;
  }
  for (const l of clinic.locations) ids.location[l.key] = (await insert(db, "locations", { clinic_id: clinic.id, name: l.name, type: l.type, address: l.address ?? null })).id;
  for (const a of clinic.agendas) {
    const professional = clinic.professionals.find((p) => p.key === a.professional);
    ids.agenda[a.key] = (
      await insert(db, "agendas", {
        clinic_id: clinic.id,
        name: a.name ?? professional.name,
        kind: a.kind ?? "professional",
        professional_id: a.professional ? ids.professional[a.professional] : null,
      })
    ).id;
  }
  for (const s of clinic.services) {
    ids.service[s.key] = (
      await insert(db, "services", {
        clinic_id: clinic.id,
        name: s.name,
        category: s.category,
        duration_minutes: s.minutes,
        price_cents: s.price,
        return_deadline_days: s.returnDays ?? null,
        preparation_instructions: s.preparation ?? null,
      })
    ).id;
    for (const agenda of s.agendas) await insert(db, "service_agendas", { clinic_id: clinic.id, service_id: ids.service[s.key], agenda_id: ids.agenda[agenda] });
    for (const location of s.locations) {
      const home = clinic.locations.find((l) => l.key === location).type === "home_visit";
      await insert(db, "service_locations", { clinic_id: clinic.id, service_id: ids.service[s.key], location_id: ids.location[location], price_cents: home ? (s.homePrice ?? null) : null });
    }
  }
  for (const w of clinic.windows) {
    await insert(db, "availability_windows", {
      clinic_id: clinic.id,
      agenda_id: ids.agenda[w.agenda],
      location_id: ids.location[w.location],
      service_id: w.service ? ids.service[w.service] : null,
      weekday: w.weekday,
      start_time: w.start,
      end_time: w.end,
    });
  }
  for (const name of clinic.insurance) ids.insurance[name] = (await insert(db, "insurance_plans", { clinic_id: clinic.id, name })).id;
  for (const r of clinic.teamRecipients ?? []) await insert(db, "notification_recipients", { clinic_id: clinic.id, label: r.label, phone: r.phone });

  // Pacientes: quem não tem responsável é o próprio contato.
  const contacts = new Map();
  let phone = 0;
  for (const person of clinic.people) {
    const contactName = person.contact ?? person.name;
    if (!contacts.has(contactName)) {
      phone += 1;
      contacts.set(contactName, (await insert(db, "contacts", { clinic_id: clinic.id, full_name: contactName, phone: phoneOf(index, phone), default_home_address: person.address ?? null })).id);
    }
    ids.patient[person.key] = (
      await insert(db, "patients", {
        clinic_id: clinic.id,
        contact_id: contacts.get(contactName),
        full_name: person.name,
        birthdate: birthdate(person.age),
        is_contact_self: !person.contact,
        insurance_plan_id: person.insurance ? ids.insurance[person.insurance] : null,
      })
    ).id;
  }

  const now = new Date();
  for (const a of clinic.appointments) {
    const service = clinic.services.find((s) => s.key === a.service);
    const location = a.location ?? "office";
    const scheduledAt = await at(db, dayOf(a), a.time);
    const status = a.status === "confirmed" ? "scheduled" : (a.status ?? "scheduled");
    const person = clinic.people.find((p) => p.key === a.person);
    const row = await insert(db, "appointments", {
      clinic_id: clinic.id,
      patient_id: ids.patient[a.person],
      service_id: ids.service[a.service],
      agenda_id: ids.agenda[a.agenda],
      location_id: ids.location[location],
      scheduled_at: scheduledAt,
      duration_minutes: service.minutes,
      booking_channel: a.channel ?? "admin",
      status,
      origin_appointment_id: a.origin ? ids.appointment[a.origin] : null,
      home_visit_address: location === "home" ? person.address : null,
      created_by: (a.channel ?? "admin") === "admin" ? adminId : null,
      patient_confirmed_at: a.status === "confirmed" ? now : null,
      canceled_at: status === "canceled" ? now : null,
      canceled_via: status === "canceled" ? (a.massCanceled ? "admin" : (a.channel ?? "admin")) : null,
      mass_canceled: !!a.massCanceled,
    });
    if (a.ref) ids.appointment[a.ref] = row.id;
    if (a.waitlist) await insert(db, "waitlist_entries", { clinic_id: clinic.id, appointment_id: row.id });
  }

  for (const b of clinic.blocks ?? []) {
    await insert(db, "schedule_blocks", {
      clinic_id: clinic.id,
      agenda_id: ids.agenda[b.agenda],
      starts_at: await at(db, businessDay(b.day), b.start),
      ends_at: await at(db, businessDay(b.day), b.end),
      reason: b.reason,
      created_by: adminId,
    });
  }

  // Funil do bot: conversas de marcação dos últimos dias (para as métricas).
  if (clinic.funnel) {
    const contactPhones = [...contacts.entries()];
    for (let i = 0; i < clinic.funnel.sessions; i += 1) {
      const [, contactId] = contactPhones[i % contactPhones.length];
      const { rows } = await db.query("select phone from public.contacts where id = $1", [contactId]);
      const session = (await db.query("select gen_random_uuid() as id")).rows[0].id;
      const when = await at(db, businessDay(-(i % 15) - 1), `${String(8 + (i % 10)).padStart(2, "0")}:15`);
      // Cada conversa vai até uma etapa; as primeiras chegam ao fim.
      const depth = FUNNEL_STEPS.filter((_, stage) => i < clinic.funnel.reached[stage]);
      for (const [step, source] of depth) {
        await insert(db, "bot_funnel_events", { clinic_id: clinic.id, session_id: session, flow: "booking", step, source, contact_phone: rows[0].phone, contact_id: contactId, occurred_at: when });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Chip de testes (só com pedido do cliente)
// ---------------------------------------------------------------------------

const DEMO_WITH_CHIP = CLINICS[2];

async function moveChip(db, toDemo) {
  const { rows: test } = await db.query("select id from public.clinics where name = $1", [TEST_CLINIC_NAME]);
  if (!test.length) throw new Error(`Clínica de testes "${TEST_CLINIC_NAME}" não encontrada.`);
  const [from, to] = toDemo ? [test[0].id, DEMO_WITH_CHIP.id] : [DEMO_WITH_CHIP.id, test[0].id];
  const { rows } = await db.query("select phone_number_id, display_phone from public.whatsapp_connections where clinic_id = $1", [from]);
  if (!rows.length) throw new Error("Nenhuma conexão de WhatsApp para mover (o chip já está do outro lado?).");
  console.log(`${toDemo ? "Para a demo" : "De volta"}: ${rows[0].display_phone ?? rows[0].phone_number_id}`);
  if (!confirm) return;
  await db.query("update public.whatsapp_connections set clinic_id = $2 where clinic_id = $1", [from, to]);
  if (toDemo) {
    // Os templates aprovados da conta seguem o chip; os envios automáticos ficam desligados.
    await db.query("delete from public.whatsapp_templates where clinic_id = $1", [to]);
    await db.query(
      `insert into public.whatsapp_templates (clinic_id, template_key, name, language, status, meta_template_id, version, body, stage)
       select $2, template_key, name, language, status, meta_template_id, version, body, stage from public.whatsapp_templates where clinic_id = $1`,
      [from, to],
    );
    await db.query("update public.clinic_settings set reminder_enabled = false, professional_summary_enabled = false, team_summary_enabled = false where clinic_id = $1", [to]);
  }
}

// ---------------------------------------------------------------------------

const db = new pg.Client({ connectionString: databaseUrl(), ssl: local ? false : { rejectUnauthorized: false } });
await db.connect();
try {
  console.log(`${confirm ? "=== APLICANDO ===" : "=== SIMULAÇÃO (nada muda; use --confirmar) ==="} ${local ? "banco local" : "staging"}\n`);
  if (chipToDemo || chipBack) {
    await db.query("begin");
    await moveChip(db, chipToDemo);
    await db.query(confirm ? "commit" : "rollback");
  } else {
    const { rows: chip } = await db.query("select 1 from public.whatsapp_connections where clinic_id = $1", [DEMO_WITH_CHIP.id]);
    if (chip.length) {
      console.error("O chip de testes está na Vida Plena: devolva antes (--chip-devolver), ou a conexão seria apagada junto.");
      process.exit(1);
    }
    for (const [index, clinic] of CLINICS.entries()) {
      console.log(`${clinic.name} (${clinic.plan}): ${clinic.professionals.length} profissional(is), ${clinic.people.length} pacientes, ${clinic.appointments.length} atendimentos · login ${clinic.email}`);
      if (!confirm) continue;
      const adminId = await ensureUser(clinic.email);
      await db.query("begin");
      try {
        await buildClinic(db, clinic, index, adminId);
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw new Error(`${clinic.name}: ${error.message}`);
      }
    }
    if (confirm) console.log(`\nPronto. Atendimentos a partir de ${businessDay(0)}. Senha de cada login: scripts/link-de-senha.mjs <e-mail>.`);
  }
} finally {
  await db.end();
}
