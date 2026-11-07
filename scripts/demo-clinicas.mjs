// Clínicas de demonstração para a venda (cliente, 11/out/2026; carga completa
// em 02/nov/2026): nomes, telefones e dados fictícios. Monta do zero as 4
// clínicas (e só elas) com a agenda das 3 últimas semanas (histórico das
// Métricas) até 2 semanas à frente: rodar de novo antes de uma apresentação
// deixa tudo em dia. Os logins de Administrador são mantidos entre uma rodada
// e outra (a senha é criada por scripts/link-de-senha.mjs).
//
//   Básico                       Pediatria Sol Nascente            demo.basico@recepclinic.com.br
//   Básico + Exames + Espera     Odonto Sorriso Leve               demo.odonto@recepclinic.com.br
//   Completo (3 profissionais)   Clínica Vida Plena                demo.completo@recepclinic.com.br
//   Tudo ligado (4 profiss.)     Clínica Demonstração RecepClinic  demo.recepclinic@recepclinic.com.br
//
// Sem o módulo Financeiro (cliente, 02/nov/2026: o módulo não está pronto).
// A Demonstração RecepClinic é também a clínica do analista da Meta
// (analista.meta@recepclinic.com.br, bloqueado no Auth): o vínculo dele é refeito.
//
// Cenários (cada clínica recebe os que o plano dela permite): agenda com
// horários livres; agendado, confirmado pelo lembrete, sem resposta, lembrete
// não entregue, atendido, faltou, cancelado pelo paciente (bot) e pela
// recepção, remarcado; marcado pelo bot e pela recepção; retorno ligado à
// consulta; exame com preparo; domiciliar; convênio; bloqueio com
// cancelamento em massa (Aguardando remarcação); feriado da clínica; lista de
// espera (na fila e um antecipado por oferta aceita); séries semanais;
// conversas na Recepção (aguardando e em atendimento); tentativas do bot que
// pararam no meio (Retomar contato); faltosos; contato para revisar;
// perguntas que o bot não reconheceu; anotações e lembretes da equipe.
//
// Uso (na raiz do projeto):
//   node --env-file=.env.staging scripts/demo-clinicas.mjs              → só mostra o que faria
//   node --env-file=.env.staging scripts/demo-clinicas.mjs --confirmar  → monta as 4 clínicas
//   ... --confirmar --trocar-senhas                                     → e troca as senhas dos logins
//
// Senhas (cliente, 02/nov/2026): o login que ainda não tem ganha uma senha, guardada
// no app_metadata.demo_password dele (o repositório é público: nada de senha no
// código). Vendas › Demonstração mostra as senhas ao Suporte.
//
// O chip de testes (só com pedido do cliente): passa a conexão de WhatsApp da
// clínica de testes para a Vida Plena, e devolve. Com o chip, a Vida Plena
// fica com os envios automáticos desligados (os telefones são fictícios).
//   node --env-file=.env.staging scripts/demo-clinicas.mjs --chip-para-demo --confirmar
//   node --env-file=.env.staging scripts/demo-clinicas.mjs --chip-devolver --confirmar
//
// Com o .env local, usa o banco local (senha dos logins: recepclinic-local).

import { readFileSync } from "node:fs";
import { randomInt, randomUUID } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { isNationalHoliday } from "../src/lib/holidays.ts";

// Nunca na produção (F10.0c): o .env.production tem RECEPCLINIC_PRODUCAO=1 e o
// SITE_URL do app.; com qualquer um dos dois, o script para antes de tocar no banco.
if (process.env.RECEPCLINIC_PRODUCAO === "1" || /^https:\/\/app\.recepclinic\.com\.br/.test(process.env.SITE_URL ?? "")) {
  console.error("Este script é só de teste e não roda na produção (.env.production).");
  process.exit(1);
}

const confirm = process.argv.includes("--confirmar");
const chipToDemo = process.argv.includes("--chip-para-demo");
const chipBack = process.argv.includes("--chip-devolver");
const newPasswords = process.argv.includes("--trocar-senhas");

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
// São Paulo sem horário de verão desde 2019: o instante local é sempre -03:00.
const OFFSET = "-03:00";
// Clínica de testes ligada ao chip (+55 61 9903-3143) no staging.
const TEST_CLINIC_NAME = "Consultorio Tluiz22";
const META_ANALYST = "analista.meta@recepclinic.com.br";

const METRICS = ["metrics_performance", "metrics_no_shows", "metrics_recall", "metrics_funnel", "metrics_financial", "metrics_personal"];
const BASIC = ["whatsapp_bot", "reminders", "daily_summary", "knowledge_base"];
const COMPLETE = [...BASIC, "exams", "waitlist", ...METRICS, "custom_messages", "custom_templates", "home_visit", "insurance", "team_summary"];
// Tudo, menos o módulo Financeiro (finance).
const EVERYTHING = [...COMPLETE, "relationship", "series"];

/** Histórico (dias úteis para trás) e horizonte (dias úteis à frente). */
const PAST_DAYS = 15;
const FUTURE_DAYS = 10;

// ---------------------------------------------------------------------------
// Datas: dias úteis a partir de hoje, no fuso das clínicas
// ---------------------------------------------------------------------------

const NOW = new Date();
const todayLocal = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(NOW);

function addDays(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const weekdayOf = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const isWeekend = (iso) => [0, 6].includes(weekdayOf(iso));

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

const at = (day, time) => new Date(`${day}T${time}:00${OFFSET}`);
const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const toMinutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const localDateOf = (instant) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(instant);
const plusMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60_000);
const HOUR = 60;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// Sorteio com semente (a mesma rodada dá a mesma agenda no mesmo dia)
// ---------------------------------------------------------------------------

function seeded(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    weighted: (entries) => {
      const total = entries.reduce((sum, [, w]) => sum + w, 0);
      let r = next() * total;
      for (const [value, w] of entries) if ((r -= w) < 0) return value;
      return entries.at(-1)[0];
    },
  };
}

// ---------------------------------------------------------------------------
// Pessoas fictícias
// ---------------------------------------------------------------------------

const FIRST_F = ["Ana", "Beatriz", "Carla", "Daniela", "Eliane", "Fernanda", "Gabriela", "Helena", "Isabela", "Juliana", "Larissa", "Mariana", "Natália", "Patrícia", "Renata", "Simone", "Tatiane", "Vanessa", "Cláudia", "Mônica", "Luciana", "Rosana", "Sandra", "Adriana"];
const FIRST_M = ["André", "Bruno", "Carlos", "Diego", "Eduardo", "Fábio", "Gustavo", "Henrique", "Igor", "João", "Leonardo", "Marcelo", "Otávio", "Paulo", "Rafael", "Sérgio", "Thiago", "Vítor", "Antônio", "Jorge", "Roberto", "Cláudio", "Márcio", "Ricardo"];
const KIDS = ["Alice", "Arthur", "Bernardo", "Cecília", "Davi", "Elisa", "Enzo", "Gael", "Heitor", "Isis", "Lara", "Lorena", "Lucas", "Manuela", "Miguel", "Nina", "Pedro", "Rafaela", "Samuel", "Sofia", "Théo", "Valentina", "Benício", "Laura", "Mateus", "Clara", "Joaquim", "Liz"];
const SURNAMES = ["Almeida", "Barros", "Campos", "Duarte", "Esteves", "Fontes", "Gomes", "Lacerda", "Macedo", "Nogueira", "Oliveira", "Pacheco", "Queiroz", "Rezende", "Siqueira", "Teixeira", "Vasconcelos", "Xavier", "Moura", "Prado", "Carvalho", "Ribeiro", "Monteiro", "Farias", "Pires", "Araújo", "Lima", "Rocha", "Freitas", "Sales"];
const STREETS = ["Rua das Palmeiras", "Rua Bela Vista", "Av. das Nações", "Rua do Sol", "Rua Harmonia", "Rua dos Ipês", "Alameda Santos", "Rua Aurora"];

