// Marca do Asaas nas telas da emissão fiscal (N0, BaaS; playbook do Asaas,
// docs/planejamento-nfse-asaas.md, seção 13.8). O selo vem sempre da URL do
// Asaas com o id do RecepClinic: o Asaas confere o carregamento pelo Referer,
// então nunca servir cópia local nem usar referrerpolicy="no-referrer".

const SEAL_ID = "77d97322-c59c-4983-bbb1-e0dbe253d4c3";
const SEAL_BASE = "https://baas.asaas.com/selos/Servicos_financeiros_Asaas-Reduzida";

export const ASAAS_SEAL = {
  /** Fundo claro (cartões do painel). */
  positive: `${SEAL_BASE}-Positivo.svg?id=${SEAL_ID}`,
  negativeBlack: `${SEAL_BASE}-Negativo-Preto.svg?id=${SEAL_ID}`,
  negativeWhite: `${SEAL_BASE}-Negativo-Branco.svg?id=${SEAL_ID}`,
} as const;

/** Para onde o selo leva (playbook: site oficial, em nova aba). */
export const ASAAS_SITE = "https://asaas.com";

/** Canais de suporte do Asaas, visíveis ao cliente final (playbook). */
export const ASAAS_SUPPORT = {
  phone: "0800 009 0037",
  email: "contato@asaas.com.br",
} as const;

/** Quem presta o serviço financeiro (cláusula-modelo do playbook). */
export const ASAAS_PROVIDER_NOTICE =
  "Os serviços financeiros e de pagamentos usados na emissão da nota fiscal (a conta da clínica no Asaas e as tarifas da nota) são prestados pelo ASAAS GESTÃO FINANCEIRA INSTITUIÇÃO DE PAGAMENTOS S.A., instituição de pagamento autorizada a funcionar pelo Banco Central do Brasil. O RecepClinic atua só como plataforma de tecnologia que integra a emissão.";
