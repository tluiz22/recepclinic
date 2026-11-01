// Ajuda contextual da Central de Ajuda (cliente, 01/nov/2026): o link "Ajuda desta tela"
// abre o artigo num painel à direita, sem sair da operação. Sem JavaScript, o link
// leva à página do artigo. O painel busca a própria página do artigo (o servidor já
// confere quem pode ver) e usa só o #artigo.

const panel = document.querySelector<HTMLDialogElement>("#help-panel");

async function openPanel(link: HTMLAnchorElement): Promise<void> {
  if (!panel || typeof panel.showModal !== "function") return;
  const body = panel.querySelector<HTMLElement>("[data-help-body]")!;
  const title = panel.querySelector<HTMLElement>("[data-help-title]")!;
  const full = panel.querySelector<HTMLAnchorElement>("[data-help-full]")!;
  title.textContent = link.dataset.helpTitle ?? "Ajuda";
  full.href = link.href;
  body.replaceChildren(Object.assign(document.createElement("p"), { textContent: "Carregando…", className: "text-ink-soft" }));
  if (!panel.open) panel.showModal();
  try {
    const response = await fetch(link.href, { headers: { accept: "text/html" }, credentials: "same-origin" });
    if (!response.ok) throw new Error(String(response.status));
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    const article = doc.querySelector("#artigo");
    if (!article) throw new Error("sem artigo");
    body.replaceChildren(document.importNode(article, true));
    panel.querySelector<HTMLElement>("[data-help-scroll]")?.scrollTo({ top: 0 });
  } catch {
    const message = document.createElement("p");
    message.textContent = "Não foi possível abrir a ajuda aqui. ";
    const fallback = document.createElement("a");
    fallback.href = link.href;
    fallback.textContent = "Abrir a página da ajuda";
    fallback.className = "font-semibold text-brand underline";
    message.append(fallback, ".");
    body.replaceChildren(message);
  }
}

document.addEventListener("click", (event) => {
  const target = event.target as Element | null;
  const link = target?.closest<HTMLAnchorElement>("a[data-help-open]");
  if (link && panel && typeof panel.showModal === "function" && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    void openPanel(link);
    return;
  }
  // Tocar fora do painel (no fundo) ou em "Fechar" fecha.
  if (panel?.open && (target === panel || target?.closest("[data-help-close]"))) panel.close();
});