/**
 * Pessoas da clínica: adultos (paciente e contato de si), crianças com o
 * responsável (às vezes um adulto que também é paciente: a família no mesmo
 * contato) e, se pedido, convênio e endereço para o domiciliar.
 */
function makePeople(rng, { adults, kids, kidMaxAge = 13, insurance = [], homeAddresses = 0, area = "São Paulo" }) {
  const people = [];
  const usedNames = new Set();
  const uniqueName = (first) => {
    for (;;) {
      const name = `${first()} ${rng.pick(SURNAMES)}`;
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
    }
  };
  for (let i = 0; i < adults; i += 1) {
    const female = rng.chance(0.55);
    const age = rng.weighted([[rng.int(19, 35), 3], [rng.int(36, 59), 4], [rng.int(60, 82), 3]]);
    const person = { key: `a${i}`, name: uniqueName(() => rng.pick(female ? FIRST_F : FIRST_M)), age };
    if (insurance.length && rng.chance(0.5)) person.insurance = rng.pick(insurance);
    people.push(person);
  }
  // Endereço para o domiciliar: os mais velhos primeiro.
  [...people].sort((a, b) => b.age - a.age).slice(0, homeAddresses).forEach((p, i) => {
    p.address = `${STREETS[i % STREETS.length]}, ${rng.int(20, 900)}${rng.chance(0.4) ? `, ap. ${rng.int(11, 92)}` : ""} · ${area}`;
  });
  const adultsByParent = people.filter((p) => p.age >= 25 && p.age <= 50);
  const guardians = [];
  for (let i = 0; i < kids; i += 1) {
    let contact;
    // Irmãos: o mesmo responsável de uma criança anterior.
    if (guardians.length && rng.chance(0.3)) contact = rng.pick(guardians);
    else if (adultsByParent.length && rng.chance(0.35)) contact = rng.pick(adultsByParent).name;
    else contact = uniqueName(() => rng.pick(rng.chance(0.7) ? FIRST_F : FIRST_M));
    guardians.push(contact);
    const surname = contact.split(" ").at(-1);
    let name;
    do name = `${rng.pick(KIDS)} ${surname}`;
    while (usedNames.has(name));
    usedNames.add(name);
    const person = { key: `k${i}`, name, age: rng.int(0, kidMaxAge), contact };
    const parent = people.find((p) => p.name === contact);
    if (insurance.length && (parent?.insurance || rng.chance(0.4))) person.insurance = parent?.insurance ?? rng.pick(insurance);
    people.push(person);
  }
  return people;
}

// ---------------------------------------------------------------------------
// As 4 clínicas
// ---------------------------------------------------------------------------

const weekdays = (days, agenda, location, start, end, extra = {}) => days.map((weekday) => ({ agenda, location, weekday, start, end, ...extra }));

