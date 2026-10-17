// "Mostrar" no campo de senha (R10, cliente, 17/out/2026): troca o campo entre
// senha e texto e o botão entre "Mostrar" e "Ocultar" (o texto diz o estado). Sem JavaScript, o botão
// fica escondido (`hidden`) e o campo continua de senha.

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-password-toggle]")) {
  const input = document.getElementById(button.getAttribute("aria-controls") ?? "");
  if (!(input instanceof HTMLInputElement)) continue;
  button.hidden = false;
  button.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.textContent = show ? "Ocultar" : "Mostrar";
    input.focus();
  });
}

// Antes de enviar, o campo volta a ser de senha: o navegador não oferece
// guardar o texto como um campo comum e o keepFormValues continua a ignorá-lo.
document.addEventListener("submit", (event) => {
  if (!(event.target instanceof HTMLFormElement)) return;
  for (const button of event.target.querySelectorAll<HTMLButtonElement>("[data-password-toggle]")) {
    const input = document.getElementById(button.getAttribute("aria-controls") ?? "");
    if (input instanceof HTMLInputElement) input.type = "password";
  }
});
