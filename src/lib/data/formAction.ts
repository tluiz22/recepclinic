import type { APIContext } from "astro";
import { setFlash } from "../flash";
import { DataError } from "./errors";
import { logError } from "../log";

// Rotas de formulário do painel (F4.3): roda a ação, guarda o aviso e volta
// para a tela. Erro da camada de acesso vira o aviso com a mensagem dos campos
// (e a de cada um, para aparecer embaixo dele); outro erro vai para o log e
// para um aviso genérico.

/**
 * Avisos genéricos do painel no padrão "o que aconteceu + por quê + o que
 * fazer" (ajuda contextual, 23/out/2026). O "em uso" só acontece ao tirar
 * ligações, horários, feriados e membros, onde não há "Desativar".
 */
export const GENERIC: Record<string, string> = {
  forbidden: "O seu papel na clínica não permite esta ação. Peça a um Administrador da clínica.",
  not_enabled: "Este recurso não faz parte do plano da clínica. Para liberar, fale com o suporte do RecepClinic.",
  limit_reached: "A clínica chegou ao limite de profissionais ativos do plano. Desative um profissional ou fale com o suporte.",
  not_found: "Não achamos este cadastro. Ele pode ter sido apagado por outra pessoa. Volte à lista.",
  in_use: "Não dá para tirar: está em uso (ex.: tem atendimentos ou horários ligados).",
  // O keepFormValues devolve os valores ao formulário do painel.
  unexpected: "Não salvamos por uma falha do sistema, já registrada para o suporte. O que você preencheu continua na tela: tente de novo em instantes.",
};

/** Páginas sem login (formulário da clínica, link da agenda atual): ficam com os textos de antes, que não falam de papel nem prometem guardar o que foi digitado. */
export const GENERIC_PUBLIC: Record<string, string> = {
  forbidden: "Você não tem permissão para isso.",
  not_enabled: "Isso não está liberado para a clínica.",
  limit_reached: "Limite de profissionais da clínica atingido. Fale com o suporte.",
  not_found: "Registro não encontrado.",
  in_use: "Está em uso e não pode sair.",
  unexpected: "Não foi possível salvar. Tente de novo.",
};

export function describeDataError(error: DataError, generic: Record<string, string> = GENERIC): string {
  const fields = Object.values(error.fields);
  if (error.code === "invalid" && fields.length) return fields.join(" ");
  if (error.code === "invalid" || error.code === "duplicate" || error.code === "conflict") {
    // "Serviço: já existe um cadastro igual" → "Já existe um cadastro igual."
    const text = error.message.replace(/^[^:]+:\s*/, "");
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}`;
  }
  return generic[error.code] ?? generic.unexpected;
}

export async function runFormAction(
  { cookies, redirect }: Pick<APIContext, "cookies" | "redirect">,
  action: () => Promise<{ redirectTo: string; message: string }>,
  /** Para onde voltar com o erro; função = decidido na hora (ex.: o cadastro já foi criado). */
  failureTo: string | (() => string),
): Promise<Response> {
  try {
    const { redirectTo, message } = await action();
    setFlash(cookies, { tone: "success", text: message });
    return redirect(redirectTo, 303);
  } catch (error) {
    if (!(error instanceof DataError)) logError("formulário", error);
    const fields = error instanceof DataError && error.code === "invalid" ? Object.keys(error.fields) : [];
    setFlash(cookies, {
      tone: "error",
      text: error instanceof DataError ? describeDataError(error) : GENERIC.unexpected,
      ...(fields.length ? { fields, fieldMessages: (error as DataError).fields } : {}),
    });
    return redirect(typeof failureTo === "function" ? failureTo() : failureTo, 303);
  }
}