const CLINICS = [
  {
    id: "de000000-0000-4000-8000-000000000001",
    seed: 101,
    name: "Pediatria Sol Nascente",
    plan: "Básico",
    email: "demo.basico@recepclinic.com.br",
    features: BASIC,
    maxProfessionals: 1,
    settings: {
      profile: "pediatric",
      consultation_age_limit_years: 14,
      brand_color: "#EA580C",
    },
    // Informações que o bot responde (MI, 07/nov/2026): iguais para os profissionais da demonstração.
    botInfo: { payment_info: "Pix, cartão de crédito e débito.", insurance_info: null, notes: "Atendemos de segunda a sexta, das 8h às 12h e das 14h às 18h." },
    professionals: [{ key: "laura", name: "Dra. Laura Mendes", profession: "Médica", specialty: "Pediatria", council: "CRM", number: "123456", state: "SP", admin: true }],
    locations: [{ key: "office", name: "Consultório", type: "clinic", address: "Rua das Acácias, 120, sala 4 · Jardim Primavera, São Paulo" }],
    agendas: [{ key: "laura", professional: "laura" }],
    services: [
      { key: "consulta", name: "Consulta pediátrica", category: "consultation", minutes: 30, price: 35000, agendas: ["laura"], locations: ["office"] },
      { key: "retorno", name: "Retorno pediátrico", category: "return_visit", minutes: 20, price: 0, returnDays: 30, agendas: ["laura"], locations: ["office"] },
    ],
    windows: [...weekdays([1, 2, 3, 4, 5], "laura", "office", "08:00", "12:00"), ...weekdays([1, 3], "laura", "office", "14:00", "18:00")],
    insurance: [],
    people: { adults: 0, kids: 30, kidMaxAge: 13 },
    occupancy: 0.65,
    blocks: [{ agenda: "laura", day: 4, start: "14:00", end: "18:00", reason: "Curso de atualização em pediatria", massCancel: true }],
    holiday: { day: 7, description: "Recesso do consultório" },
  },
  {
    id: "de000000-0000-4000-8000-000000000002",
    seed: 202,
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
    },
    // Informações que o bot responde (MI, 07/nov/2026): iguais para os profissionais da demonstração.
    botInfo: { payment_info: "Pix, cartão de crédito em até 3x e débito.", insurance_info: null, notes: "Atendemos de segunda a sexta, das 8h às 18h." },
    professionals: [{ key: "felipe", name: "Dr. Felipe Andrade", profession: "Cirurgião-dentista", specialty: "Odontologia (clínica geral)", council: "CRO", number: "54321", state: "SP", admin: true }],
    locations: [{ key: "office", name: "Consultório", type: "clinic", address: "Av. Brasil, 845, sala 12 · Centro, Campinas" }],
    agendas: [{ key: "felipe", professional: "felipe" }],
    services: [
      { key: "avaliacao", name: "Avaliação odontológica", category: "consultation", minutes: 40, price: 15000, agendas: ["felipe"], locations: ["office"], weight: 4 },
      { key: "retorno", name: "Retorno", category: "return_visit", minutes: 20, price: 0, returnDays: 30, agendas: ["felipe"], locations: ["office"] },
      { key: "limpeza", name: "Limpeza (profilaxia)", category: "exam", minutes: 40, price: 22000, agendas: ["felipe"], locations: ["office"], weight: 3 },
      { key: "restauracao", name: "Restauração", category: "exam", minutes: 60, price: 28000, agendas: ["felipe"], locations: ["office"], weight: 2 },
      { key: "clareamento", name: "Clareamento", category: "exam", minutes: 60, price: 90000, agendas: ["felipe"], locations: ["office"], weight: 1, preparation: "Evite café, chá e refrigerante escuro nas 48 horas antes e depois da sessão." },
    ],
    windows: [...weekdays([1, 2, 3, 4, 5], "felipe", "office", "08:00", "12:00"), ...weekdays([1, 2, 3, 4, 5], "felipe", "office", "14:00", "18:00")],
    insurance: [],
    people: { adults: 28, kids: 8, kidMaxAge: 15, area: "Campinas" },
    occupancy: 0.65,
    blocks: [{ agenda: "felipe", day: 3, start: "08:00", end: "12:00", reason: "Manutenção do equipamento de raio X", massCancel: true }],
    holiday: { day: 8, description: "Recesso do consultório" },
  },
  {
    id: "de000000-0000-4000-8000-000000000003",
    seed: 303,
    name: "Clínica Vida Plena",
    plan: "Completo",
    email: "demo.completo@recepclinic.com.br",
    features: COMPLETE,
    maxProfessionals: 3,
    settings: {
      profile: "mixed",
      brand_color: "#4F46E5",
      require_insurance_details: true,
    },
    // Informações que o bot responde (MI, 07/nov/2026): iguais para os profissionais da demonstração.
    botInfo: { payment_info: "Pix, cartão de crédito em até 3x e débito.", insurance_info: "Traga a carteirinha e um documento com foto.", notes: "Estacionamento conveniado ao lado da clínica. Chegue 10 minutos antes." },
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
      { key: "camila", professional: "camila", audience: "child" },
      { key: "renata", professional: "renata", audience: "adult" },
      { key: "exames", name: "Exames", kind: "resource" },
    ],
    services: [
      { key: "clinica", name: "Consulta de clínica médica", category: "consultation", minutes: 30, price: 40000, agendas: ["marcos"], locations: ["office", "home"], homePrice: 60000, audience: "adult" },
      { key: "pediatrica", name: "Consulta pediátrica", category: "consultation", minutes: 30, price: 38000, agendas: ["camila"], locations: ["office"], audience: "child" },
      { key: "cardio", name: "Consulta cardiológica", category: "consultation", minutes: 40, price: 50000, agendas: ["renata"], locations: ["office"], audience: "adult" },
      { key: "retorno", name: "Retorno", category: "return_visit", minutes: 20, price: 0, returnDays: 30, agendas: ["marcos", "camila", "renata"], locations: ["office"] },
      { key: "ecg", name: "Eletrocardiograma", category: "exam", minutes: 20, price: 15000, agendas: ["exames"], locations: ["office"], audience: "adult", preparation: "Use roupa confortável e *evite* hidratante no peito no dia do exame." },
    ],
    windows: [
      ...weekdays([1, 2, 3, 4, 5], "marcos", "office", "08:00", "12:00"),
      { agenda: "marcos", location: "home", weekday: 4, start: "14:00", end: "17:00" },
      ...weekdays([1, 3, 5], "camila", "office", "08:00", "12:00"),
      ...weekdays([2, 4], "camila", "office", "14:00", "18:00"),
      ...weekdays([2, 4], "renata", "office", "08:00", "12:00"),
      ...weekdays([1, 3], "renata", "office", "14:00", "18:00"),
      ...weekdays([1, 2, 3, 4, 5], "exames", "office", "07:00", "09:00", { service: "ecg" }),
    ],
    insurance: ["Unimed", "SulAmérica", "Bradesco Saúde"],
    teamRecipients: [{ label: "Recepção", phone: "+5511900003999" }],
    people: { adults: 42, kids: 16, insurance: true, homeAddresses: 6 },
    occupancy: 0.65,
    blocks: [
      { agenda: "renata", day: 2, start: "08:00", end: "12:00", reason: "Plantão no hospital", massCancel: true },
      { agenda: "marcos", day: 5, start: "08:00", end: "12:00", reason: "Congresso de clínica médica" },
    ],
    holiday: { day: 8, description: "Recesso da clínica" },
  },
  {
    // Clínica criada para o analista da Meta (09/out); dados refeitos para a venda (02/nov).
    id: "4dbeccc6-61da-4e7f-84d7-e42f5a95b071",
    seed: 404,
    name: "Clínica Demonstração RecepClinic",
    plan: "Tudo ligado (menos o Financeiro)",
    email: "demo.recepclinic@recepclinic.com.br",
    extraAdmins: [META_ANALYST],
    features: EVERYTHING,
    maxProfessionals: 4,
    settings: {
      profile: "mixed",
      brand_color: "#0F766E",
      require_insurance_details: true,
    },
    // Informações que o bot responde (MI, 07/nov/2026): iguais para os profissionais da demonstração.
    botInfo: { payment_info: "Pix, cartão de crédito em até 3x e débito.", insurance_info: "Traga a carteirinha e um documento com foto.", notes: "Estacionamento gratuito no subsolo. Chegue 15 minutos antes do horário." },
    professionals: [
      { key: "helena", name: "Dra. Helena Duarte", profession: "Médica", specialty: "Clínica médica", council: "CRM", number: "21345", state: "DF", admin: true },
      { key: "rafael", name: "Dr. Rafael Moreira", profession: "Médico", specialty: "Ortopedia", council: "CRM", number: "22456", state: "DF" },
      { key: "paula", name: "Dra. Paula Sena", profession: "Médica", specialty: "Pediatria", council: "CRM", number: "23567", state: "DF" },
      { key: "bianca", name: "Bianca Freitas", profession: "Psicóloga", specialty: "Psicologia", council: "CRP", number: "01/12345", state: "DF" },
    ],
    locations: [
      { key: "office", name: "Clínica Demonstração RecepClinic", type: "clinic", address: "SQN 201 Bloco C, Asa Norte, Brasília - DF" },
      { key: "home", name: "Atendimento domiciliar", type: "home_visit" },
    ],
    agendas: [
      { key: "helena", professional: "helena", audience: "adult" },
      { key: "rafael", professional: "rafael" },
      { key: "paula", professional: "paula", audience: "child" },
      { key: "bianca", professional: "bianca", audience: "adult" },
      { key: "exames", name: "Exames", kind: "resource" },
    ],
    services: [
      { key: "clinica", name: "Consulta de clínica médica", category: "consultation", minutes: 30, price: 35000, agendas: ["helena"], locations: ["office", "home"], homePrice: 55000, audience: "adult" },
      { key: "orto", name: "Consulta ortopédica", category: "consultation", minutes: 30, price: 40000, agendas: ["rafael"], locations: ["office"] },
      { key: "pediatrica", name: "Consulta pediátrica", category: "consultation", minutes: 30, price: 33000, agendas: ["paula"], locations: ["office"], audience: "child" },
      { key: "psico", name: "Sessão de psicoterapia", category: "consultation", minutes: 50, price: 25000, agendas: ["bianca"], locations: ["office"], audience: "adult" },
      { key: "retorno", name: "Retorno", category: "return_visit", minutes: 20, price: 0, returnDays: 30, agendas: ["helena", "rafael", "paula"], locations: ["office"] },
      { key: "ecg", name: "Eletrocardiograma", category: "exam", minutes: 20, price: 12000, agendas: ["exames"], locations: ["office"], audience: "adult", weight: 2, preparation: "Use roupa confortável e evite hidratante no peito no dia do exame." },
      { key: "usg", name: "Ultrassonografia de abdome", category: "exam", minutes: 30, price: 28000, agendas: ["exames"], locations: ["office"], weight: 1, preparation: "Jejum de 8 horas. Beba 4 copos de água 1 hora antes e não urine até o exame." },
    ],
    windows: [
      ...weekdays([1, 2, 3, 4, 5], "helena", "office", "08:00", "12:00"),
      { agenda: "helena", location: "office", weekday: 2, start: "14:00", end: "18:00" },
      { agenda: "helena", location: "home", weekday: 4, start: "14:00", end: "17:00" },
      ...weekdays([1, 3], "rafael", "office", "14:00", "18:00"),
      { agenda: "rafael", location: "office", weekday: 5, start: "08:00", end: "12:00" },
      ...weekdays([1, 2, 3, 4, 5], "paula", "office", "08:00", "12:00"),
      ...weekdays([1, 3, 5], "bianca", "office", "13:00", "18:00"),
      ...weekdays([2, 4], "bianca", "office", "08:00", "12:00"),
      ...weekdays([1, 2, 3, 4, 5], "exames", "office", "07:00", "11:00"),
    ],
    insurance: ["Unimed", "Amil", "Bradesco Saúde", "Cassi"],
    teamRecipients: [{ label: "Recepção", phone: "+5561900004999" }],
    people: { adults: 50, kids: 18, insurance: true, homeAddresses: 6, area: "Brasília - DF" },
    occupancy: 0.65,
    blocks: [
      { agenda: "rafael", day: 3, start: "14:00", end: "18:00", reason: "Cirurgia no hospital", massCancel: true },
      { agenda: "helena", day: 6, start: "08:00", end: "12:00", reason: "Congresso de clínica médica" },
    ],
    holiday: { day: 9, description: "Recesso da clínica" },
    // Séries semanais da psicóloga (dia da semana, horário).
    series: [
      { agenda: "bianca", service: "psico", weekday: 1, time: "14:00" },
      { agenda: "bianca", service: "psico", weekday: 3, time: "15:00" },
      { agenda: "bianca", service: "psico", weekday: 4, time: "09:00" },
    ],
    crm: true,
  },
];

