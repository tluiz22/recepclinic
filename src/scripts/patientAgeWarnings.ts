// Avisos de idade ao marcar/remarcar consulta ou retorno pela tela (Fase 21)
// — só informam, nunca bloqueiam o envio (a médica pode abrir exceção; o bot
// é que recusa). Usado por marcar.astro e remarcar.astro.
//   - Consulta: idade ≥ idade limite (Configurações > Duração);
//   - Retorno: paciente 18+.
// A data de nascimento vem do paciente escolhido na busca
// (`patient_id.dataset.birthdate`, preenchido por patientSearch.ts) ou, no
// paciente já definido pela página (remarcar ou link pré-preenchido), do
// `data-birthdate` da própria caixa.
import { ADULT_AGE_YEARS, ageInYears } from "../lib/age";

const box = document.getElementById("patient_age_warning") as HTMLDivElement | null;
const typeSelect = document.getElementById("appointment_type") as HTMLSelectElement | null;
const patientInput = document.getElementById("patient_id") as HTMLInputElement | null;

function currentBirthdate(): string | null {
  if (!box) return null;
  if (!patientInput) return box.dataset.birthdate || null;
  if (!patientInput.value) return null;
  return patientInput.dataset.birthdate || box.dataset.birthdate || null;
}

function render() {
  if (!box) return;
  const birthdate = currentBirthdate();
  const today = box.dataset.today ?? "";
  const ageLimit = Number(box.dataset.ageLimit);
  let message: string | null = null;

  if (birthdate && today) {
    const age = ageInYears(birthdate, today);
    if (typeSelect?.value === "first_visit" && age >= ageLimit) {
      message = `Paciente com ${age} anos — a idade limite para consulta é ${ageLimit} anos. A marcação continua permitida, como exceção.`;
    } else if (typeSelect?.value === "return_visit" && age >= ADULT_AGE_YEARS) {
      message = `Paciente com ${age} anos — retorno é só para menores de ${ADULT_AGE_YEARS} anos. A marcação continua permitida, como exceção.`;
    }
  }

  box.textContent = message ? `⚠ ${message}` : "";
  box.classList.toggle("hidden", !message);
}

typeSelect?.addEventListener("change", render);
patientInput?.addEventListener("change", render);
render();
