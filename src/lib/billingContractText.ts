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
//
// Cliente, 07/nov/2026: texto novo do cliente (13 seções; a 6, de notas fiscais,
// só na versão com nota). Seção 4: a Meta cobra a clínica direto, fora da
// mensalidade (opção 1; repasse pelo RecepClinic recusado: exigiria Solution
// Partner na Meta, risco de inadimplência e imposto). Lista na seção 12. Versão b (mesmo dia): exportação
// dos dados no fim do contrato a pedido ao Suporte (seção 10).

export const BILLING_CONTRACT_TERMS_VERSION = "provisorio-2026-11-07b";
export const BILLING_CONTRACT_TERMS_VERSION_NF = "provisorio-2026-11-07b-nf";

/** Um parágrafo, ou uma lista de itens (um array de textos). */
export type ContractParagraph = string | string[];

export type ContractTermsSection = { title: string; paragraphs: ContractParagraph[] };

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
  // Versão anterior (07/nov/2026, antes da exportação a pedido ao Suporte): continua legível para quem a aceitou.
  if (version === "provisorio-2026-11-07") return build(false, false);
  if (version === "provisorio-2026-11-07-nf") return build(true, false);
  return null;
}

/** `exportBySupport`: a exportação dos dados no fim do contrato é a pedido ao Suporte (cliente, 07/nov/2026, versão b). */
function build(invoicing: boolean, exportBySupport = true): ContractTermsSection[] {
  const sections: (ContractTermsSection | null)[] = [
    {
      title: "Objeto",
      paragraphs: [
        "O RecepClinic presta à clínica serviços de recepção automatizada e gestão de atendimentos, pela internet, incluindo painel da recepção, atendimento pelo WhatsApp, agenda, lembretes e demais funcionalidades disponibilizadas no plano contratado.",
        "Os recursos disponíveis correspondem ao plano contratado e às funcionalidades habilitadas na conta da clínica, podendo ser atualizados ou aprimorados pelo RecepClinic.",
        "O sistema é uma ferramenta de apoio à operação da clínica e não substitui a responsabilidade dos profissionais e da equipe pelo atendimento aos pacientes e pelas decisões clínicas.",
      ],
    },
    {
      title: "Prazo e renovação automática",
      paragraphs: [
        "Este contrato começa na data de início indicada na contratação e vale por prazo indeterminado.",
        "A assinatura é mensal e se renova automaticamente a cada mês, na data do vencimento, com a cobrança da mensalidade na forma de pagamento escolhida, até o cancelamento.",
      ],
    },
    {
      title: "Valores e pagamento",
      paragraphs: [
        ...(invoicing
          ? [
              "A clínica paga a mensalidade, a implantação (quando houver) e os valores relativos às notas fiscais emitidas pela clínica por meio do RecepClinic, nos valores e vencimentos apresentados na contratação.",
              "As notas fiscais emitidas no mês, até o limite da franquia contratada, quando houver, estão incluídas na mensalidade. Cada nota excedente será cobrada pelo preço unitário informado na contratação, na cobrança do mês seguinte. A franquia não utilizada não acumula para os meses seguintes.",
            ]
          : ["A clínica paga a mensalidade e a implantação (quando houver), nos valores e vencimentos apresentados no momento da contratação."]),
        "Em caso de atraso, incidem multa de 2% sobre o valor devido e juros de mora de 1% ao mês, calculados proporcionalmente aos dias de atraso, sem prejuízo das demais medidas previstas neste contrato.",
      ],
    },
    {
      title: "Mensagens do WhatsApp e cobranças da Meta",
      paragraphs: [
        "O WhatsApp da clínica funciona pela conta empresarial da própria clínica na Meta (WhatsApp Business).",
        "A Meta cobra diretamente da clínica pelas mensagens enviadas por essa conta por meio do RecepClinic, incluindo lembretes, confirmações, respostas do assistente, avisos e respostas enviadas pela recepção pelo painel, conforme a tabela de preços e as regras vigentes da Meta.",
        "Esses valores não fazem parte da mensalidade do RecepClinic e são de responsabilidade da clínica, que deverá manter uma forma de pagamento válida cadastrada em sua conta na Meta.",
        "A Meta define os preços, as categorias de mensagens e eventuais franquias gratuitas, podendo alterá-los a qualquer momento.",
        "O RecepClinic disponibiliza em Configurações › WhatsApp uma estimativa dos custos do mês. Os valores oficiais são aqueles apresentados pela Meta no Gerenciador do WhatsApp da clínica.",
        "A clínica é responsável pela regularidade de sua conta empresarial, pelo número conectado e pela manutenção das condições exigidas pela Meta para utilização do serviço.",
        "A ausência de forma de pagamento válida, restrições na conta ou alterações nas políticas e serviços da Meta podem impedir ou limitar o envio e o recebimento de mensagens. O RecepClinic não se responsabiliza por falhas de entrega decorrentes exclusivamente desses fatores externos.",
      ],
    },
    {
      title: "Forma de pagamento",
      paragraphs: [
        "Cartão de crédito: a clínica informa o cartão uma única vez, na página segura de pagamento do Asaas, e autoriza a cobrança automática da mensalidade nesse cartão, a cada mês, até o cancelamento. O RecepClinic não armazena os dados completos do cartão. A clínica pode alterar a forma de pagamento em Configurações › Assinatura.",
        "Pix: a cobrança de cada mês é enviada ao e-mail financeiro cadastrado e também fica disponível em Configurações › Assinatura, para pagamento até o vencimento.",
      ],
    },
    invoicing
      ? {
          title: "Emissão de notas fiscais",
          paragraphs: [
            "A funcionalidade de emissão de notas fiscais pela clínica, por meio do RecepClinic, fica disponível após o aceite deste contrato e a conclusão das configurações necessárias.",
            "A clínica é responsável pela exatidão e atualização dos dados fiscais, pela regularidade de sua inscrição e autorização perante os órgãos competentes e pelas informações fornecidas para emissão das notas, incluindo os dados do prestador e do tomador do serviço.",
            "Quando exigido, a clínica também é responsável por fornecer e manter válido o certificado digital utilizado na emissão.",
            "O RecepClinic atua como ferramenta tecnológica de apoio à emissão, não substituindo as obrigações fiscais e tributárias da clínica.",
            "A emissão depende da disponibilidade e do funcionamento dos sistemas das prefeituras e dos demais serviços de terceiros envolvidos, podendo ocorrer indisponibilidades ou atrasos alheios ao controle do RecepClinic.",
          ],
        }
      : null,
    {
      title: "Reajuste e mudança de valores",
      paragraphs: [
        "Uma vez por ano, no aniversário do início deste contrato, os valores poderão ser reajustados pela variação acumulada do IPCA (IBGE) nos 12 meses anteriores.",
        "Fora desse reajuste anual, os valores somente poderão ser alterados mediante comunicação de uma nova condição comercial à clínica.",
        "Em qualquer alteração, a clínica será avisada pelo e-mail financeiro cadastrado e por meio de Configurações › Assinatura, com antecedência mínima de 30 dias da primeira cobrança com o novo valor.",
        "Caso não concorde, a clínica poderá cancelar a assinatura antes da entrada em vigor dos novos valores, sem multa. A continuidade da utilização do serviço após a data de vigência, sem manifestação de cancelamento, será considerada aceite das novas condições.",
      ],
    },
    {
      title: "Atraso e suspensão",
      paragraphs: [
        "Em caso de atraso no pagamento, a clínica receberá avisos por e-mail no 3º, 7º e 14º dia de atraso.",
        "A partir do 15º dia de atraso, o RecepClinic poderá suspender o acesso ao sistema e a execução das automações até que o pagamento seja reconhecido.",
        "Durante a suspensão, poderão ser interrompidos o atendimento automatizado, os agendamentos realizados pelo bot, os lembretes e demais funcionalidades vinculadas ao serviço.",
        "A suspensão não elimina os valores pendentes nem as obrigações financeiras da clínica.",
        "Após o reconhecimento da regularização dos débitos, o acesso será restabelecido, conforme os procedimentos operacionais do RecepClinic.",
      ],
    },
    {
      title: "Direito de arrependimento",
      paragraphs: [
        "O RecepClinic oferece à clínica o prazo de 7 dias corridos, contados do aceite deste contrato, para desistência da contratação, sem cobrança de multa.",
        "A desistência poderá ser realizada pelo botão \"Cancelar a assinatura\", disponível em Configurações › Assinatura.",
        "Nesse caso, os valores pagos a título de implantação e mensalidade serão integralmente devolvidos, mediante estorno ou reembolso pela mesma forma de pagamento, observados os procedimentos e prazos operacionais da instituição de pagamento.",
      ],
    },
    {
      title: "Cancelamento e encerramento do contrato",
      paragraphs: [
        "A clínica poderá cancelar a assinatura a qualquer momento, sem multa e sem prazo mínimo de permanência, pelo botão \"Cancelar a assinatura\", disponível em Configurações › Assinatura.",
        "O pedido de cancelamento interrompe imediatamente as renovações e novas cobranças, mas o acesso ao RecepClinic permanece disponível até o encerramento do período já pago.",
        "As mensalidades vencidas e demais valores já devidos continuam sendo de responsabilidade da clínica, mesmo após o cancelamento.",
        `Após o encerramento do acesso, os dados da clínica e dos pacientes permanecerão disponíveis para exportação${exportBySupport ? ", mediante solicitação ao Suporte do RecepClinic," : ""} durante 60 dias, contados do encerramento do contrato. Após esse prazo, serão excluídos ou anonimizados, ressalvadas as informações que precisem ser conservadas para cumprimento de obrigações legais ou regulatórias e exercício regular de direitos.`,
        "Os dados financeiros e registros necessários ao cumprimento das obrigações legais, fiscais e regulatórias serão conservados pelos prazos aplicáveis.",
      ],
    },
    {
      title: "Disponibilidade do serviço e serviços de terceiros",
      paragraphs: [
        "O RecepClinic é disponibilizado pela internet e depende de infraestrutura tecnológica e de serviços de terceiros, incluindo hospedagem, banco de dados, integração com WhatsApp e processamento de pagamentos.",
        "O RecepClinic empregará esforços razoáveis para manter o serviço disponível e seguro, podendo realizar manutenções, atualizações e melhorias que eventualmente causem interrupções temporárias.",
        "Não será considerada falha do RecepClinic a indisponibilidade decorrente exclusivamente de problemas em serviços de terceiros, falhas de conexão à internet, interrupções de energia, restrições impostas por plataformas externas ou eventos de força maior.",
        "O RecepClinic deverá adotar medidas razoáveis para restabelecer o serviço quando estiver sob seu controle.",
        "Esta cláusula não afasta a responsabilidade do RecepClinic por falhas decorrentes de sua própria atuação, nos termos da legislação aplicável.",
      ],
    },
    {
      title: "Proteção de dados pessoais",
      paragraphs: [
        "Para os dados pessoais dos pacientes e demais pessoas atendidas pela clínica, a clínica atua como controladora e o RecepClinic como operador, realizando o tratamento de dados conforme as instruções da clínica e na medida necessária à prestação dos serviços contratados.",
        "A clínica é responsável por garantir a existência de base legal adequada para o tratamento dos dados pessoais, inclusive dados pessoais sensíveis de saúde, e por fornecer aos titulares as informações necessárias sobre esse tratamento.",
        "O RecepClinic compromete-se a:",
        [
          "Tratar os dados pessoais somente para as finalidades relacionadas à prestação dos serviços e conforme as instruções da clínica;",
          "Adotar medidas técnicas e administrativas razoáveis para proteger os dados contra acessos não autorizados, perda, destruição ou qualquer forma de tratamento inadequado;",
          "Restringir o acesso aos dados às pessoas autorizadas e que necessitem dessas informações para executar suas atividades;",
          "Comunicar à clínica, em prazo razoável, incidentes de segurança que possam envolver dados pessoais tratados em seu nome;",
          "Cooperar, dentro de suas possibilidades e responsabilidades, com a clínica no atendimento às solicitações dos titulares e às obrigações previstas na legislação de proteção de dados.",
        ],
        "Os dados necessários à administração da assinatura, cobrança e relacionamento comercial do RecepClinic serão tratados pelo próprio RecepClinic, conforme as finalidades e bases legais aplicáveis.",
        "O Asaas e os demais fornecedores tecnológicos envolvidos poderão tratar dados pessoais na medida necessária à execução dos respectivos serviços, observadas suas responsabilidades e a legislação aplicável.",
        "O tratamento de dados pessoais seguirá a Lei Geral de Proteção de Dados (Lei nº 13.709/2018) e demais normas aplicáveis.",
      ],
    },
    {
      title: "Aceite do contrato",
      paragraphs: [
        "Ao concluir a contratação e aceitar eletronicamente este contrato, a clínica declara que leu, compreendeu e concorda com suas condições.",
        "O aceite eletrônico constitui manifestação de vontade e vincula as partes às disposições aqui estabelecidas.",
        "A clínica declara também que as informações fornecidas no cadastro são verdadeiras e que possui poderes para aceitar este contrato em nome da pessoa jurídica contratante.",
      ],
    },
  ];
  return sections
    .filter((section): section is ContractTermsSection => section !== null)
    .map((section, index) => ({ ...section, title: `${index + 1}. ${section.title}` }));
}
