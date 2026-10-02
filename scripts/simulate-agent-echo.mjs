// Simula uma mensagem da secretária pelo app do WhatsApp Business (echo da
// coexistência, campo `smb_message_echoes`) sem depender da Meta: monta o
// mesmo evento que a Meta mandaria ao webhook, assina com o App Secret e
// envia para o webhook do preview (`SITE_URL`). Nada é enviado ao WhatsApp —
// o echo só registra a mensagem e pausa (ou, com "#bot", devolve) o bot
// naquele número. Serve para testar a pausa antes de a coexistência estar
// ativa no número da clínica.
//
// Uso (na raiz do projeto, com o .env local):
//   node --env-file=.env scripts/simulate-agent-echo.mjs <telefone> "<texto>"
// Ex.:
//   node --env-file=.env scripts/simulate-agent-echo.mjs +5561999999999 "Oi, aqui é a secretária"
//   node --env-file=.env scripts/simulate-agent-echo.mjs +5561999999999 "#bot"

import crypto from "node:crypto";

const [phoneArg, text] = process.argv.slice(2);
if (!phoneArg || !text) {
  console.error('Uso: node --env-file=.env scripts/simulate-agent-echo.mjs <telefone> "<texto>"');
  process.exit(1);
}

const { WHATSAPP_APP_SECRET, SITE_URL } = process.env;
for (const [name, value] of Object.entries({ WHATSAPP_APP_SECRET, SITE_URL })) {
  if (!value) {
    console.error(`Variável ${name} ausente — rode com: node --env-file=.env scripts/simulate-agent-echo.mjs ...`);
    process.exit(1);
  }
}

const phone = phoneArg.replace(/[^\d]/g, ""); // a Meta manda sem "+"

const payload = {
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          field: "smb_message_echoes",
          value: {
            message_echoes: [
              {
                id: `wamid.SIMULADO.${crypto.randomUUID()}`,
                to: phone,
                type: "text",
                text: { body: text },
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
console.log(`Mensagem da secretária para +${phone} ("${text}") → webhook respondeu ${response.status}`);
