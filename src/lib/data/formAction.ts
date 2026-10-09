import type { APIContext } from "astro";
import { setFlash } from "../flash";
import { DataError } from "./errors";
import { logError } from "../log";

// Rotas de formulário do painel (F4.3): roda a ação, guarda o aviso e volta
// para a tela. Erro da camada de acesso vira o aviso com a mensagem dos campos;
// outro erro vai para o log e para um aviso genérico.

const GENERIC: Record<string, string> = {
  forbidden: "Você não tem permissão para isso.",
  not_enabled: "Isso não está liberado para a clínica.",
  limit_reached: "Limite de profissionais da clínica atingido. Fale com o suporte.",
  not_found: "Registro não encontrado.",
  in_use: "Está em uso e não pode sair.",
  unexpected: "Não foi possível salvar. Tente de novo.",
};

export function describeDataError(error: DataError): string {
  const fields = Object.values(error.fields);
  if (error.code === "invalid" && fields.length) return fields.join(" ");
  if (error.code === "invalid" || error.code === "duplicate" || error.code === "conflict") {
    // "Serviço: já existe um cadastro igual" → "Já existe um cadastro igual."
    const text = error.message.replace(/^[^:]+:\s*/, "");
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}`;
  }
  return GENERIC[error.code] ?? GENERIC.unexpected;
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
    setFlash(cookies, { tone: "error", text: error instanceof DataError ? describeDataError(error) : GENERIC.unexpected });
    return redirect(typeof failureTo === "function" ? failureTo() : failureTo, 303);
  }
}
