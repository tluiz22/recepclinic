const dialog = document.getElementById("delete_dialog") as HTMLDialogElement;
const messageEl = document.getElementById("delete_dialog_message") as HTMLParagraphElement;
const dismissBtn = document.getElementById("delete_dialog_dismiss") as HTMLButtonElement;
const acceptBtn = document.getElementById("delete_dialog_accept") as HTMLButtonElement;
const titleEl = document.getElementById("delete_dialog_title") as HTMLHeadingElement;

let pendingForm: HTMLFormElement | null = null;
let pendingButton: HTMLButtonElement | null = null;

// Tom do botão de confirmar (F4.5): vermelho para o que desfaz algo
// (padrão), azul para confirmar uma ação comum (`data-confirm-tone="primary"`).
const TONES = {
  danger: ["bg-red-600", "hover:bg-red-700"],
  primary: ["bg-sky-700", "hover:bg-sky-800"],
};

document.querySelectorAll<HTMLButtonElement>(".js-confirm-delete").forEach((btn) => {
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    pendingForm = btn.closest("form");
    pendingButton = btn;
    // Campo obrigatório vazio (ex.: nenhum horário escolhido): avisa no campo.
    if (pendingForm && !pendingForm.checkValidity()) {
      pendingForm.reportValidity();
      return;
    }
    messageEl.textContent = btn.dataset.confirmMessage ?? "Tem certeza que quer excluir?";
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
  pendingForm?.submit();
  dialog.close();
});
