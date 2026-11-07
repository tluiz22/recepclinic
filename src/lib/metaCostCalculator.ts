// Calculadora do custo da Meta por clínica (CU3; plano da Central, seção 14 e telas T10/T11, cliente, 05/nov/2026).
// Só estimativa, sem medição: os parâmetros têm valor padrão (T11) e o Suporte muda na tela, sem gravar. Preço,
// franquia e câmbio vêm da vigência atual dos Preços da Meta (CU2). Usada no servidor (primeira tela) e no navegador
// (recalcula a cada campo).

export type CalculatorInput = {
  professionals: number;
  daysPerWeek: number;
  appointmentsPerDay: number;
  /** Preço por mensagem (utilidade e serviço), em reais. */
  priceBrl: number;
  freeServicePerMonth: number;
  /** Reais por dólar. */
  usdBrl: number;
  templatesPerAppointment: number;
  assistantPerAppointment: number;
  /** Porcentagem dos atendimentos que vão para a recepção (0 a 100). */
  receptionPercent: number;
  repliesPerHandoff: number;
  messagesPerAiConversation: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  /** Empresa de IA: dólares por milhão de tokens. */
  aiInputUsdPerMillion: number;
  aiOutputUsdPerMillion: number;
  /** IA da Meta (Meta Business Agent): dólares por milhão de tokens e tokens por mensagem. */
  metaAiUsdPerMillion: number;
  metaAiTokensPerMessage: number;
};

export type CalculatorResult = {
  appointmentsPerMonth: number;
  /** Avisos (modelos) e assistente, como o RecepClinic envia hoje. */
  todayBrl: number;
  /** A mais com a Central (a recepção responde tudo por ela). */
  centralBrl: number;
  totalBrl: number;
  /** IA de outra empresa: tarifa da Meta por mensagem + o custo da empresa de IA. */
  otherAiBrl: number;
  /** IA da Meta: por volume de texto, sem a tarifa de serviço (são excludentes); os modelos continuam. */
  metaAiBrl: number;
};

/** Semanas por mês (52 ÷ 12). */
const WEEKS_PER_MONTH = 52 / 12;

/** Médias e preços de IA aprovados na T11 (05/nov/2026); preço, franquia e câmbio vêm dos Preços da Meta. */
export const CALCULATOR_DEFAULTS = {
  professionals: 3,
  daysPerWeek: 5,
  appointmentsPerDay: 12,
  templatesPerAppointment: 2,
  assistantPerAppointment: 4,
  receptionPercent: 30,
  repliesPerHandoff: 5,
  messagesPerAiConversation: 12,
  aiInputTokens: 3000,
  aiOutputTokens: 200,
  aiInputUsdPerMillion: 2,
  aiOutputUsdPerMillion: 10,
  metaAiUsdPerMillion: 2,
  metaAiTokensPerMessage: 22500,
} as const;

const cents = (value: number) => Math.round(value * 100) / 100;
const positive = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);

export function calculateMetaCost(raw: CalculatorInput): CalculatorResult {
  const input = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, positive(value)])) as CalculatorInput;
  const appointments = Math.round(input.professionals * input.daysPerWeek * input.appointmentsPerDay * WEEKS_PER_MONTH);
  const price = input.priceBrl;
  const templates = appointments * input.templatesPerAppointment;
  const templatesBrl = templates * price;

  // Hoje: modelos sempre cobrados; mensagens do assistente acima da franquia.
  const assistant = appointments * input.assistantPerAppointment;
  const assistantCharged = Math.max(0, assistant - input.freeServicePerMonth);
  const todayBrl = templatesBrl + assistantCharged * price;

  // Central: respostas da recepção pelo RecepClinic, também serviço (a franquia que sobrar do assistente conta).
  const replies = appointments * (Math.min(input.receptionPercent, 100) / 100) * input.repliesPerHandoff;
  const freeLeft = Math.max(0, input.freeServicePerMonth - assistant);
  const centralBrl = Math.max(0, replies - freeLeft) * price;

  // IA: uma conversa por atendimento, com N mensagens; os modelos (confirmação, lembrete) continuam iguais.
  const aiMessages = appointments * input.messagesPerAiConversation;
  const aiMetaBrl = Math.max(0, aiMessages - input.freeServicePerMonth) * price;
  const aiProviderUsd = aiMessages * ((input.aiInputTokens * input.aiInputUsdPerMillion + input.aiOutputTokens * input.aiOutputUsdPerMillion) / 1_000_000);
  const otherAiBrl = templatesBrl + aiMetaBrl + aiProviderUsd * input.usdBrl;
  const metaAiUsd = aiMessages * ((input.metaAiTokensPerMessage * input.metaAiUsdPerMillion) / 1_000_000);
  const metaAiBrl = templatesBrl + metaAiUsd * input.usdBrl;

  return {
    appointmentsPerMonth: appointments,
    todayBrl: cents(todayBrl),
    centralBrl: cents(centralBrl),
    totalBrl: cents(cents(todayBrl) + cents(centralBrl)),
    otherAiBrl: cents(otherAiBrl),
    metaAiBrl: cents(metaAiBrl),
  };
}

const brl = (value: number, digits = 2) => `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const num = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
const usd = (value: number) => `US$ ${num(value)}`;

/** Aviso abaixo dos gráficos (T10, cliente, 05/nov/2026): os números acompanham os parâmetros. */
export function estimateNotice(input: CalculatorInput, validFrom: string | null): string[] {
  const since = validFrom ? `, tabela vigente desde ${validFrom.split("-").reverse().join("/")}` : "";
  return [
    `Preços da Meta: ${brl(input.priceBrl, 4)} por mensagem (confirmações, lembretes, assistente e Central), com ${num(input.freeServicePerMonth)} mensagens de serviço grátis por mês${since}. As médias ainda não foram medidas: ${num(input.templatesPerAppointment)} modelos e ${num(input.assistantPerAppointment)} mensagens do assistente por atendimento; ${num(input.receptionPercent)}% dos atendimentos vão para a recepção, com ${num(input.repliesPerHandoff)} respostas cada.`,
    "A Central considera que a recepção responde tudo por ela. Respostas pelo app do WhatsApp não são cobradas; se a equipe usar o app, o valor real fica menor.",
    `Comparação com IA: mesma quantidade de atendimentos, ${num(input.messagesPerAiConversation)} mensagens por conversa. IA de outra empresa: preço da Meta por mensagem mais o Claude Sonnet 5.5 (${usd(input.aiInputUsdPerMillion)} e ${usd(input.aiOutputUsdPerMillion)} por milhão de tokens, ${num(input.aiInputTokens)} de entrada e ${num(input.aiOutputTokens)} de saída por mensagem). IA da Meta: ${usd(input.metaAiUsdPerMillion)} por milhão de tokens, cerca de ${num(input.metaAiTokensPerMessage)} por mensagem (estimativa da Meta), sem a tarifa de serviço. Câmbio de ${brl(input.usdBrl)}. Os números mudam nos parâmetros ao lado.`,
  ];
}

export const formatBrl = (value: number) => brl(value);
