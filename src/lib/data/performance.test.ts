import { describe, expect, it } from "vitest";
import { byServiceAndLocation, summarizePerformance, type AttendanceRow, type PerformanceData } from "./performance";

const empty: PerformanceData = { activity: [], attendance: [], reminders: [], returnRights: [] };

const att = (over: Partial<AttendanceRow>): AttendanceRow => ({
  day: "2026-10-01",
  serviceId: "s1",
  serviceName: "Consulta",
  category: "consultation",
  locationId: "l1",
  locationName: "Centro",
  scheduled: 0,
  canceled: 0,
  completed: 0,
  noShow: 0,
  unregistered: 0,
  upcoming: 0,
  ...over,
});

describe("indicadores do Desempenho", () => {
  it("sem dados: taxas sem valor (nunca 0% artificial)", () => {
    const s = summarizePerformance(empty);
    expect(s.attendance.showRate.rate).toBeNull();
    expect(s.reminders.confirmedRate.rate).toBeNull();
    expect(s.returns.dueWithReturn.rate).toBeNull();
    expect(s.attendance.partial).toBe(false);
  });

  it("remarcar e cancelar nunca somam nos criados", () => {
    const s = summarizePerformance({
      ...empty,
      activity: [
        {
          day: "2026-10-01",
          createdPanel: 3,
          createdWhatsapp: 2,
          createdCanceled: 1,
          returnsPanel: 1,
          returnsWhatsapp: 0,
          rescheduledPatient: 4,
          rescheduledTeam: 1,
          waitlistAdvanced: 1,
          canceledPatient: 2,
          canceledClinic: 1,
          canceledMass: 3,
        },
      ],
    });
    expect(s.created).toEqual({ total: 5, panel: 3, whatsapp: 2, canceledLater: 1 });
    expect(s.rescheduled).toEqual({ total: 6, patient: 4, team: 1, waitlist: 1 });
    expect(s.canceled).toMatchObject({ total: 6, patient: 2, clinic: 1, mass: 3 });
  });

  it("comparecimento: cancelados e sem registro fora da taxa; Parcial acima de 10% sem registro", () => {
    const s = summarizePerformance({ ...empty, attendance: [att({ scheduled: 30, canceled: 5, completed: 22, noShow: 3, unregistered: 5 })] });
    expect(s.attendance.showRate).toMatchObject({ n: 22, base: 25, enough: true });
    expect(s.attendance.partial).toBe(true);
    expect(s.canceled.ofScheduled).toMatchObject({ n: 5, base: 35 });
    const ok = summarizePerformance({ ...empty, attendance: [att({ scheduled: 30, completed: 26, noShow: 2, unregistered: 2 })] });
    expect(ok.attendance.partial).toBe(false);
  });

  it("lembretes: aguardando, não entregue e cancelado sem toque ficam fora da base", () => {
    const s = summarizePerformance({
      ...empty,
      reminders: [
        { outcome: "confirmed", status: "completed", total: 6 },
        { outcome: "no_answer", status: "no_show", total: 2 },
        { outcome: "no_answer", status: "completed", total: 2 },
        { outcome: "waiting", status: "scheduled", total: 3 },
        { outcome: "not_delivered", status: "scheduled", total: 1 },
        { outcome: "canceled_no_answer", status: "canceled", total: 4 },
        { outcome: "none", status: "no_show", total: 1 },
      ],
    });
    expect(s.reminders).toMatchObject({ confirmed: 6, noAnswer: 4, waiting: 3, notDelivered: 1, sent: 14 });
    expect(s.reminders.confirmedRate).toMatchObject({ n: 6, base: 10 });
    expect(s.noShowByReminder.find((g) => g.key === "no_answer")!.noShow).toMatchObject({ n: 2, base: 4 });
    expect(s.noShowByReminder.find((g) => g.key === "none")!.noShow).toMatchObject({ n: 1, base: 1 });
  });

  it("por serviço e local: destaque só com base ≥ 20 e 1,5 vez a taxa da clínica", () => {
    const { rows, total } = byServiceAndLocation([
      att({ serviceId: "a", serviceName: "Consulta", scheduled: 200, completed: 180, noShow: 10 }),
      att({ serviceId: "b", serviceName: "Ultrassom", scheduled: 70, completed: 50, noShow: 15 }),
      att({ serviceId: "c", serviceName: "Exame", scheduled: 10, completed: 5, noShow: 5 }),
      att({ serviceId: "a", serviceName: "Consulta", day: "2026-10-02", scheduled: 10, canceled: 4, completed: 10 }),
    ]);
    expect(rows.map((r) => [r.serviceName, r.total, r.registered, r.noShow, r.hot])).toEqual([
      ["Consulta", 210, 200, 10, false],
      ["Ultrassom", 70, 65, 15, true],
      ["Exame", 10, 10, 5, false],
    ]);
    expect(total).toMatchObject({ total: 290, registered: 275, noShow: 30 });
  });
});
