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
//
// F12.2d (cliente, 03/nov/2026): texto aprovado com as regras da cobrança
// recorrente (prazo indeterminado e renovação automática, forma de pagamento,
// reajuste anual pelo IPCA, arrependimento em 7 dias e cancelamento na tela).

export const BILLING_CONTRACT_TERMS_VERSION = "provisorio-2026-11-03b";
export const BILLING_CONTRACT_TERMS_VERSION_NF = "provisorio-2026-11-03b-nf";

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
  const sections: (ContractTermsSection | null)[] = [
    {
      title: "Objeto",
      paragraphs: [
        "O RecepClinic presta à clínica o serviço de recepção automatizada (painel da recepção, atendimento pelo WhatsApp, agenda, lembretes e os demais módulos liberados para a clínica), pela internet, enquanto este contrato estiver em vigor.",
      ],
    },
    {
      title: "Prazo e renovação automática",
      paragraphs: [
        "Este contrato começa na data de início indicada acima e vale por prazo indeterminado. A assinatura é mensal e se renova automaticamente todo mês, no dia do vencimento, com a cobrança da mensalidade na forma de pagamento escolhida, até o cancelamento.",
      ],
    },
    {
      title: "Valores e pagamento",
      paragraphs: invoicing
        ? [
            "A clínica paga a mensalidade, a implantação (quando houver) e as notas fiscais emitidas pelo RecepClinic, nos valores e vencimentos mostrados acima.",
            "As notas fiscais do mês até a franquia, quando houver, já estão na mensalidade; cada nota a mais é cobrada pelo preço por nota, na cobrança do mês seguinte. A franquia que sobra não passa para o mês seguinte.",
            "Em atraso, incidem multa de 2% e juros de 1% ao mês, sem correção monetária.",
          ]
        : [
            "A clínica paga a mensalidade e a implantação (quando houver), nos valores e vencimentos mostrados acima.",
            "Em atraso, incidem multa de 2% e juros de 1% ao mês, sem correção monetária.",
          ],
    },
    {
      title: "Forma de pagamento",
      paragraphs: [
        "No cartão de crédito, a clínica informa o cartão uma vez, na página de pagamento do Asaas, e autoriza a cobrança automática da mensalidade nesse cartão, todo mês, até o cancelamento. O RecepClinic não guarda os dados do cartão. A clínica pode trocar o cartão em Configurações › Assinatura.",
        "No Pix, a cobrança de cada mês é enviada ao e-mail financeiro e fica em Configurações › Assinatura, para pagamento até o vencimento.",
      ],
    },
    invoicing
      ? {
          title: "Emissão de nota fiscal",
          paragraphs: [
            "A emissão de notas fiscais pelo RecepClinic só fica disponível depois do aceite deste contrato. A clínica é responsável pelos dados fiscais e pelo certificado digital informados.",
          ],
        }
      : null,
    {
      title: "Reajuste e mudança de valores",
      paragraphs: [
        "Uma vez por ano, no aniversário do início deste contrato, os valores podem ser corrigidos pela variação do IPCA (IBGE) dos 12 meses anteriores. Fora isso, os valores só mudam por uma nova versão deste contrato.",
        "Nos dois casos, a clínica é avisada pelo e-mail financeiro e em Configurações › Assinatura pelo menos 30 dias antes de o novo valor ser cobrado. Discordando, pode cancelar antes, sem multa; continuar usando o RecepClinic depois dessa data vale como aceite.",
      ],
    },
    {
      title: "Atraso e suspensão",
      paragraphs: [
        "A clínica recebe avisos por e-mail no 3º, 7º e 14º dia de atraso. A partir do 15º dia de atraso, o acesso pode ser suspenso até o pagamento ser reconhecido.",
      ],
    },
    {
      title: "Direito de arrependimento",
      paragraphs: [
        "Em até 7 dias do aceite, a clínica pode desistir deste contrato pelo botão \"Cancelar a assinatura\", em Configurações › Assinatura, e recebe de volta todos os valores pagos (implantação e mensalidade), por estorno na mesma forma de pagamento.",
      ],
    },
    {
      title: "Cancelamento e fim do contrato",
      paragraphs: [
        "A clínica pode cancelar a qualquer momento, sem multa e sem prazo mínimo, pelo botão \"Cancelar a assinatura\", em Configurações › Assinatura. O cancelamento vale na hora: as mensalidades futuras deixam de ser geradas, as já vencidas continuam devidas e o acesso segue até o fim do período já pago.",
        "Depois do fim, os dados da clínica ficam disponíveis para exportação por 60 dias e então são excluídos ou anonimizados; os dados financeiros da cobrança são guardados por 5 anos.",
      ],
    },
    {
      title: "Dados pessoais",
      paragraphs: [
        "A clínica é a controladora dos dados dos seus pacientes e o RecepClinic os trata como operador, só para prestar o serviço. Os dados da cobrança são tratados pelo RecepClinic e pelo Asaas, que processa os pagamentos.",
      ],
    },
  ];
  return sections
    .filter((section): section is ContractTermsSection => section !== null)
    .map((section, index) => ({ ...section, title: `${index + 1}. ${section.title}` }));
}
