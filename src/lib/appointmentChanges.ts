// Alterar atendimento (C4; cliente, 28/out/2026): os dados de antes e de
// depois, lado a lado. A confirmação mostra todos, com "antes → depois" no que
// muda; a trilha guarda só o que mudou. Mudar data, hora, agenda ou local
// avisa o paciente e recomeça o lembrete e a presença confirmada.
import { formatInstant } from "./clinicTime";
import { formatCentsBRL } from "./money";

/** Os dados do atendimento como aparecem na tela ("Consulta · 30 min", "Particular"…). */
export type AppointmentSnapshot = {
  patient: string;
  service: string;
  agenda: string;
  location: string;
  when: string;
  address: string | null;
  /** null: a clínica não usa convênio. */
  insurance: string | null;
  price: string | null;
};

export type SnapshotRow = { label: string; value: string; before?: string };

const FIELDS: { key: keyof AppointmentSnapshot; label: string }[] = [
  { key: "patient", label: "Paciente" },
  { key: "service", label: "Serviço" },
  { key: "agenda", label: "Com quem" },
  { key: "location", label: "Local" },
  { key: "when", label: "Quando" },
  { key: "address", label: "Endereço" },
  { key: "insurance", label: "Convênio" },
  { key: "price", label: "Valor" },
];

/** As linhas da confirmação: cada dado de depois e, se mudou, o de antes. Vazio dos dois lados não aparece. */
export function compareSnapshots(before: AppointmentSnapshot, after: AppointmentSnapshot, patientLabel = "Paciente"): SnapshotRow[] {
  return FIELDS.flatMap(({ key, label }) => {
    const from = before[key] ?? "";
    const to = after[key] ?? "";
    if (!from && !to) return [];
    const row: SnapshotRow = { label: key === "patient" ? patientLabel : label, value: to || "—" };
    if (from !== to) row.before = from || "—";
    return [row];
  });
}

/** O que mudou, para a trilha. */
export function snapshotChanges(before: AppointmentSnapshot, after: AppointmentSnapshot): { label: string; from: string; to: string }[] {
  return compareSnapshots(before, after)
    .filter((row) => row.before !== undefined)
    .map((row) => ({ label: row.label, from: row.before!, to: row.value }));
}

/** Mudou data, hora, agenda ou local: o paciente é avisado (decisão do cliente). */
export function changesSchedule(before: AppointmentSnapshot, after: AppointmentSnapshot): boolean {
  return before.when !== after.when || before.agenda !== after.agenda || before.location !== after.location;
}

/** "Sexta-feira, 06/11 às 14:00": o "Quando" de antes e de depois, sempre no mesmo formato. */
export function whenText(start: Date, timeZone: string): string {
  const text = formatInstant(start, timeZone, "EEEE, dd/MM 'às' HH:mm");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Os dados de um atendimento (o atual ou o pedido) no formato da tela. */
export function snapshotOf(input: {
  patient: string;
  service: { name: string; durationMinutes: number } | undefined;
  agenda: string | undefined;
  location: string | undefined;
  start: Date;
  timeZone: string;
  address: string | null;
  /** Nome do plano, "Particular", ou null sem o item Convênios. */
  insurance: string | null;
  priceCents: number | null;
}): AppointmentSnapshot {
  return {
    patient: input.patient,
    service: input.service ? `${input.service.name} · ${input.service.durationMinutes} min` : "—",
    agenda: input.agenda ?? "—",
    location: input.location ?? "—",
    when: whenText(input.start, input.timeZone),
    address: input.address?.trim() || null,
    insurance: input.insurance,
    price: input.priceCents !== null ? formatCentsBRL(input.priceCents) : null,
  };
}
