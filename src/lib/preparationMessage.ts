// Mensagem do preparo do exame (C7.4; cliente, 28/out/2026): sai logo depois
// da confirmação da marcação, então sem saudação e sem link, só as
// instruções cadastradas no serviço entre uma linha antes e uma depois. Com a
// conversa aberta, texto livre com as quebras de linha; fechada, o modelo
// rc_preparo_exame_v3, em que as instruções vão numa linha só (o campo
// variável de um modelo não aceita quebra de linha) e cabem no limite.

import { MAX_PREPARATION_LENGTH } from "./whatsappFormat";

/** Limite das instruções (o modelo inteiro da Meta tem cerca de 1.000 caracteres). */
export const PREPARATION_MAX_LENGTH = MAX_PREPARATION_LENGTH;

export const PREPARATION_INTRO = (examName: string) => `Segue orientações para a realização do exame ${examName}:`;
export const PREPARATION_CLOSING = "Qualquer dúvida, responda esta mensagem.";

/** A mensagem com a conversa aberta (e a prévia da tela). */
export function preparationMessageText(examName: string, instructions: string): string {
  return `${PREPARATION_INTRO(examName)}\n\n${instructions.trim()}\n\n${PREPARATION_CLOSING}`;
}

/** As instruções para o modelo: as linhas separadas por " · ", sem espaços repetidos, até o limite. */
export function preparationInstructionsOneLine(instructions: string): string {
  const line = instructions
    .split(/\r?\n/)
    .map((part) => part.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
  return line.length > PREPARATION_MAX_LENGTH ? `${line.slice(0, PREPARATION_MAX_LENGTH - 1).trimEnd()}…` : line;
}
