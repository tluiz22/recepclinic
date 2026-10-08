import { describe, expect, it } from "vitest";
import { countFailedSends, describeSendsAlert, isRunProblem, jobRunState } from "../sends";
import { buildSummaryList, computeSummarySendAt, describeSummarySchedule, earliestByWeekday, kindOf } from "./dailySummary";

const TZ = "America/Fortaleza";
const at = (iso: string) => new Date(`${iso}-03:00`);
const DAY = "2026-10-14"; // quarta

describe("horário do resumo do dia", () => {
  it("1h antes da primeira janela, ou do primeiro atendimento se for antes", () => {
    expect(computeSummarySendAt(DAY, "07:00", at(`${DAY}T10:00:00`), TZ, false)).toEqual(at(`${DAY}T06:00:00`));
    expect(computeSummarySendAt(DAY, "07:00", at(`${DAY}T06:30:00`), TZ, false)).toEqual(at(`${DAY}T05:30:00`));
  });

  it("sem janela ou em dia de folga: 6h30 (ou antes, pelo primeiro atendimento)", () => {
    expect(computeSummarySendAt(DAY, null, at(`${DAY}T10:00:00`), TZ, false)).toEqual(at(`${DAY}T06:30:00`));
    expect(computeSummarySendAt(DAY, "08:00", at(`${DAY}T14:00:00`), TZ, true)).toEqual(at(`${DAY}T06:30:00`));
    expect(computeSummarySendAt(DAY, null, at(`${DAY}T07:00:00`), TZ, false)).toEqual(at(`${DAY}T06:00:00`));
  });

  it("achado 5: nunca antes da 0h do próprio dia", () => {
    expect(computeSummarySendAt(DAY, "00:30", at(`${DAY}T00:30:00`), TZ, false)).toEqual(at(`${DAY}T00:00:00`));
    expect(describeSummarySchedule([null, "00:30", "01:15", null, null, null, null])).toBe("seg 0h · ter 0h15");
  });

  it("horas antes escolhidas pela clínica (F7): 3 h antes da primeira agenda; nunca antes da 0h", () => {
    const threeHours = 3 * 60;
    expect(computeSummarySendAt(DAY, "07:00", at(`${DAY}T10:00:00`), TZ, false, threeHours)).toEqual(at(`${DAY}T04:00:00`));
    expect(computeSummarySendAt(DAY, "02:00", at(`${DAY}T10:00:00`), TZ, false, threeHours)).toEqual(at(`${DAY}T00:00:00`));
    expect(describeSummarySchedule([null, "08:00", "13:30", null, null, null, null], 2 * 60)).toBe("seg 6h · ter 11h30");
  });

  it("no fuso da clínica", () => {
    // 8h em Manaus (UTC-4) = 12h UTC; o resumo sai às 7h de Manaus.
    expect(computeSummarySendAt(DAY, "08:00", new Date(`${DAY}T13:00:00Z`), "America/Manaus", false)).toEqual(new Date(`${DAY}T11:00:00Z`));
  });

  it("primeira janela de cada dia e rótulos", () => {
    const starts = earliestByWeekday([
      { weekday: 1, startTime: "13:00:00" },
      { weekday: 1, startTime: "07:30:00" },
      { weekday: 6, startTime: "10:15:00" },
    ]);
    expect(starts).toEqual([null, "07:30", null, null, null, null, "10:15"]);
    expect(describeSummarySchedule(starts)).toBe("seg 6h30 · sáb 9h15");
    expect(describeSummarySchedule(Array(7).fill(null))).toBe("nenhuma janela cadastrada");
  });

  it("consulta e retorno são consultas; exame é exames", () => {
    expect([kindOf("consultation"), kindOf("return_visit"), kindOf("exam")]).toEqual(["consultas", "consultas", "exames"]);
  });
});

describe("lista do resumo", () => {
  const items = [
    { start: at(`${DAY}T10:30:00`), patientName: "Maria", confirmed: false, homeAddress: "Rua X, 1", agendaName: "Dr. B" },
    { start: at(`${DAY}T09:00:00`), patientName: "João", confirmed: true, homeAddress: null, agendaName: "Dra. A" },
  ];

  it("numa linha, por horário, com presença e endereço do domiciliar", () => {
    expect(buildSummaryList(items, TZ, false)).toBe(
      "▪️ 09h00 - João (✅ confirmado) ▪️ 10h30 - Maria (sem confirmação) - Endereço: Rua X, 1",
    );
  });

  it("com o nome da agenda quando pedido (lista geral com mais de uma agenda)", () => {
    expect(buildSummaryList(items, TZ, true)).toBe(
      "▪️ 09h00 - João (Dra. A) (✅ confirmado) ▪️ 10h30 - Maria (Dr. B) (sem confirmação) - Endereço: Rua X, 1",
    );
  });
});

describe("envios com falha e execuções", () => {
  const scheduledAt = at("2026-10-15T09:00:00");
  const msg = (messageType: string, status: string, iso: string) => ({ messageType, status, createdAt: at(iso) });

  it("conta a última tentativa de cada tipo que não saiu", () => {
    expect(countFailedSends([msg("appointment_reminder", "failed", "2026-10-14T14:00:00")], [], scheduledAt)).toBe(1);
    expect(
      countFailedSends([msg("appointment_reminder", "failed", "2026-10-14T14:00:00"), msg("appointment_reminder", "read", "2026-10-14T15:00:00")], [], scheduledAt),
    ).toBe(0);
  });

  it("confirmação com falha deixa de contar com remarcação avisada depois", () => {
    const messages = [msg("appointment_confirmation", "failed", "2026-10-10T10:00:00"), msg("appointment_reschedule", "delivered", "2026-10-11T10:00:00")];
    expect(countFailedSends(messages, [], scheduledAt)).toBe(0);
  });

  it("'não enviado' da data atual conta até sair um lembrete; o da data antiga não", () => {
    const notSent = { kind: "reminder", scheduledAt, occurredAt: at("2026-10-14T14:00:00") };
    expect(countFailedSends([], [notSent], scheduledAt)).toBe(1);
    expect(countFailedSends([msg("appointment_reminder", "sent", "2026-10-14T15:00:00")], [notSent], scheduledAt)).toBe(0);
    expect(countFailedSends([], [{ ...notSent, scheduledAt: at("2026-10-16T09:00:00") }], scheduledAt)).toBe(0);
    // Lembrete com falha e "não enviado": conta uma vez.
    expect(countFailedSends([msg("appointment_reminder", "failed", "2026-10-14T15:00:00")], [notSent], scheduledAt)).toBe(1);
  });

  it("execução parada há mais de 15 minutos caiu no meio", () => {
    const startedAt = at("2026-10-14T14:00:00");
    expect(jobRunState({ status: "running", startedAt }, at("2026-10-14T14:10:00"))).toBe("running");
    expect(jobRunState({ status: "running", startedAt }, at("2026-10-14T14:16:00"))).toBe("stuck");
    expect(isRunProblem({ status: "error", startedAt })).toBe(true);
    expect(isRunProblem({ status: "ok", startedAt })).toBe(false);
  });

  it("frases do alerta", () => {
    expect(describeSendsAlert({ reminderNotRun: false, reminderRunFailed: false, failedAppointments: 0 })).toEqual([]);
    expect(describeSendsAlert({ reminderNotRun: true, reminderRunFailed: true, failedAppointments: 2 })).toEqual([
      "O lembrete de hoje ainda não rodou.",
      "A execução do lembrete de hoje teve erro ou foi interrompida.",
      "2 atendimentos de hoje ou amanhã com envio com falha.",
    ]);
  });
});
