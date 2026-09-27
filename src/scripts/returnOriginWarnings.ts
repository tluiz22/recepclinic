// Avisos da Consulta de origem ao marcar/remarcar um retorno pela tela
// (Fase 17) — só informam, nunca bloqueiam o envio (exceções combinadas
// com a médica). Usado por marcar.astro e remarcar.astro.

const box = document.getElementById("return_origin_box") as HTMLDivElement | null;
const typeSelect = document.getElementById("appointment_type") as HTMLSelectElement | null;
const dateSelect = document.getElementById("date") as HTMLSelectElement | null;
const patientInput = document.getElementById("patient_id") as HTMLInputElement | null;

interface ReturnOriginCheck {
  deadlineDays: number;
  origin: { id: string; date: string; lastDate: string } | null;
  warnings: string[];
}

let lastCheck: ReturnOriginCheck | null = null;
let requestSeq = 0;

function formatDateBR(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  return `${day}/${month}/${year}`;
}

function render() {
  if (!box) return;
  box.innerHTML = "";

  if (!lastCheck || typeSelect?.value !== "return_visit") {
    box.classList.add("hidden");
    return;
  }

  const lines: { text: string; warning: boolean }[] = [];
  if (lastCheck.origin) {
    lines.push({
      text: `Retorno da consulta de ${formatDateBR(lastCheck.origin.date)} — prazo até ${formatDateBR(lastCheck.origin.lastDate)}.`,
      warning: false,
    });
  }
  for (const warning of lastCheck.warnings) lines.push({ text: warning, warning: true });

  const outOfDeadline = lastCheck.origin && lastCheck.warnings.some((w) => w.startsWith("Fora do prazo"));
  if (lastCheck.origin && !outOfDeadline && dateSelect?.value && dateSelect.value > lastCheck.origin.lastDate) {
    lines.push({
      text: `A data escolhida passa do prazo do retorno (até ${formatDateBR(lastCheck.origin.lastDate)}).`,
      warning: true,
    });
  }

  const hasWarning = lines.some((line) => line.warning);
  box.className = `rounded-lg border px-3 py-2 text-sm ${
    hasWarning ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-700"
  }`;
  for (const line of lines) {
    const p = document.createElement("p");
    p.textContent = line.warning ? `⚠ ${line.text}` : line.text;
    box.appendChild(p);
  }
}

async function refresh() {
  const patientId = patientInput?.value || box?.dataset.patientId || "";
  if (!box || typeSelect?.value !== "return_visit" || !patientId) {
    lastCheck = null;
    render();
    return;
  }

  const seq = ++requestSeq;
  const params = new URLSearchParams({ patient_id: patientId });
  if (box.dataset.appointmentId) params.set("appointment_id", box.dataset.appointmentId);
  const response = await fetch(`/api/admin/agenda/return-origin?${params.toString()}`);
  if (seq !== requestSeq) return;
  lastCheck = response.ok ? await response.json() : null;
  render();
}

typeSelect?.addEventListener("change", refresh);
patientInput?.addEventListener("change", refresh);
// A lista de datas é refeita por appointmentSlotPicker.ts — reavalia o
// aviso de "passa do prazo" sem buscar de novo.
dateSelect?.addEventListener("change", render);
new MutationObserver(render).observe(dateSelect ?? document.createElement("select"), { childList: true });

refresh();
