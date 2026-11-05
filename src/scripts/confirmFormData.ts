import { confirmDetails, type FieldReading } from "../lib/confirmData";
import { formatPhoneBR, normalizePhone } from "../lib/phone";

// Conferência dos dados antes de cadastrar ou alterar (C19; cliente,
// 03/nov/2026). Formulário com `data-confirm-data` (e `data-today`, a data de
// hoje da clínica): no clique do botão de confirmação (`.js-confirm-delete`),
// antes do diálogo abrir, lê os campos com `data-confirm-label` e grava a
// lista em `data-confirm-details` do botão (src/scripts/confirmDelete.ts).
// Campo dentro de um bloco escondido fica de fora; data com
// `data-confirm-age` mostra a idade; opção (radio) usa `data-confirm-text`.
// Campo com `data-confirm-whatsapp` (o título do quadro; cliente, 05/nov/2026, opção A2): o número digitado aparece
// em destaque na confirmação, com "Conferi o número com o paciente" obrigatório.

function readField(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): FieldReading | null {
  if (el.closest("[hidden]")) return null;
  const label = el.dataset.confirmLabel!;
  if (el instanceof HTMLSelectElement) {
    const selected = el.selectedOptions[0];
    const initial = [...el.options].find((option) => option.defaultSelected) ?? el.options[0];
    return { label, value: el.value, initial: initial?.value, text: selected?.text ?? "", initialText: initial?.text, kind: "text" };
  }
  if (el instanceof HTMLInputElement && el.type === "radio") {
    if (!el.checked) return null;
    return { label, value: el.value, text: el.dataset.confirmText ?? el.value, kind: "text" };
  }
  const isDate = el instanceof HTMLInputElement && el.type === "date";
  return { label, value: el.value, initial: el.defaultValue, kind: isDate ? "date" : "text", age: el.dataset.confirmAge !== undefined };
}

document.querySelectorAll<HTMLFormElement>("form[data-confirm-data]").forEach((form) => {
  form.addEventListener(
    "click",
    (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button.js-confirm-delete");
      if (!button || button.form !== form) return;
      const fields = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[data-confirm-label]")]
        .map(readField)
        .filter((field): field is FieldReading => field !== null);
      button.dataset.confirmDetails = JSON.stringify(confirmDetails(fields, form.dataset.today ?? new Date().toISOString().slice(0, 10)));
      // `data-confirm-whatsapp-changed` (tela do contato): só quando o número muda.
      const whatsapp = [...form.querySelectorAll<HTMLInputElement>("input[data-confirm-whatsapp]")].find(
        (el) => !el.closest("[hidden]") && !(el.dataset.confirmWhatsappChanged !== undefined && normalizePhone(el.value) === normalizePhone(el.defaultValue)),
      );
      const phone = whatsapp ? normalizePhone(whatsapp.value) : null;
      button.dataset.confirmWhatsapp = phone ? formatPhoneBR(phone) : (whatsapp?.value.trim() ?? "");
      button.dataset.confirmWhatsappLabel = whatsapp?.dataset.confirmWhatsapp ?? "";
    },
    // Antes do clique chegar ao botão (o diálogo abre no clique dele).
    true,
  );
});