// Etapas do funil de cada fluxo (src/lib/data/botFunnel.ts).
const FLOW_STEPS = {
  booking: [["started", "bot"], ["BOOK_FOR_WHOM", "bot"], ["patient_identified", "bot"], ["link_sent", "bot"], ["page_opened", "web"], ["confirmed", "web"]],
  return_booking: [["started", "bot"], ["RETURN_SELECT", "bot"], ["link_sent", "bot"], ["page_opened", "web"], ["confirmed", "web"]],
  exam: [["started", "bot"], ["BOOK_AGENDA", "bot"], ["for_whom", "bot"], ["patient_identified", "bot"], ["link_sent", "bot"], ["page_opened", "web"], ["confirmed", "web"]],
};
const FLOW_OF = { consultation: "booking", return_visit: "return_booking", exam: "exam" };

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

// Sem letras e números que se confundem (O/0, I/l/1).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newPassword = () => `Demo-${Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}-${Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;

async function ensureUser(email) {
  let id = await findUser(email);
  if (!id) {
    const { data, error } = await auth.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    id = data.user.id;
  }
  const { data, error } = await auth.auth.admin.getUserById(id);
  if (error) throw error;
  const current = data.user.app_metadata?.demo_password;
  if (!current || newPasswords) {
    const password = local ? "recepclinic-local" : newPassword();
    const { error: updateError } = await auth.auth.admin.updateUserById(id, { password, app_metadata: { ...data.user.app_metadata, demo_password: password } });
    if (updateError) throw updateError;
    console.log(`  senha ${current ? "trocada" : "criada"}: ${email}`);
  }
  return id;
}

// ---------------------------------------------------------------------------
// Banco
// ---------------------------------------------------------------------------

