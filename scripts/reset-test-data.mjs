// Limpa os dados de teste para recomeçar o monitoramento do zero (set/2026).
//
// Apaga, no Supabase: mensagens do WhatsApp, eventos do funil (Fase 15),
// links de agendar/remarcar, agendamentos, estado das conversas, crianças e
// responsáveis — sem avisar ninguém por WhatsApp. Não toca em:
// configurações, locais, disponibilidade, tipos de exame, contatos do resumo
// diário, perfis (`staff_profiles`), logins, nem bloqueios de agenda
// (`schedule_blocks`).
//
// Uso (na raiz do projeto, com o .env local):
//   node --env-file=.env scripts/reset-test-data.mjs              → só simula
//   node --env-file=.env scripts/reset-test-data.mjs --confirmar  → apaga
//
// IRREVERSÍVEL com --confirmar: não há backup automático no plano gratuito
// do Supabase.

import { createClient } from "@supabase/supabase-js";

const confirm = process.argv.includes("--confirmar");

const {
  PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

for (const [name, value] of Object.entries({
  PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
})) {
  if (!value) {
    console.error(`Variável ${name} ausente — rode com: node --env-file=.env scripts/reset-test-data.mjs`);
    process.exit(1);
  }
}

const supabase = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
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

console.log(confirm ? "=== LIMPEZA (apagando de verdade) ===" : "=== SIMULAÇÃO (nada será apagado) ===");
console.log(`Supabase: ${PUBLIC_SUPABASE_URL}\n`);

for (const { table, label } of TABLES) {
  console.log(`${label.padEnd(28)} (${table}): ${await countRows(table)}`);
}

if (!confirm) {
  console.log("\nNada foi apagado. Para apagar, rode de novo com --confirmar.");
  process.exit(0);
}

// 1. Retorno aponta pra consulta de origem (Fase 17) — solta o vínculo antes
// de apagar, senão a própria tabela bloqueia o DELETE.
{
  const { error } = await supabase
    .from("appointments")
    .update({ origin_appointment_id: null })
    .not("origin_appointment_id", "is", null);
  if (error) throw new Error(`Erro ao soltar origin_appointment_id: ${error.message}`);
}

// 2. Tabelas, na ordem das chaves estrangeiras.
for (const { table, label, filter } of TABLES) {
  const [column, operator, value] = filter;
  const { error } = await supabase.from(table).delete().not(column, operator, value);
  if (error) throw new Error(`Erro ao apagar ${table}: ${error.message}`);
  console.log(`${label.padEnd(28)} (${table}): apagado — restam ${await countRows(table)}`);
}

console.log("\nLimpeza concluída.");
