// Texto do contrato do RecepClinic (F12.2b, faturamento do SaaS): o
// Administrador da clínica lê e aceita em Configurações › Assinatura; cada
// versão ativada do contrato guarda a versão deste texto. **Texto provisório
// (cliente, 02/nov/2026): o do advogado substitui este** (item 24 do
// planejamento-faturamento-saas.md). Mudou o texto, muda a versão: a próxima
// versão ativada do contrato pede um novo aceite na tela.
//
// Duas versões (cliente, 03/nov/2026): o contrato só fala de nota fiscal quando
// cobra nota fiscal (preço por nota, só com o Módulo financeiro liberado). A
// versão com nota termina em "-nf" (o banco confere na ativação); como os
// textos diferem, passar de uma para a outra sempre pede o aceite na tela.

export const BILLING_CONTRACT_TERMS_VERSION = "provisorio-2026-11-03";
export const BILLING_CONTRACT_TERMS_VERSION_NF = "provisorio-2026-11-03-nf";

export type ContractTermsSection = { title: string; paragraphs: string[] };

/** Versão do texto para um contrato: com preço por nota, o texto com nota fiscal. */
export function billingTermsVersion(invoicing: boolean): string {
  return invoicing ? BILLING_CONTRACT_TERMS_VERSION_NF : BILLING_CONTRACT_TERMS_VERSION;
}

/** Versão do texto que cabe a um contrato (pelo preço por nota). */
export function billingTermsVersionFor(contract: { invoiceUnitPriceCents: number | null }): string {
  return billingTermsVersion(contract.invoiceUnitPriceCents !== null);
}

/** O texto de uma versão; null para uma versão anterior (não guardada aqui). */
export function billingContractTerms(version: string): ContractTermsSection[] | null {
  if (version === BILLING_CONTRACT_TERMS_VERSION) return build(false);
  if (version === BILLING_CONTRACT_TERMS_VERSION_NF) return build(true);
  return null;
}

function build(invoicing: boolean): ContractTermsSection[] {
  return [
    {
      title: "1. Objeto",
      paragraphs: [
        "O RecepClinic presta à clínica o serviço de recepção automatizada (painel da recepção, atendimento pelo WhatsApp, agenda, lembretes e os demais módulos liberados para a clínica), pela internet, enquanto este contrato estiver em vigor.",
      ],
    },
    {
      title: "2. Valores e pagamento",
      paragraphs: invoicing
        ? [
            "A clínica paga a mensalidade, a implantação (quando houver) e as notas fiscais emitidas pelo RecepClinic, nos valores e vencimentos mostrados acima.",
            "As notas fiscais do mês até a franquia, quando houver, já estão na mensalidade; cada nota a mais é cobrada pelo preço por nota. A franquia que sobra não passa para o mês seguinte.",
            "Em atraso, incidem multa de 2% e juros de 1% ao mês, sem correção monetária.",
          ]
        : [
            "A clínica paga a mensalidade e a implantação (quando houver), nos valores e vencimentos mostrados acima.",
            "Em atraso, incidem multa de 2% e juros de 1% ao mês, sem correção monetária.",
          ],
    },
    ...(invoicing
      ? [
          {
            title: "3. Emissão de nota fiscal",
            paragraphs: [
              "A emissão de notas fiscais pelo RecepClinic só fica disponível depois do aceite deste contrato. A clínica é responsável pelos dados fiscais e pelo certificado digital informados.",
            ],
          },
        ]
      : []),
    {
      title: "Mudança de valores",
      paragraphs: [
        "Os valores só mudam por uma nova versão deste contrato. A nova versão é enviada ao e-mail financeiro e só começa a valer 30 dias depois do envio; continuar usando o RecepClinic depois dessa data vale como aceite. Discordando, a clínica pode cancelar antes, sem multa.",
      ],
    },
    {
      title: "Atraso e suspensão",
      paragraphs: [
        "A clínica recebe avisos por e-mail no 3º, 7º e 14º dia de atraso. A partir do 15º dia de atraso, o acesso pode ser suspenso até o pagamento ser reconhecido.",
      ],
    },
    {
      title: "Cancelamento e fim do contrato",
      paragraphs: [
        "A clínica pode cancelar a qualquer momento, sem multa: as mensalidades futuras deixam de ser geradas, as já vencidas continuam devidas e o acesso segue até o fim do período já pago.",
        "Depois do fim, os dados da clínica ficam disponíveis para exportação por 60 dias e então são excluídos ou anonimizados; os dados financeiros da cobrança são guardados por 5 anos.",
      ],
    },
    {
      title: "Dados pessoais",
      paragraphs: [
        "A clínica é a controladora dos dados dos seus pacientes e o RecepClinic os trata como operador, só para prestar o serviço. Os dados da cobrança são tratados pelo RecepClinic e pelo Asaas, que processa os pagamentos.",
      ],
    },
  ].map((section, index) => ({ ...section, title: `${index + 1}. ${section.title.replace(/^\d+\.\s*/, "")}` }));
}
