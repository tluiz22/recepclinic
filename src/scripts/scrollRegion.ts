// Tabela com rolagem própria (R7, QA-06 do teste de interface): a caixa só
// vira região com nome e parada do Tab quando a tabela não cabe e precisa
// rolar de lado (no celular), para quem usa o teclado conseguir rolar. Se
// cabe, fica fora do Tab e o leitor de tela não repete o nome da seção.
// Marcação: `data-scroll-region="<nome da tabela>"` na caixa.

function update(box: HTMLElement): void {
  const scrolls = box.scrollWidth > box.clientWidth + 1;
  if (scrolls) {
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", box.dataset.scrollRegion ?? "Tabela");
    box.tabIndex = 0;
  } else {
    box.removeAttribute("role");
    box.removeAttribute("aria-label");
    box.removeAttribute("tabindex");
  }
}

const boxes = [...document.querySelectorAll<HTMLElement>("[data-scroll-region]")];
if (boxes.length) {
  const observer = new ResizeObserver((entries) => entries.forEach((entry) => update(entry.target as HTMLElement)));
  for (const box of boxes) {
    update(box);
    observer.observe(box);
  }
}
