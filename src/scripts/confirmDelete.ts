const dialog = document.getElementById("delete_dialog") as HTMLDialogElement;
const messageEl = document.getElementById("delete_dialog_message") as HTMLParagraphElement;
const dismissBtn = document.getElementById("delete_dialog_dismiss") as HTMLButtonElement;
const acceptBtn = document.getElementById("delete_dialog_accept") as HTMLButtonElement;

let pendingForm: HTMLFormElement | null = null;

document.querySelectorAll<HTMLButtonElement>(".js-confirm-delete").forEach((btn) => {
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    pendingForm = btn.closest("form");
    messageEl.textContent = btn.dataset.confirmMessage ?? "Tem certeza que quer excluir?";
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
  pendingForm?.submit();
  dialog.close();
});
