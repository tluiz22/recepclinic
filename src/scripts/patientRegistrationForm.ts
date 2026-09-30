// "Cadastrar paciente" (Fase 21): mostra os blocos certos pela idade e busca
// o responsável já cadastrado. As regras são revalidadas no servidor
// (`/api/admin/pacientes`).
//   - menor de 18 → bloco Responsável obrigatório (já cadastrado ou novo);
//   - 18+ → "O paciente é o próprio responsável" (marcado: só o telefone;
//     desmarcado: bloco Responsável);
//   - idade ≥ limite para consulta → aviso, sem bloquear (pode ser exame).
import { ageInYears, isAdult } from "../lib/age";
import { formatPhoneBR } from "../lib/phone";

const form = document.getElementById("patient_registration_form") as HTMLFormElement | null;

if (form) {
  const today = form.dataset.today ?? "";
  const ageLimit = Number(form.dataset.ageLimit);

  const birthdateInput = document.getElementById("patient_birthdate") as HTMLInputElement;
  const ageLimitWarning = document.getElementById("age_limit_warning") as HTMLParagraphElement;
  const selfBox = document.getElementById("guardian_self_box") as HTMLDivElement;
  const selfCheckbox = document.getElementById("guardian_self") as HTMLInputElement;
  const selfPhoneBox = document.getElementById("self_phone_box") as HTMLDivElement;
  const selfPhoneInput = document.getElementById("self_phone") as HTMLInputElement;
  const guardianBox = document.getElementById("guardian_box") as HTMLFieldSetElement;
  const existingBox = document.getElementById("guardian_existing_box") as HTMLDivElement;
  const newBox = document.getElementById("guardian_new_box") as HTMLDivElement;
  const guardianNameInput = document.getElementById("guardian_full_name") as HTMLInputElement;
  const guardianPhoneInput = document.getElementById("guardian_phone") as HTMLInputElement;
  const modeRadios = form.querySelectorAll<HTMLInputElement>('input[name="guardian_mode"]');

  const searchInput = document.getElementById("guardian_search") as HTMLInputElement;
  const guardianIdInput = document.getElementById("guardian_id") as HTMLInputElement;
  const resultsBox = document.getElementById("guardian_results") as HTMLDivElement;
  const warningBox = document.getElementById("guardian_warning") as HTMLParagraphElement;
  const clearBtn = document.getElementById("guardian_clear") as HTMLButtonElement;

  function selectedMode(): "existing" | "new" {
    return Array.from(modeRadios).find((radio) => radio.checked)?.value === "new" ? "new" : "existing";
  }

  function update() {
    const birthdate = birthdateInput.value;
    const adult = !!birthdate && isAdult(birthdate, today);
    const guardianSelf = adult && selfCheckbox.checked;
    const mode = selectedMode();

    ageLimitWarning.classList.toggle("hidden", !birthdate || ageInYears(birthdate, today) < ageLimit);

    selfBox.classList.toggle("hidden", !adult);
    // Desabilitado não vai no envio: menor nunca manda `guardian_self`.
    selfCheckbox.disabled = !adult;
    selfPhoneBox.classList.toggle("hidden", !guardianSelf);
    selfPhoneInput.required = guardianSelf;

    guardianBox.classList.toggle("hidden", guardianSelf);
    existingBox.classList.toggle("hidden", mode !== "existing");
    newBox.classList.toggle("hidden", mode !== "new");
    newBox.classList.toggle("grid", mode === "new");
    guardianNameInput.required = !guardianSelf && mode === "new";
    guardianPhoneInput.required = !guardianSelf && mode === "new";
  }

  birthdateInput.addEventListener("input", update);
  birthdateInput.addEventListener("change", update);
  selfCheckbox.addEventListener("change", update);
  modeRadios.forEach((radio) => radio.addEventListener("change", update));
  update();

  // ---- busca do responsável já cadastrado (mesmo padrão do patientSearch) ----
  let debounceTimer: ReturnType<typeof setTimeout>;

  function showWarning(message: string) {
    warningBox.textContent = message;
    warningBox.classList.remove("hidden");
  }

  function resetSelection() {
    guardianIdInput.value = "";
    warningBox.classList.add("hidden");
    clearBtn.classList.add("hidden");
  }

  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    resultsBox.innerHTML = "";
    resetSelection();
    searchInput.focus();
  });

  form.addEventListener("submit", (event) => {
    const needsExistingGuardian = !guardianBox.classList.contains("hidden") && selectedMode() === "existing";
    if (needsExistingGuardian && !guardianIdInput.value) {
      event.preventDefault();
      showWarning("Selecione um responsável da lista de resultados.");
      searchInput.focus();
    }
  });

  searchInput.addEventListener("input", () => {
    resetSelection();
    clearTimeout(debounceTimer);
    const q = searchInput.value.trim();

    if (q.length < 2) {
      resultsBox.innerHTML = "";
      return;
    }

    debounceTimer = setTimeout(async () => {
      const response = await fetch(`/api/admin/responsaveis/search?${new URLSearchParams({ q }).toString()}`);
      const guardians: { id: string; full_name: string; phone: string }[] = await response.json();
      resultsBox.innerHTML = "";

      if (!guardians.length) {
        const empty = document.createElement("p");
        empty.className = "px-3 py-2 text-sm text-slate-500";
        empty.textContent = "Nenhum responsável encontrado — use \"Novo responsável\".";
        resultsBox.appendChild(empty);
        return;
      }

      guardians.forEach((guardian) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className =
          "block w-full border-t border-slate-100 px-3 py-2 text-left text-sm first:border-t-0 hover:bg-slate-100";
        const label = `${guardian.full_name} (${formatPhoneBR(guardian.phone)})`;
        item.textContent = label;
        item.addEventListener("click", () => {
          guardianIdInput.value = guardian.id;
          searchInput.value = label;
          resultsBox.innerHTML = "";
          warningBox.classList.add("hidden");
          clearBtn.classList.remove("hidden");
        });
        resultsBox.appendChild(item);
      });
    }, 300);
  });
}