async function insert(db, table, row) {
  const columns = Object.keys(row);
  const sql = `insert into public.${table} (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
  return (await db.query(sql, Object.values(row))).rows[0];
}

/** Várias linhas por comando (as colunas da primeira linha). */
async function insertMany(db, table, rows, chunk = 200) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const values = [];
    const tuples = part.map((row) => `(${columns.map((c) => (values.push(row[c] === undefined ? null : row[c]), `$${values.length}`)).join(", ")})`);
    await db.query(`insert into public.${table} (${columns.join(", ")}) values ${tuples.join(", ")}`, values);
  }
}

const phoneOf = (clinicIndex, n) => `+55119000${clinicIndex + 1}${String(n).padStart(4, "0")}`;
const birthdate = (age, rng) => addDays(todayLocal, -Math.round(age * 365.25 + rng.int(10, 300)));

// ---------------------------------------------------------------------------
// Montagem de uma clínica
// ---------------------------------------------------------------------------

async function buildClinic(db, clinic, index, adminId, extraAdminIds) {
  const rng = seeded(clinic.seed + Number(todayLocal.replaceAll("-", "")));
  const has = (feature) => clinic.features.includes(feature);
  const stats = {};
  const count = (key, n = 1) => (stats[key] = (stats[key] ?? 0) + n);

  await db.query("delete from public.clinics where id = $1", [clinic.id]);
  await insert(db, "clinics", { id: clinic.id, name: clinic.name, max_professionals: clinic.maxProfessionals });
  const settings = { timezone: TZ, ...clinic.settings };
  const sets = Object.keys(settings).map((column, i) => `${column} = $${i + 2}`);
  await db.query(`update public.clinic_settings set ${sets.join(", ")} where clinic_id = $1`, [clinic.id, ...Object.values(settings)]);
  for (const feature of clinic.features) await insert(db, "clinic_features", { clinic_id: clinic.id, feature_key: feature });
  await insert(db, "clinic_members", { clinic_id: clinic.id, user_id: adminId, roles: clinic.professionals.some((p) => p.admin) ? "{admin,professional}" : "{admin}" });
  for (const id of extraAdminIds) await insert(db, "clinic_members", { clinic_id: clinic.id, user_id: id, roles: "{admin}" });

  // --- Cadastro -------------------------------------------------------------
  const ids = { professional: {}, location: {}, agenda: {}, service: {}, insurance: {} };
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
  // Especialidades da lista do Suporte, pelo nome (ME, 07/nov/2026).
  await db.query("select app.link_legacy_specialties()");
  if (clinic.botInfo) {
    for (const p of clinic.professionals) await insert(db, "professional_bot_info", { clinic_id: clinic.id, professional_id: ids.professional[p.key], ...clinic.botInfo });
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
  // Convênios por profissional (MC, 07/nov/2026): na demonstração, todos atendem todos.
  for (const name of clinic.insurance) {
    for (const p of clinic.professionals) await insert(db, "professional_insurance_plans", { clinic_id: clinic.id, professional_id: ids.professional[p.key], insurance_plan_id: ids.insurance[name] });
  }
  for (const r of clinic.teamRecipients ?? []) await insert(db, "notification_recipients", { clinic_id: clinic.id, label: r.label, phone: r.phone });

  // --- Pacientes: quem não tem responsável é o próprio contato --------------
  const people = makePeople(rng, { ...clinic.people, insurance: clinic.people.insurance ? clinic.insurance : [] });
  const contacts = new Map(); // nome do contato → { id, phone }
  let phoneSeq = 0;
  const contactRows = [];
  const patientRows = [];
  for (const person of people) {
    const contactName = person.contact ?? person.name;
    if (!contacts.has(contactName)) {
      phoneSeq += 1;
      const contact = { id: randomUUID(), phone: phoneOf(index, phoneSeq), address: person.address ?? null };
      contacts.set(contactName, contact);
      contactRows.push({ id: contact.id, clinic_id: clinic.id, full_name: contactName, phone: contact.phone, default_home_address: contact.address });
    }
    person.id = randomUUID();
    person.contactId = contacts.get(contactName).id;
    person.phone = contacts.get(contactName).phone;
    person.address = contacts.get(contactName).address;
    const plan = person.insurance ? ids.insurance[person.insurance] : null;
    patientRows.push({
      id: person.id,
      clinic_id: clinic.id,
      contact_id: person.contactId,
      full_name: person.name,
      birthdate: birthdate(person.age, rng),
      is_contact_self: !person.contact,
      insurance_plan_id: plan,
      insurance_card_number: plan ? String(rng.int(100000000, 999999999)) + String(rng.int(1000, 9999)) : null,
      insurance_card_valid_until: plan ? addDays(todayLocal, rng.int(60, 700)) : null,
      notes: null,
    });
  }
  // Alguns faltam muito (Faltosos e o limite de faltas).
  const flaky = new Set(people.filter((p) => !p.address).slice(0, 3).map((p) => p.key));
  await insertMany(db, "contacts", contactRows);
  await insertMany(db, "patients", patientRows);
  count("pacientes", people.length);

  const fits = (person, audience) => !audience || (audience === "child" ? person.age < 14 : person.age >= 14);
  const agendaAudience = Object.fromEntries(clinic.agendas.map((a) => [a.key, a.audience]));

  // --- Datas ----------------------------------------------------------------
  const holidayDate = clinic.holiday ? businessDay(clinic.holiday.day) : null;
  const days = [];
  for (let n = -PAST_DAYS; n <= FUTURE_DAYS; n += 1) {
    const date = businessDay(n);
    if (!isNationalHoliday(date) && date !== holidayDate) days.push({ n, date });
  }
  // Bloqueio: no primeiro dia (a partir do pedido) em que a agenda atende naquele período.
  const worksOn = (agenda, date, start, end) =>
    days.some((d) => d.date === date) && clinic.windows.some((w) => w.agenda === agenda && w.weekday === weekdayOf(date) && w.start < end && w.end > start);
  const blocks = (clinic.blocks ?? []).map((b) => {
    let n = b.day;
    while (!worksOn(b.agenda, businessDay(n), b.start, b.end) && n < FUTURE_DAYS) n += 1;
    const date = businessDay(n);
    return { ...b, date, startsAt: at(date, b.start), endsAt: at(date, b.end) };
  });

  // --- Atendimentos ---------------------------------------------------------
  const appointments = [];
  const busy = new Map(); // agenda → [início, fim) dos ativos
  const isFree = (agenda, start, end) => !(busy.get(agenda) ?? []).some(([s, e]) => start < e && end > s);
  const occupy = (agenda, start, end) => busy.set(agenda, [...(busy.get(agenda) ?? []), [start, end]]);
  const bookedOn = new Map(); // data → pessoas com atendimento
  const lastConsult = new Map(); // pessoa:agenda → consulta atendida (origem do retorno)

  /** Quando foi marcado: dias antes do horário, nunca depois de agora. */
  const createdBefore = (start) => {
    const created = plusMinutes(start, -rng.int(1, 18) * DAY - rng.int(0, 9 * HOUR));
    const cap = plusMinutes(NOW, -3 * HOUR);
    return created > cap ? plusMinutes(cap, -rng.int(0, 2 * DAY)) : created;
  };

  function addAppointment({ person, service, agenda, location, start, status, channel, origin = null, seriesId = null }) {
    const svc = clinic.services.find((s) => s.key === service);
    const end = plusMinutes(start, svc.minutes);
    const createdAt = createdBefore(start);
    const appt = {
      id: randomUUID(),
      person,
      service: svc,
      agendaKey: agenda,
      locationKey: location,
      start,
      end,
      status,
      channel,
      createdAt,
      origin,
      seriesId,
      canceledAt: null,
      canceledVia: null,
      massCanceled: false,
      rescheduledAt: null,
      rescheduledVia: null,
      reminder: null,
    };
    appointments.push(appt);
    if (status !== "canceled") occupy(agenda, start, end);
    if (!bookedOn.has(start.toDateString())) bookedOn.set(start.toDateString(), new Set());
    bookedOn.get(start.toDateString()).add(person.key);
    return appt;
  }

  /** Situação do atendimento pelo horário (antes de agora = já aconteceu). */
  function outcome(person, start) {
    if (start < NOW) {
      const noShow = flaky.has(person.key) ? 0.45 : 0.08;
      return rng.weighted([["completed", 1 - noShow - 0.07], ["no_show", noShow], ["canceled", 0.07]]);
    }
    return rng.chance(0.06) ? "canceled" : "scheduled";
  }

  // Séries semanais (antes da agenda comum, para reservar os horários).
  const seriesRows = [];
  const seriesSkips = [];
  if (has("series")) {
    const adults = people.filter((p) => p.age >= 18 && !p.address);
    for (const [i, s] of (clinic.series ?? []).entries()) {
      const person = adults[i * 3 + 1];
      const svc = clinic.services.find((x) => x.key === s.service);
      let first = businessDay(-PAST_DAYS);
      while (weekdayOf(first) !== s.weekday) first = addDays(first, 1);
      const series = { id: randomUUID(), person, agenda: s.agenda, service: s.service, first };
      seriesRows.push({
        id: series.id,
        clinic_id: clinic.id,
        patient_id: person.id,
        service_id: ids.service[s.service],
        agenda_id: ids.agenda[s.agenda],
        location_id: ids.location.office,
        interval_weeks: 1,
        weekday: s.weekday,
        start_time: s.time,
        duration_minutes: svc.minutes,
        starts_on: first,
        max_sessions: 12,
        created_by: adminId,
        created_at: plusMinutes(at(first, "08:00"), -3 * DAY),
      });
      for (let date = first; date <= businessDay(FUTURE_DAYS); date = addDays(date, 7)) {
        if (isNationalHoliday(date) || date === holidayDate) {
          seriesSkips.push({ clinic_id: clinic.id, series_id: series.id, skipped_on: date, reason: "holiday" });
          continue;
        }
        const start = at(date, s.time);
        const status = start < NOW ? (rng.chance(0.12) ? "no_show" : "completed") : "scheduled";
        const appt = addAppointment({ person, service: s.service, agenda: s.agenda, location: "office", start, status, channel: "admin", seriesId: series.id });
        appt.createdAt = new Date(seriesRows.at(-1).created_at);
        count("sessões de série");
      }
    }
  }

  // Agenda comum: cada janela de atendimento, horário a horário.
  for (const { n, date } of days) {
    const occupancy = n < 0 ? clinic.occupancy + 0.12 : n <= 2 ? clinic.occupancy + 0.1 : clinic.occupancy - (n - 2) * 0.03;
    for (const w of clinic.windows.filter((x) => x.weekday === weekdayOf(date))) {
      const home = clinic.locations.find((l) => l.key === w.location).type === "home_visit";
      const options = clinic.services.filter((s) => s.agendas.includes(w.agenda) && s.locations.includes(w.location) && (!w.service || s.key === w.service));
      for (let cursor = toMinutes(w.start); cursor < toMinutes(w.end); ) {
        const start = at(date, hhmm(cursor));
        const base = options.filter((s) => s.category !== "return_visit");
        const svc = rng.weighted(base.map((s) => [s, s.weight ?? (s.category === "exam" ? 2 : 3)]));
        const minutes = svc.minutes;
        if (cursor + minutes > toMinutes(w.end)) break;
        const end = plusMinutes(start, minutes);
        cursor += minutes;
        if (!isFree(w.agenda, start, end) || !rng.chance(home ? 0.6 : occupancy)) continue;
        const dayPeople = bookedOn.get(start.toDateString()) ?? new Set();
        const audience = svc.audience ?? agendaAudience[w.agenda];
        // Retorno: quem foi atendido nesta agenda nos últimos 30 dias e ainda não voltou.
        const returnSvc = options.find((s) => s.category === "return_visit");
        if (returnSvc && !home && rng.chance(0.25)) {
          const candidates = [...lastConsult.entries()].filter(([k, c]) => k.endsWith(`:${w.agenda}`) && !c.returnUsed && c.start < plusMinutes(start, -DAY) && c.start > plusMinutes(start, -30 * DAY) && !dayPeople.has(c.person.key));
          if (candidates.length) {
            const [, origin] = rng.pick(candidates);
            const rStart = start;
            const rEnd = plusMinutes(rStart, returnSvc.minutes);
            if (isFree(w.agenda, rStart, rEnd)) {
              origin.returnUsed = true;
              addAppointment({ person: origin.person, service: returnSvc.key, agenda: w.agenda, location: w.location, start: rStart, status: outcome(origin.person, rStart), channel: rng.chance(0.6) ? "whatsapp_bot" : "admin", origin: origin.id });
              cursor = cursor - minutes + returnSvc.minutes;
              continue;
            }
          }
        }
        const pool = people.filter((p) => fits(p, audience) && !dayPeople.has(p.key) && (!home || p.address) && !(svc.category === "exam" && p.age < 3));
        if (!pool.length) continue;
        const person = rng.pick(pool);
        const status = outcome(person, start);
        const appt = addAppointment({ person, service: svc.key, agenda: w.agenda, location: w.location, start, status, channel: rng.chance(0.55) ? "whatsapp_bot" : "admin" });
        if (svc.category === "consultation" && status === "completed") lastConsult.set(`${person.key}:${w.agenda}`, { id: appt.id, person, start, returnUsed: false });
      }
    }
  }

  // Faltosos: pelo menos 2 faltas cada (atendidos que não são origem de retorno viram falta).
  const origins = new Set(appointments.map((a) => a.origin).filter(Boolean));
  for (const key of flaky) {
    const past = appointments.filter((a) => a.person.key === key && a.start < NOW && !a.seriesId);
    let missing = 2 - past.filter((a) => a.status === "no_show").length;
    for (const a of past.filter((x) => x.status === "completed" && !origins.has(x.id))) {
      if (missing-- <= 0) break;
      a.status = "no_show";
    }
  }

  // Cancelamentos, remarcações e o bloqueio com cancelamento em massa.
  for (const a of appointments) {
    if (a.status === "canceled") {
      a.canceledVia = rng.chance(0.6) ? "whatsapp_bot" : "admin";
      const latest = a.start < NOW ? plusMinutes(a.start, -2 * HOUR) : plusMinutes(NOW, -4 * HOUR);
      a.canceledAt = new Date(a.createdAt.getTime() + rng.next() * Math.max(0, latest - a.createdAt));
    } else if (!a.seriesId && rng.chance(0.06)) {
      a.rescheduledVia = rng.chance(0.5) ? "whatsapp_bot" : "admin";
      a.rescheduledAt = new Date(Math.min(plusMinutes(a.createdAt, rng.int(1, 4) * DAY).getTime(), plusMinutes(NOW, -2 * HOUR).getTime(), plusMinutes(a.start, -DAY).getTime()));
      if (a.rescheduledAt < a.createdAt) a.rescheduledAt = null;
    }
  }
  for (const b of blocks.filter((x) => x.massCancel)) {
    for (const a of appointments.filter((x) => x.agendaKey === b.agenda && x.status === "scheduled" && x.start >= b.startsAt && x.start < b.endsAt)) {
      a.status = "canceled";
      a.massCanceled = true;
      a.canceledVia = "admin";
      a.canceledAt = plusMinutes(NOW, -2 * HOUR);
      a.rescheduledAt = null;
      count("cancelados pelo bloqueio");
    }
  }
  // O bloqueio sem cancelamento em massa fica sem ninguém marcado.
  for (const b of blocks.filter((x) => !x.massCancel)) {
    for (let i = appointments.length - 1; i >= 0; i -= 1) {
      const a = appointments[i];
      if (a.agendaKey === b.agenda && a.start >= b.startsAt && a.start < b.endsAt) appointments.splice(i, 1);
    }
  }

  // Lembretes: saem às 18h da véspera; a resposta confirma ou cancela.
  const reminderHour = 18;
  for (const a of appointments) {
    const sentAt = at(addDays(localDateOf(a.start), -1), `${reminderHour}:00`);
    if (sentAt > NOW || sentAt < a.createdAt) continue;
    if (a.canceledAt && a.canceledAt < sentAt) continue;
    const failed = a.start > NOW && rng.chance(0.05);
    const reminder = { sentAt, status: failed ? "failed" : rng.chance(0.6) ? "read" : "delivered", response: null, respondedAt: null };
    if (!failed) {
      const respondedAt = plusMinutes(sentAt, rng.int(5, 180));
      if (a.status === "canceled" && a.canceledVia === "whatsapp_bot" && !a.massCanceled && respondedAt < NOW && respondedAt < a.start && rng.chance(0.6)) {
        reminder.response = "cancel";
        reminder.respondedAt = respondedAt;
        a.canceledAt = respondedAt;
      } else if (a.status !== "canceled" && respondedAt < NOW) {
        const p = a.status === "completed" ? 0.7 : a.status === "no_show" ? 0.2 : 0.55;
        if (rng.chance(p)) {
          reminder.response = "confirmed";
          reminder.respondedAt = respondedAt;
        }
      }
    }
    a.reminder = reminder;
  }

  // Lista de espera: na fila (marcações do bot daqui a alguns dias) e um antecipado.
  const waitlist = { entries: [], openings: [], offers: [] };
  if (has("waitlist")) {
    const candidates = appointments.filter((a) => a.status === "scheduled" && !a.seriesId && a.channel === "whatsapp_bot" && a.start > at(businessDay(4), "00:00") && a.service.category !== "return_visit");
    const queued = new Set();
    for (const a of candidates.filter((_, i) => i % 5 === 0).slice(0, 4)) {
      queued.add(a.id);
      waitlist.entries.push({ id: randomUUID(), clinic_id: clinic.id, appointment_id: a.id, status: "active", created_via: "whatsapp_bot", created_at: plusMinutes(a.createdAt, 2) });
    }
    // Antecipado: uma vaga aberta por cancelamento foi oferecida e aceita.
    const freed = appointments.find((a) => a.status === "canceled" && !a.massCanceled && a.start > plusMinutes(NOW, DAY) && a.canceledAt < plusMinutes(NOW, -6 * HOUR) && a.service.category !== "return_visit");
    const mover = freed && candidates.find((a) => !queued.has(a.id) && a.agendaKey === freed.agendaKey && a.service.key === freed.service.key && a.start > plusMinutes(freed.start, 2 * DAY));
    if (mover && isFree(freed.agendaKey, freed.start, freed.end)) {
      const entryAt = plusMinutes(mover.createdAt, 2);
      const offeredAt = plusMinutes(freed.canceledAt, 1);
      const respondedAt = plusMinutes(offeredAt, rng.int(4, 40));
      const entryId = randomUUID();
      const openingId = randomUUID();
      const oldStart = mover.start;
      mover.start = freed.start;
      mover.end = freed.end;
      mover.rescheduledAt = respondedAt;
      mover.rescheduledVia = "whatsapp_bot";
      mover.reminder = null;
      waitlist.entries.push({ id: entryId, clinic_id: clinic.id, appointment_id: mover.id, status: "advanced", created_via: "whatsapp_bot", created_at: entryAt, ended_at: respondedAt, ended_reason: "advanced" });
      waitlist.openings.push({ id: openingId, clinic_id: clinic.id, opened_by_appointment_id: freed.id, reason: "canceled", service_id: ids.service[freed.service.key], agenda_id: ids.agenda[freed.agendaKey], slot_scheduled_at: freed.start, slot_location_id: ids.location[freed.locationKey], slot_duration_minutes: freed.service.minutes, status: "filled", created_at: freed.canceledAt });
      waitlist.offers.push({ clinic_id: clinic.id, entry_id: entryId, appointment_id: mover.id, opening_id: openingId, opened_by_appointment_id: freed.id, slot_scheduled_at: freed.start, slot_location_id: ids.location[freed.locationKey], slot_duration_minutes: freed.service.minutes, status: "accepted", offered_at: offeredAt, expires_at: plusMinutes(offeredAt, 60), responded_at: respondedAt, details: JSON.stringify({ previous_scheduled_at: oldStart.toISOString() }) });
      count("antecipados pela lista de espera");
    }
    count("na lista de espera", queued.size);
  }

  // Gravação: em ordem de horário (a origem do retorno vem antes dele).
  appointments.sort((a, b) => a.start - b.start);
  await insertMany(db, "appointment_series", seriesRows);
  await insertMany(db, "appointment_series_skips", seriesSkips);
  const rows = appointments.map((a) => {
    const confirmed = a.reminder?.response === "confirmed";
    return {
      id: a.id,
      clinic_id: clinic.id,
      patient_id: a.person.id,
      service_id: ids.service[a.service.key],
      agenda_id: ids.agenda[a.agendaKey],
      location_id: ids.location[a.locationKey],
      series_id: a.seriesId,
      scheduled_at: a.start,
      duration_minutes: a.service.minutes,
      booking_channel: a.channel,
      status: a.status,
      origin_appointment_id: a.origin,
      home_visit_address: clinic.locations.find((l) => l.key === a.locationKey).type === "home_visit" ? a.person.address : null,
      created_by: a.channel === "admin" ? adminId : null,
      created_at: a.createdAt,
      reminder_sent_at: a.reminder && a.reminder.status !== "failed" ? a.reminder.sentAt : null,
      reminder_response: a.reminder?.response ?? null,
      reminder_response_at: a.reminder?.respondedAt ?? null,
      patient_confirmed_at: confirmed ? a.reminder.respondedAt : null,
      canceled_at: a.canceledAt,
      canceled_via: a.canceledVia,
      canceled_by: a.canceledVia === "admin" ? adminId : null,
      mass_canceled: a.massCanceled,
      rescheduled_at: a.rescheduledAt,
      rescheduled_via: a.rescheduledVia,
      rescheduled_by: a.rescheduledVia === "admin" ? adminId : null,
    };
  });
  // Dia a dia: o gatilho do retorno confere a consulta de origem já gravada.
  const byDay = Map.groupBy(rows, (r) => r.scheduled_at.toISOString().slice(0, 10));
  for (const dayRows of byDay.values()) await insertMany(db, "appointments", dayRows);
  const LABELS = { scheduled: "agendados", completed: "atendidos", no_show: "faltas", canceled: "cancelados" };
  for (const a of appointments) count(LABELS[a.status]);
  count("confirmados pelo lembrete", appointments.filter((a) => a.reminder?.response === "confirmed" && a.start > NOW).length);
  count("remarcados", appointments.filter((a) => a.rescheduledAt).length);
  count("pelo bot", appointments.filter((a) => a.channel === "whatsapp_bot").length);
  count("atendimentos", appointments.length);

  for (const b of blocks) {
    await insert(db, "schedule_blocks", { clinic_id: clinic.id, agenda_id: ids.agenda[b.agenda], starts_at: b.startsAt, ends_at: b.endsAt, reason: b.reason, created_by: adminId, created_at: plusMinutes(NOW, -2 * HOUR - 5) });
  }
  if (holidayDate) await insert(db, "clinic_holidays", { clinic_id: clinic.id, date: holidayDate, description: clinic.holiday.description });

  await insertMany(db, "waitlist_entries", waitlist.entries.map((e) => ({ ended_at: null, ended_reason: null, ...e })));
  await insertMany(db, "waitlist_openings", waitlist.openings);
  await insertMany(db, "waitlist_offers", waitlist.offers);

  // --- Mensagens do WhatsApp (histórico) -------------------------------------
  const messages = [];
  const message = (m) => messages.push({ id: randomUUID(), clinic_id: clinic.id, appointment_id: null, contact_id: null, template_name: null, body: null, failure_reason: null, ...m });
  for (const a of appointments.filter((x) => x.reminder)) {
    const base = { appointment_id: a.id, contact_id: a.person.contactId, contact_phone: a.person.phone };
    message({ ...base, direction: "outbound", message_type: "appointment_reminder", status: a.reminder.status, created_at: a.reminder.sentAt, failure_reason: a.reminder.status === "failed" ? "Número sem WhatsApp ou fora da área de cobertura" : null });
    if (a.reminder.response) {
      message({ ...base, direction: "inbound", message_type: a.reminder.response === "confirmed" ? "reminder_confirm" : "reminder_cancel", status: "received", body: a.reminder.response === "confirmed" ? "Confirmar presença" : "Cancelar", created_at: a.reminder.respondedAt });
    }
  }
  count("lembretes enviados", appointments.filter((x) => x.reminder).length);

  // Recepção: conversas em que o bot parou e a clínica precisa responder.
  const conversations = [];
  if (has("whatsapp_bot")) {
    // Um paciente por contato (telefones distintos), fora os faltosos.
    const byPhone = [...new Map(people.filter((p) => !flaky.has(p.key)).map((p) => [p.phone, p])).values()];
    const asker = (i) => byPhone[i * 4 + 2];
    const scripts = [
      { reason: "requested", minutesAgo: 25, subject: clinic.insurance.length ? "Quer saber se o convênio cobre o exame" : "Dúvida sobre o valor da consulta", texts: ["Oi, boa tarde", "Queria falar com a recepção, por favor"] },
      { reason: "not_understood", minutesAgo: 190, subject: null, texts: ["preciso de um atestado da consulta de ontem", "é pro trabalho"], agentReply: "Olá! Vou preparar o atestado e te envio aqui ainda hoje." },
      { reason: "no_availability", minutesAgo: 55, subject: "Horário para esta semana", texts: ["Tem horário ainda essa semana?"] },
    ];
    for (const [i, s] of scripts.entries()) {
      const person = asker(i);
      if (!person) continue;
      const startedAt = plusMinutes(NOW, -s.minutesAgo);
      conversations.push({ clinic_id: clinic.id, contact_phone: person.phone, contact_id: person.contactId, state: "HUMAN_HANDOFF", context: "{}", human_handoff: true, human_handoff_at: startedAt, handoff_started_at: startedAt, handoff_reason: s.reason, handoff_subject: s.subject, handoff_subject_asked_at: s.subject ? plusMinutes(startedAt, 1) : null, not_understood_count: 0 });
      s.texts.forEach((body, j) => message({ contact_id: person.contactId, contact_phone: person.phone, direction: "inbound", message_type: "text", status: "received", body, created_at: plusMinutes(startedAt, j - s.texts.length) }));
      if (s.agentReply) message({ contact_id: person.contactId, contact_phone: person.phone, direction: "outbound", message_type: "agent_reply", status: "read", body: s.agentReply, created_at: plusMinutes(startedAt, 20) });
      s.person = person;
      s.startedAt = startedAt;
    }
    await insertMany(db, "conversation_state", conversations);
    count("conversas na Recepção", conversations.length);

    // Funil do bot: as marcações e cancelamentos feitos pelo bot nas últimas 3 semanas.
    const events = [];
    const since = plusMinutes(NOW, -21 * DAY);
    const event = (session, flow, step, source, phone, contactId, when, metadata = {}, appointmentId = null) =>
      events.push({ clinic_id: clinic.id, session_id: session, flow, step, source, contact_phone: phone, contact_id: contactId, occurred_at: when, metadata: JSON.stringify(metadata), appointment_id: appointmentId });
    for (const a of appointments.filter((x) => x.channel === "whatsapp_bot" && !x.seriesId && x.createdAt > since)) {
      const flow = FLOW_OF[a.service.category];
      const session = randomUUID();
      const steps = FLOW_STEPS[flow];
      steps.forEach(([step, source], i) => {
        const when = plusMinutes(a.createdAt, i - steps.length);
        const metadata = step === "confirmed" ? { appointment_id: a.id } : step === "patient_identified" ? { patient_id: a.person.id } : {};
        event(session, flow, step, source, a.person.phone, a.person.contactId, when, metadata, step === "confirmed" ? a.id : null);
      });
    }
    for (const a of appointments.filter((x) => x.status === "canceled" && x.canceledVia === "whatsapp_bot" && x.canceledAt > since)) {
      const session = randomUUID();
      const fromReminder = a.reminder?.response === "cancel";
      event(session, "cancel", "started", "bot", a.person.phone, a.person.contactId, plusMinutes(a.canceledAt, -2), { ...(fromReminder ? { source: "reminder" } : {}), category: a.service.category === "exam" ? "exam" : "consultation" });
      if (!fromReminder) event(session, "cancel", "CANCEL_SELECT", "bot", a.person.phone, a.person.contactId, plusMinutes(a.canceledAt, -1.5));
      event(session, "cancel", "CANCEL_CONFIRM", "bot", a.person.phone, a.person.contactId, plusMinutes(a.canceledAt, -1));
      event(session, "cancel", "canceled", "bot", a.person.phone, a.person.contactId, a.canceledAt, { appointment_id: a.id }, a.id);
    }
    // Tentativas que pararam no meio (Retomar contato), nos últimos 14 dias.
    const stops = [
      ["booking", 1, { reason: "timeout", last_step: "BOOK_FOR_WHOM" }],
      ["booking", 3, null],
      ["booking", 4, null],
      ["booking", 2, { reason: "back_to_menu", last_step: "BOOK_PATIENT_SELECT" }],
      ["booking", 4, null],
      ["exam", 5, null],
      ["return_booking", 3, null],
      ["booking", 1, { reason: "timeout", last_step: "BOOK_SERVICE" }],
    ].filter(([flow]) => flow !== "exam" || has("exams"));
    const strangers = people.filter((p) => !flaky.has(p.key));
    stops.forEach(([flow, reached, abandoned], i) => {
      const person = strangers[(i * 7 + 3) % strangers.length];
      const session = randomUUID();
      const startAt = at(businessDay(-(i % 9) - 1), hhmm(8 * 60 + ((i * 97) % 600)));
      FLOW_STEPS[flow].slice(0, reached + 1).forEach(([step, source], j) => event(session, flow, step, source, person.phone, person.contactId, plusMinutes(startAt, j), step === "patient_identified" ? { patient_id: person.id } : {}));
      if (abandoned) event(session, flow, "abandoned", "bot", person.phone, person.contactId, plusMinutes(startAt, reached + 15), abandoned);
    });
    // Um número sem cadastro que começou a marcar e parou.
    const unknownPhone = phoneOf(index, 9001);
    const unknownSession = randomUUID();
    const unknownAt = at(businessDay(-1), "19:40");
    event(unknownSession, "booking", "started", "bot", unknownPhone, null, unknownAt);
    event(unknownSession, "booking", "BOOK_PATIENT_NEW", "bot", unknownPhone, null, plusMinutes(unknownAt, 1));
    if (clinic.settings.consultation_age_limit_years) {
      const s = randomUUID();
      const p = strangers[5];
      const t = at(businessDay(-2), "10:10");
      event(s, "booking", "started", "bot", p.phone, p.contactId, t);
      event(s, "booking", "BOOK_AGE_LIMIT", "bot", p.phone, p.contactId, plusMinutes(t, 1));
      event(s, "booking", "blocked", "bot", p.phone, p.contactId, plusMinutes(t, 2), { reason: "consultation_age_limit" });
    }
    // Pedidos de atendimento humano (Métricas › Recepção).
    for (const s of scripts.filter((x) => x.person)) {
      event(randomUUID(), "handoff", s.reason === "requested" ? "requested" : s.reason, "bot", s.person.phone, s.person.contactId, s.startedAt, s.reason === "requested" ? { origin: "menu" } : {});
    }
    await insertMany(db, "bot_funnel_events", events);
    count("passos do funil do bot", events.length);

    // Perguntas que o bot não reconheceu (Base de Conhecimento).
    const unmatched = clinic.settings.profile === "pediatric"
      ? ["vocês fazem o teste do pezinho?", "a doutora atende sábado?", "aceita vale-refeição?"]
      : ["vocês emitem nota fiscal para reembolso?", "tem estacionamento?", "atende sábado de manhã?"];
    await insertMany(db, "kb_unmatched", unmatched.map((text, i) => ({ clinic_id: clinic.id, text, conversation_state: "WELCOME", occurred_at: plusMinutes(NOW, -(i + 1) * 20 * HOUR) })));
  }
  await insertMany(db, "whatsapp_messages", messages);

  // Contato para revisar: atingiu o limite de atendimentos futuros pelo bot.
  if (clinic.agendas.length > 1) {
    const person = people.find((p) => p.contact && people.filter((q) => q.contactId === p.contactId).length > 1) ?? people[0];
    await insert(db, "bot_limit_events", { clinic_id: clinic.id, contact_id: person.contactId, reason: "future_appointments", limit_value: 5, current_value: 5, paused: false, created_at: plusMinutes(NOW, -26 * HOUR) });
  }

  // --- CRM: anotações e lembretes da equipe (com a autoria do Administrador) ---
  if (clinic.crm) {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: adminId, role: "authenticated" })]);
    const adults = people.filter((p) => p.age >= 18);
    const notes = [
      "Prefere ser atendida no fim da manhã; trabalha à tarde.",
      "Alérgico a dipirona. Conferir antes de qualquer prescrição.",
      "Pediu orçamento do ultrassom para o convênio; aguardando a autorização.",
      "Mãe pediu para avisar por WhatsApp, não por ligação.",
      "Paciente em acompanhamento quinzenal da pressão arterial.",
      "Traz os exames do laboratório na próxima consulta.",
    ];
    for (const [i, body] of notes.entries()) await insert(db, "patient_notes", { clinic_id: clinic.id, patient_id: (i === 3 ? people.find((p) => p.contact) : adults[i * 4]).id, body });
    const reminders = [
      { body: "Ligar para confirmar a autorização do convênio do ultrassom.", due: -3 },
      { body: "Cobrar o resultado do exame de sangue.", due: -1 },
      { body: "Enviar a orientação de preparo do exame.", due: 0 },
      { body: "Confirmar o retorno de 30 dias com a Dra. Helena.", due: 0 },
      { body: "Perguntar como está a recuperação depois da cirurgia.", due: 3 },
      { body: "Oferecer a vacina da gripe na próxima consulta.", due: 7 },
      { body: "Separar a segunda via do recibo.", due: -2, done: true },
    ];
    for (const [i, r] of reminders.entries()) {
      const row = await insert(db, "patient_reminders", { clinic_id: clinic.id, patient_id: adults[i * 3 + 2].id, body: r.body, due_on: businessDay(r.due) });
      if (r.done) await db.query("update public.patient_reminders set done_at = now() where id = $1", [row.id]);
    }
    count("anotações", notes.length);
    count("lembretes da equipe", reminders.length);
  }
  return stats;
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
  console.log(`${confirm ? "=== APLICANDO ===" : "=== SIMULAÇÃO (nada fica gravado; use --confirmar) ==="} ${local ? "banco local" : "staging"}\n`);
  if (chipToDemo || chipBack) {
    await db.query("begin");
    await moveChip(db, chipToDemo);
    await db.query(confirm ? "commit" : "rollback");
  } else {
    const { rows: chip } = await db.query("select 1 from public.whatsapp_connections where clinic_id = any($1)", [CLINICS.map((c) => c.id)]);
    if (chip.length) {
      console.error("Uma clínica de demonstração tem WhatsApp conectado (o chip de testes?): devolva antes (--chip-devolver), ou a conexão seria apagada junto.");
      process.exit(1);
    }
    console.log(`Agenda de ${businessDay(-PAST_DAYS)} a ${businessDay(FUTURE_DAYS)} (hoje: ${todayLocal}).\n`);
    for (const [index, clinic] of CLINICS.entries()) {
      // Na simulação, os logins que ainda não existem não são criados: a montagem roda e é desfeita.
      const adminId = confirm ? await ensureUser(clinic.email) : ((await findUser(clinic.email)) ?? (await findUser(META_ANALYST)) ?? (await db.query("select id from auth.users limit 1")).rows[0].id);
      const extraAdminIds = [];
      for (const email of clinic.extraAdmins ?? []) {
        const id = await findUser(email);
        if (id && id !== adminId) extraAdminIds.push(id);
      }
      await db.query("begin");
      try {
        const stats = await buildClinic(db, clinic, index, adminId, extraAdminIds);
        await db.query(confirm ? "commit" : "rollback");
        console.log(`${clinic.name} (${clinic.plan}) · login ${clinic.email}`);
        console.log(`  ${Object.entries(stats).map(([k, v]) => `${k}: ${v}`).join(" · ")}\n`);
      } catch (error) {
        await db.query("rollback");
        throw new Error(`${clinic.name}: ${error.message}`);
      }
    }
    if (confirm) console.log("Pronto. Logins e senhas: Sistema › Vendas › Demonstração.");
  }
} finally {
  await db.end();
}
