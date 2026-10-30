// Atualização automática (cliente, 30/out/2026): as telas que a recepção deixa
// abertas (Início, Agenda, Resumo do Dia e Atendimento humano) recarregam a cada
// 1 minuto, o dia todo, só com a aba à vista (aba em segundo plano, janela
// minimizada ou celular apagado não pedem nada ao servidor). Nunca no meio de um
// uso: campo com foco ou já alterado, janela de confirmação, menu ou ajuda
// aberta, ou a tela já saindo. Voltando à aba depois do intervalo, recarrega na
// hora. O navegador devolve a rolagem na recarga.
// Marcação: `data-auto-refresh` no <body> (AdminLayout, `autoRefresh`).

const INTERVAL_MS = 60_000;
const CHECK_MS = 5_000;
// Em uso: confirmação, menu "Mais" (popover e o do celular), ajuda "i" e cartão em edição. Blocos que já abrem
// expandidos (filtros da Agenda, grupos de Lembretes) e o "Como funciona?" (lembrado na recarga) não contam.
const IN_USE = "dialog[open], details.more-menu[open], details[data-help][open], details[data-edit][open]";

if (document.body.hasAttribute("data-auto-refresh")) {
  const loadedAt = Date.now();
  let edited = false;
  const markEdited = () => {
    edited = true;
  };
  document.addEventListener("input", markEdited, true);
  document.addEventListener("change", markEdited, true);

  const busy = () => {
    if (edited) return true;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches("input, textarea, select, [contenteditable]")) return true;
    if (document.querySelector(IN_USE)) return true;
    try {
      if (document.querySelector(":popover-open")) return true;
    } catch {
      // Navegador sem popover: o menu "Mais" nem abre como popover.
    }
    return document.getElementById("page-loading")?.hasAttribute("data-active") ?? false;
  };

  const refresh = () => {
    if (document.visibilityState !== "visible" || Date.now() - loadedAt < INTERVAL_MS || busy()) return;
    location.reload();
  };

  // Ocupada na hora do minuto: tenta de novo a cada 5 segundos.
  setInterval(refresh, CHECK_MS);
  document.addEventListener("visibilitychange", refresh);
}
