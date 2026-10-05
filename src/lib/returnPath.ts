// Para onde uma ação do dia a dia volta (F4.5–F4.8): só telas da Agenda, do
// Resumo do Dia (`/admin/consultas`) e de Pacientes, dentro do painel. Um
// endereço de fora (ou montado para enganar) vira o padrão.

const PANEL_RETURN = /^\/admin\/(agenda|consultas|pacientes)(\/[a-z0-9-]+)*(\?[^\s#]*)?$/;

export function safeReturnPath(value: string | null | undefined, fallback: string): string {
  return value && PANEL_RETURN.test(value) ? value : fallback;
}
