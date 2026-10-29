const dialog = document.getElementById("delete_dialog") as HTMLDialogElement;
const messageEl = document.getElementById("delete_dialog_message") as HTMLParagraphElement;
const dismissBtn = document.getElementById("delete_dialog_dismiss") as HTMLButtonElement;
const acceptBtn = document.getElementById("delete_dialog_accept") as HTMLButtonElement;
const titleEl = document.getElementById("delete_dialog_title") as HTMLHeadingElement;
const detailsEl = document.getElementById("delete_dialog_details") as HTMLDListElement;
const noticeEl = document.getElementById("delete_dialog_notice") as HTMLParagraphElement;

// Dados do atendimento na confirmação (Marcar e Alterar; cliente, 28/out/2026):
// `data-confirm-details` é uma lista JSON de ConfirmDetail; com `before`, a
// linha mostra "antes → depois".
type ConfirmDetail = { label: string; value: string; before?: string };

function renderDetails(raw: string | undefined) {
  let details: ConfirmDetail[] = [];
  try {
    details = raw ? (JSON.parse(raw) as ConfirmDetail[]) : [];
  } catch {
    details = [];
  }
  detailsEl.replaceChildren(
    ...details.flatMap((detail) => {
      const dt = document.createElement("dt");
      dt.className = "font-medium text-ink-soft";
      dt.textContent = detail.label;
      const dd = document.createElement("dd");
      dd.className = "font-semibold text-ink";
      if (detail.before !== undefined) {
        const before = document.createElement("s");
        before.className = "font-medium text-ink-soft";
        before.textContent = detail.before;
        dd.append(before, " → ", detail.value);
      } else dd.textContent = detail.value;
      return [dt, dd];
    }),
  );
  detailsEl.hidden = details.length === 0;
}

let pendingForm: HTMLFormElement | null = null;
let pendingButton: HTMLButtonElement | null = null;

// Tom do botão de confirmar (F4.5): vermelho para o que desfaz algo
// (padrão), verde da marca para confirmar uma ação comum
// (`data-confirm-tone="primary"`; redesign, 15/out/2026).
const TONES = {
  danger: ["bg-danger-solid", "hover:bg-danger-solid-strong"],
  primary: ["bg-brand", "hover:bg-brand-strong"],
};

document.querySelectorAll<HTMLButtonElement>(".js-confirm-delete").forEach((btn) => {
  btn.addEventListener("click", (event) => {
    // Confirmação só quando a tela pede (ex.: Serviço, ao tirar um local com horário; C5, 28/out/2026).
    if (btn.dataset.confirmSkip !== undefined) return;
    event.preventDefault();
    // `btn.form`: também o botão fora do formulário, ligado por `form="…"` (R4).
    pendingForm = btn.form ?? btn.closest("form");
    pendingButton = btn;
    // Campo obrigatório vazio (ex.: nenhum horário escolhido): avisa no campo.
    if (pendingForm && !pendingForm.checkValidity()) {
      pendingForm.reportValidity();
      return;
    }
    messageEl.textContent = btn.dataset.confirmMessage ?? (btn.dataset.confirmDetails ? "" : "Tem certeza que quer excluir?");
    messageEl.hidden = !messageEl.textContent;
    renderDetails(btn.dataset.confirmDetails);
    noticeEl.textContent = btn.dataset.confirmNotice ?? "";
    noticeEl.hidden = !noticeEl.textContent;
    titleEl.textContent = btn.dataset.confirmTitle ?? "Excluir?";
    acceptBtn.textContent = btn.dataset.confirmLabel ?? "Excluir";
    const tone = btn.dataset.confirmTone === "primary" ? "primary" : "danger";
    acceptBtn.classList.remove(...TONES.danger, ...TONES.primary);
    acceptBtn.classList.add(...TONES[tone]);
    dialog.showModal();
  });
});

dismissBtn.addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

acceptBtn.addEventListener("click", () => {
  // Já enviado (src/scripts/sendOnce.ts): um segundo aceite não envia de novo.
  if (pendingForm?.dataset.sending !== undefined) {
    dialog.close();
    return;
  }
  // Envia antes de fechar o <dialog> — em alguns navegadores, fechar o
  // modal primeiro consome o gesto do usuário e o envio seguinte não sai.
  // `submit()` (em vez de `requestSubmit()`) porque esses formulários não
  // têm campo nenhum pra validar, e é a API mais antiga/compatível das duas.
  // `submit()` não leva o botão clicado: o nome e o valor dele vão num campo
  // escondido (ex.: "cancelar" ou "manter" no Bloquear).
  if (pendingForm && pendingButton?.name) {
    pendingForm.querySelector(`input[type=hidden][data-submitter]`)?.remove();
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = pendingButton.name;
    field.value = pendingButton.value;
    field.dataset.submitter = "";
    pendingForm.append(field);
  }
  // Guarda os campos para o caso de voltar com erro (src/scripts/keepFormValues.ts).
  // Leva o botão que pediu a confirmação: ele mostra o "Enviando…" (src/scripts/sendOnce.ts).
  pendingForm?.dispatchEvent(new CustomEvent("rc:enviar", { bubbles: true, detail: { submitter: pendingButton } }));
  pendingForm?.submit();
  dialog.close();
});
