// Classes das páginas do paciente (redesign R11, cliente, 17/out/2026): cinzas
// neutros e a cor da clínica (bg-clinic, text-clinic-ink, src/styles/global.css).

/** Texto escrito pela clínica (preparo, orientações), no estilo do WhatsApp: 17px, linhas espaçadas. */
export const PATIENT_TEXT =
  "rounded-xl border border-gray-200 bg-white px-4 py-[18px] text-[17px] leading-[1.6] break-words whitespace-pre-line text-gray-800 sm:px-6 sm:py-6";

/** Cartão branco. */
export const PATIENT_CARD = "rounded-xl border border-gray-200 bg-white";

/** Rótulo de um dado (Quando, Criança…). */
export const PATIENT_LABEL = "text-[13px] leading-tight font-semibold tracking-[.04em] text-gray-500 uppercase";

/** Botão cheio na cor da clínica. */
export const PATIENT_BUTTON =
  "inline-flex h-12 items-center justify-center gap-2 rounded-[10px] border-0 bg-clinic px-5 text-[16.5px] font-bold whitespace-nowrap text-clinic-text no-underline hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinic-ink disabled:cursor-not-allowed disabled:opacity-45";

/** Título de um passo ("Escolha o dia"). */
export const PATIENT_STEP = "text-lg leading-tight font-bold text-gray-900 sm:text-[19px]";
