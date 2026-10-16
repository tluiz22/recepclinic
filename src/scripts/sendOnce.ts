// Envio único (R5, cliente, 16/out/2026; suspeita de envio duplo da auditoria
// de 14/out): um formulário POST enviado fica travado até a tela seguinte
// abrir. Um segundo toque não grava de novo; os botões de envio dele ficam
// desabilitados, com `aria-busy`, e o que tem `data-sending-label` troca o texto
// (ex.: "Registrando…"). Vale para o envio comum e para o do diálogo de
// confirmação (`rc:enviar`, src/scripts/confirmDelete.ts). Ficam de fora o
// formulário com `data-envio-livre` (o "Gerar arquivo" da DMED, que baixa um
// arquivo e não sai da tela), o que abre em outra aba e o tratado por
// JavaScript (envio cancelado). Voltar pelo navegador destrava tudo.

const SENDING = "sending";

function submitButtons(form: HTMLFormElement): HTMLButtonElement[] {
  const inside = [...form.querySelectorAll<HTMLButtonElement>("button:not([type=button]):not([type=reset])")];
  // Botões fora do formulário, ligados por `form="…"` (ex.: a barra fixa do celular).
  const outside = form.id ? [...document.querySelectorAll<HTMLButtonElement>(`button[form="${CSS.escape(form.id)}"]`)] : [];
  return [...inside, ...outside].filter((button) => button.form === form);
}

function lockable(form: HTMLFormElement): boolean {
  if ((form.getAttribute("method") ?? "").toUpperCase() !== "POST") return false;
  if (form.hasAttribute("data-envio-livre")) return false;
  const target = form.getAttribute("target");
  return !target || target === "_self";
}

function lock(form: HTMLFormElement, submitter: HTMLElement | null): void {
  form.dataset[SENDING] = "";
  for (const button of submitButtons(form)) {
    if (button.disabled) continue;
    button.dataset.sendLock = "";
    button.disabled = true;
    if (button === submitter) {
      button.setAttribute("aria-busy", "true");
      const label = button.dataset.sendingLabel;
      if (label) {
        button.dataset.sendOriginal = button.innerHTML;
        button.textContent = label;
      }
    }
  }
}

function unlockAll(): void {
  document.querySelectorAll<HTMLFormElement>("form[data-sending]").forEach((form) => delete form.dataset[SENDING]);
  document.querySelectorAll<HTMLButtonElement>("button[data-send-lock]").forEach((button) => {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (button.dataset.sendOriginal !== undefined) button.innerHTML = button.dataset.sendOriginal;
    delete button.dataset.sendLock;
    delete button.dataset.sendOriginal;
  });
}

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !lockable(form)) return;
  if (form.dataset[SENDING] !== undefined) {
    event.preventDefault();
    return;
  }
  if (event.defaultPrevented) return;
  form.dataset[SENDING] = "";
  // Desabilitar o botão agora tiraria o nome e o valor dele do envio; o
  // navegador monta os dados logo depois deste evento.
  setTimeout(() => {
    if (event.defaultPrevented) {
      delete form.dataset[SENDING];
      return;
    }
    lock(form, event.submitter);
  });
});

document.addEventListener("rc:enviar", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !lockable(form)) return;
  const submitter = (event as CustomEvent<{ submitter?: HTMLElement | null }>).detail?.submitter ?? null;
  lock(form, submitter);
});

window.addEventListener("pageshow", unlockAll);
