import { GUIDE_META_PAYMENT_PATH } from "./guides";

// Motivo de um envio pelo WhatsApp que não saiu ou não foi entregue, em português e com o que fazer (IS2; cliente,
// 03/nov/2026: o erro 131042 da clínica piloto ficou só no banco). Códigos da Meta (Cloud API) gravados em
// `whatsapp_messages.failure_code`: pelo webhook (status "failed") ou pelo envio recusado na hora.

export type SendFailureInfo = {
  /** O que aconteceu, numa frase. */
  title: string;
  /** O que fazer. */
  action: string;
  /** Guia público com o passo a passo, quando há. */
  guide?: string;
};

const KNOWN: Record<number, SendFailureInfo> = {
  131042: {
    title: "Problema de pagamento na Meta: a conta do WhatsApp da clínica está sem forma de pagamento padrão, ou o cartão foi recusado.",
    action: "Cadastre o cartão de crédito no Gerenciador do WhatsApp da clínica e defina-o como principal; depois, envie o teste de novo.",
    guide: GUIDE_META_PAYMENT_PATH,
  },
  131026: {
    title: "A Meta não conseguiu entregar: o número não tem WhatsApp, o app está muito desatualizado ou o destinatário não aceitou os termos novos do WhatsApp.",
    action: "Confira o número (com DDD) e se o WhatsApp dele está atualizado; tente outro número.",
  },
  131031: {
    title: "A conta do WhatsApp da clínica está bloqueada ou restrita pela Meta.",
    action: "Veja o aviso no Gerenciador do WhatsApp da clínica (conta restrita, pagamento ou política) e fale com o suporte do RecepClinic.",
  },
  131047: {
    title: "A conversa com esse número está fechada (mais de 24 horas sem mensagem dele) e a mensagem não era um modelo aprovado.",
    action: "Fale com o suporte do RecepClinic.",
  },
  131048: {
    title: "A Meta limitou os envios deste número por excesso de mensagens bloqueadas ou denunciadas.",
    action: "Aguarde algumas horas e fale com o suporte do RecepClinic.",
  },
  131049: {
    title: "A Meta segurou a mensagem para não cansar o destinatário (limite por pessoa).",
    action: "Tente outro número ou mais tarde.",
  },
  131056: {
    title: "Muitas mensagens para o mesmo número em pouco tempo.",
    action: "Espere alguns minutos e tente de novo.",
  },
  130429: {
    title: "Muitas mensagens ao mesmo tempo: a Meta pediu para diminuir o ritmo.",
    action: "Espere alguns minutos e tente de novo.",
  },
  132000: {
    title: "O modelo de mensagem não bate com o aprovado na Meta (variáveis).",
    action: "Fale com o suporte do RecepClinic.",
  },
  132001: {
    title: "O modelo de mensagem não existe ou ainda não foi aprovado na Meta.",
    action: "Confira em Configurações › WhatsApp se o modelo está aprovado; a análise da Meta leva de minutos a algumas horas.",
  },
  132015: {
    title: "O modelo de mensagem foi pausado pela Meta (qualidade baixa).",
    action: "Fale com o suporte do RecepClinic.",
  },
  132016: {
    title: "O modelo de mensagem foi desativado pela Meta.",
    action: "Fale com o suporte do RecepClinic.",
  },
  133010: {
    title: "O número da clínica não está registrado na plataforma do WhatsApp.",
    action: "Confira a conexão em Configurações › WhatsApp (Desconectado ou Em configuração) e fale com o suporte do RecepClinic.",
  },
  141010: {
    title: "A empresa ainda não passou pela verificação da Meta: os envios iniciados pela clínica ficam limitados.",
    action: "Inicie a verificação da empresa no Meta Business Suite (Configurações › Central de segurança).",
  },
  368: {
    title: "A conta da clínica foi bloqueada temporariamente pela Meta por violar uma política.",
    action: "Veja o aviso no Gerenciador do WhatsApp e fale com o suporte do RecepClinic.",
  },
};

/** Motivo da falha para a tela. Sem código conhecido: o texto da Meta, quando há. */
export function describeSendFailure(code: number | null | undefined, reason?: string | null): SendFailureInfo {
  if (code != null && KNOWN[code]) return KNOWN[code];
  const detail = reason?.trim() ? ` A Meta respondeu: "${reason.trim().slice(0, 160)}"${code != null ? ` (código ${code})` : ""}.` : code != null ? ` Código da Meta: ${code}.` : "";
  return {
    title: `A mensagem não saiu.${detail}`,
    action: "Tente de novo em alguns minutos; se continuar, fale com o suporte do RecepClinic.",
  };
}
