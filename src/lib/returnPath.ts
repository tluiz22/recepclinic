// Para onde uma ação do dia a dia volta (F4.5–F4.8): só telas do Início, da
// Agenda, do Resumo do Dia (`/admin/consultas`) e de Pacientes, dentro do
// painel. Um endereço de fora (ou montado para enganar) vira o padrão.
//
// "Voltar" leva à tela de onde a pessoa veio (cliente, 10/out/2026: "toda tela
// deve voltar para a tela anterior que levou o usuário até a tela atual"): o
// link de saída leva a origem em `?volta=`, e a tela de destino usa essa
// origem no "Voltar" e nas próprias ações, com a tela fixa só como padrão.

const PANEL_RETURN = /^\/admin\/(dashboard|agenda|consultas|pacientes)(\/[a-z0-9-]+)*(\?[^\s#]*)?$/;

/** Origem muito longa (voltas dentro de voltas) não vai adiante. */
const MAX_RETURN_LENGTH = 1500;

export function safeReturnPath(value: string | null | undefined, fallback: string): string {
  return value && value.length <= MAX_RETURN_LENGTH && PANEL_RETURN.test(value) ? value : fallback;
}

/** A tela atual como origem (caminho e busca). */
export function currentPath(url: URL): string {
  return `${url.pathname}${url.search}`;
}

/** `href` com a origem em `?volta=` (sem origem válida, o `href` puro). */
export function withReturn(href: string, from: string | null | undefined): string {
  if (!from || safeReturnPath(from, "") === "") return href;
  return `${href}${href.includes("?") ? "&" : "?"}volta=${encodeURIComponent(from)}`;
}

/** A origem que esta tela recebeu, já conferida (null = veio sem origem). */
export function receivedReturn(url: URL): string | null {
  const value = url.searchParams.get("volta");
  return value && safeReturnPath(value, "") !== "" ? value : null;
}
