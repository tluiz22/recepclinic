// Simula o toque num botão do lembrete (Fase 19) sem depender da Meta:
// monta o mesmo evento que a Meta mandaria ao webhook quando o responsável
// toca em "Confirmar presença" / "Remarcar" / "Cancelar", assina com o App
// Secret e envia para o webhook do preview (`SITE_URL`). O bot processa de
// verdade — as respostas chegam no WhatsApp do responsável do atendimento.
//
// Uso (na raiz do projeto, com o .env local):
//   node --env-file=.env scripts/simulate-reminder-tap.mjs <appointment_id> <confirm|reschedule|cancel>
//
// O toque só vale para atendimento futuro, ativo e com lembrete enviado
// (`reminder_sent_at` preenchido) — para testar sem o cron, preencher à mão:
//   update appointments set reminder_sent_at = now() where id = '<id>';

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BUTTON_TEXT = { confirm: "Confirmar presença", reschedule: "Remarcar", cancel: "Cancelar" };

const [appointmentId, action] = process.argv.slice(2);
if (!appointmentId || !BUTTON_TEXT[action]) {
  console.error("Uso: node --env-file=.env scripts/simulate-reminder-tap.mjs <appointment_id> <confirm|reschedule|cancel>");
  process.exit(1);
}

const { PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_APP_SECRET, SITE_URL } = process.env;
for (const [name, value] of Object.entries({ PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_APP_SECRET, SITE_URL })) {
  if (!value) {
    console.error(`Variável ${name} ausente — rode com: node --env-file=.env scripts/simulate-reminder-tap.mjs ...`);
    process.exit(1);
  }
}

const supabase = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const { data: appointment, error } = await supabase
  .from("appointments")
  .select("id, patients!inner(full_name, guardians!inner(phone))")
  .eq("id", appointmentId)
  .maybeSingle();
if (error || !appointment) {
  console.error("Atendimento não encontrado:", error?.message ?? appointmentId);
  process.exit(1);
}
const phone = appointment.patients.guardians.phone; // "+5584..."

const payload = {
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            messages: [
              {
                id: `wamid.SIMULADO.${crypto.randomUUID()}`,
                from: phone.replace(/^\+/, ""),
                type: "button",
                button: { text: BUTTON_TEXT[action], payload: `reminder:${action}:${appointmentId}` },
              },
            ],
          },
        },
      ],
    },
  ],
};

const rawBody = JSON.stringify(payload);
const signature = crypto.createHmac("sha256", WHATSAPP_APP_SECRET).update(rawBody, "utf8").digest("hex");

// `SITE_URL` do preview já traz o parâmetro de bypass da proteção da Vercel.
const site = new URL(SITE_URL);
const url = new URL("/api/whatsapp/webhook", site.origin);
const bypass = site.searchParams.get("x-vercel-protection-bypass");
if (bypass) url.searchParams.set("x-vercel-protection-bypass", bypass);

const response = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${signature}` },
  body: rawBody,
});
console.log(
  `Toque "${BUTTON_TEXT[action]}" de ${appointment.patients.full_name} (${phone}) → webhook respondeu ${response.status}`
);
