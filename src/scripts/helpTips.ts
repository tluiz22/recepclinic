// Ajuda contextual (23/out/2026), carregado nas molduras. Sem ele, o "i" e o
// "Como funciona?" abrem e fecham pelo próprio <details>; com ele:
// - "i" (HelpTip): Esc fecha e devolve o foco, tocar fora fecha, um aberto por
//   vez, a setinha do texto aponta para o "i" e o balão não passa da tela;
// - "Como funciona?" (HowItWorks): o botão "Fechar" no painel e, só neste
//   navegador, lembrar se a pessoa deixou aberto.

const TIPS = "details[data-help]";
const openTips = () => [...document.querySelectorAll<HTMLDetailsElement>(`${TIPS}[open]`)];
/** O "i" e o texto dele (no inline, o texto fica fora do <details>). */
const tipArea = (tip: HTMLDetailsElement): Element => tip.closest("[data-help-root]") ?? tip;

function pointArrow(tip: HTMLDetailsElement): void {
  const text = tip.closest("[data-help-root]")?.querySelector<HTMLElement>(":scope > [data-help-text]");
  const button = tip.querySelector("summary");
  if (!text || !button) return;
  const circle = button.firstElementChild ?? button;
  const { left, width } = circle.getBoundingClientRect();
  const offset = left + width / 2 - text.getBoundingClientRect().left - 6;
  text.style.setProperty("--help-arrow", `${Math.max(8, offset)}px`);
  text.setAttribute("data-arrow", "");
}

/** Balão junto do "i" (variant "pop"): não passa da borda da tela. */
function keepInView(tip: HTMLDetailsElement): void {
  const box = tip.querySelector<HTMLElement>(".help-pop-box");
  if (!box) return;
  box.style.left = "";
  const { left, right } = box.getBoundingClientRect();
  const margin = 12;
  const shift = right > innerWidth - margin ? right - (innerWidth - margin) : 0;
  box.style.left = `${-Math.min(shift, left - margin)}px`;
}

document.addEventListener(
  "toggle",
  (event) => {
    const tip = event.target;
    if (!(tip instanceof HTMLDetailsElement) || !tip.matches(TIPS) || !tip.open) return;
    for (const other of openTips()) if (other !== tip) other.open = false;
    pointArrow(tip);
    keepInView(tip);
  },
  true,
);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  for (const tip of openTips()) {
    tip.open = false;
    tip.querySelector("summary")?.focus();
  }
});

document.addEventListener("click", (event) => {
  const target = event.target as Node;
  for (const tip of openTips()) if (!tipArea(tip).contains(target)) tip.open = false;
});

// "Como funciona?"
const storageKey = (id: string) => `rc-como-funciona:${id}`;
for (const how of document.querySelectorAll<HTMLDetailsElement>("details[data-how]")) {
  const id = how.dataset.how ?? "";
  try {
    if (localStorage.getItem(storageKey(id)) === "1") how.open = true;
  } catch {
    // Navegador sem armazenamento: começa fechado.
  }
  how.addEventListener("toggle", () => {
    try {
      if (how.open) localStorage.setItem(storageKey(id), "1");
      else localStorage.removeItem(storageKey(id));
    } catch {
      // Sem armazenamento: só não lembra.
    }
  });
  const close = how.closest(".how-root")?.querySelector<HTMLElement>("[data-how-close]");
  if (!close) continue;
  close.hidden = false;
  close.querySelector("button")?.addEventListener("click", () => {
    how.open = false;
    how.querySelector("summary")?.focus();
  });
}
