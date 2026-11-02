// Texto do contrato do RecepClinic (F12.2b, faturamento do SaaS): o
// Administrador da clínica lê e aceita em Configurações › Assinatura; cada
// versão ativada do contrato guarda a versão deste texto. **Texto provisório
// (cliente, 02/nov/2026): o do advogado substitui este** (item 24 do
// planejamento-faturamento-saas.md). Mudou o texto, muda a versão: a próxima
// versão ativada do contrato pede um novo aceite na tela.

export const BILLING_CONTRACT_TERMS_VERSION = "provisorio-2026-11-02";

export const BILLING_CONTRACT_TERMS: { title: string; paragraphs: string[] }[] = [
  {
    title: "1. Objeto",
    paragraphs: [
      "O RecepClinic presta à clínica o serviço de recepção automatizada (painel da recepção, atendimento pelo WhatsApp, agenda, lembretes e os demais módulos liberados para a clínica), pela internet, enquanto este contrato estiver em vigor.",
    ],
  },
  {
    title: "2. Valores e pagamento",
    paragraphs: [
      "A clínica paga a mensalidade, a implantação (quando houver) e, com a emissão de nota fiscal liberada, o preço por nota previsto neste contrato, nos valores e vencimentos mostrados acima.",
      "Em atraso, incidem multa de 2% e juros de 1% ao mês, sem correção monetária.",
    ],
  },
  {
    title: "3. Mudança de valores",
    paragraphs: [
      "Os valores só mudam por uma nova versão deste contrato. A nova versão é enviada ao e-mail financeiro e só começa a valer 30 dias depois do envio; continuar usando o RecepClinic depois dessa data vale como aceite. Discordando, a clínica pode cancelar antes, sem multa.",
    ],
  },
  {
    title: "4. Atraso e suspensão",
    paragraphs: [
      "A clínica recebe avisos por e-mail no 3º, 7º e 14º dia de atraso. A partir do 15º dia de atraso, o acesso pode ser suspenso até o pagamento ser reconhecido.",
    ],
  },
  {
    title: "5. Cancelamento e fim do contrato",
    paragraphs: [
      "A clínica pode cancelar a qualquer momento, sem multa: as mensalidades futuras deixam de ser geradas, as já vencidas continuam devidas e o acesso segue até o fim do período já pago.",
      "Depois do fim, os dados da clínica ficam disponíveis para exportação por 60 dias e então são excluídos ou anonimizados; os dados financeiros da cobrança são guardados por 5 anos.",
    ],
  },
  {
    title: "6. Dados pessoais",
    paragraphs: [
      "A clínica é a controladora dos dados dos seus pacientes e o RecepClinic os trata como operador, só para prestar o serviço. Os dados da cobrança são tratados pelo RecepClinic e pelo Asaas, que processa os pagamentos.",
    ],
  },
];
