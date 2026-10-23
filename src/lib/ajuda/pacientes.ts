import type { ModuloDeAjuda } from "./tipos";

// Ajuda contextual de Pacientes (inventário de 23/out/2026).

export const pacientes = {
  dicas: {
    // Os envios usam o telefone do contato (patients → contacts.phone): notices.ts, reminders.ts, preparation.ts.
    contato:
      "O paciente e quem conversa com a clínica podem ser pessoas diferentes (ex.: a mãe de uma criança). Avisos, lembretes e o bot usam o WhatsApp de quem fala com a clínica, que pode ter vários pacientes.",
  },
} satisfies ModuloDeAjuda;
