import { describe, expect, it } from "vitest";
import type { ImportAppointment, ImportCatalog, ImportPatient } from "./agendaImport";
import { buildLoadPlan, reviewImport, type ReviewContext } from "./agendaImportReview";
import { toInstant } from "./clinicTime";

const TZ = "America/Fortaleza";
// Terça, 20/10/2026, 8h; 21/10 é quarta (weekday 3).
const now = toInstant("2026-10-20", "08:00", TZ);

const catalog: ImportCatalog = {
  services: [
    { id: "s-cons", name: "Consulta", durationMinutes: 30, group: false, category: "consultation" },
    { id: "s-ret", name: "Retorno", durationMinutes: 20, group: false, category: "return_visit" },
  ],
  agendas: [{ id: "ag-ana", name: "Dra. Ana" }],
  serviceAgendas: [
    { serviceId: "s-cons", agendaId: "ag-ana" },
    { serviceId: "s-ret", agendaId: "ag-ana" },
  ],
  locations: [{ id: "loc-centro", name: "Centro", homeVisit: false }],
  insurancePlans: [{ id: "plan-unimed", name: "Unimed" }],
};

const context = (over: Partial<ReviewContext> = {}): ReviewContext => ({
  timeZone: TZ,
  today: "2026-10-20",
  now,
  busy: [],
  windows: [
    { agendaId: "ag-ana", locationId: "loc-centro", serviceId: null, weekday: 2, startTime: "08:00", endTime: "12:00" },
    { agendaId: "ag-ana", locationId: "loc-centro", serviceId: null, weekday: 3, startTime: "08:00", endTime: "12:00" },
  ],
  serviceLocations: [
    { serviceId: "s-cons", locationId: "loc-centro" },
    { serviceId: "s-ret", locationId: "loc-centro" },
  ],
  blocks: [],
  holidays: new Set(),
  contacts: [],
  consultationAgeLimit: null,
  ...over,
});

const appt = (over: Partial<ImportAppointment> = {}): ImportAppointment => ({
  key: "a1",
  date: "2026-10-21",
  time: "09:00",
  serviceId: "s-cons",
  agendaId: "ag-ana",
  locationId: "",
  homeAddress: "",
  ...over,
});

const patient = (over: Partial<ImportPatient> = {}): ImportPatient => ({
  key: "p1",
  name: "Maria Souza",
  birthdate: "1980-05-10",
  phone: "(84) 98188-0777",
  guardianName: "",
  insurancePlanId: "",
  cardNumber: "",
  appointments: [appt()],
  ...over,
});

const warningsOf = (review: ReturnType<typeof reviewImport>) => review.patients[0].appointments[0].warnings;

describe("conferência da agenda atual", () => {
  it("paciente novo com consulta dentro da grade: sem erro nem aviso", () => {
    const review = reviewImport([patient()], catalog, context());
    expect(review).toMatchObject({ errorCount: 0, warningCount: 0, totals: { newPatients: 1, existingPatients: 0, appointmentsIn: 1, appointmentsSkipped: 0 } });
    expect(review.patients[0]).toMatchObject({ kind: "new", phoneE164: "+5584981880777", appointments: [{ serviceName: "Consulta", agendaName: "Dra. Ana", locationName: "Centro" }] });
  });

  it("fora da grade: fora da janela, dia sem agenda, feriado e bloqueio; 10h10 dentro da janela não avisa", () => {
    expect(warningsOf(reviewImport([patient({ appointments: [appt({ time: "11:45" })] })], catalog, context()))).toEqual([
      "Fora da grade: fora dos Horários dessa agenda e local.",
    ]);
    expect(warningsOf(reviewImport([patient({ appointments: [appt({ date: "2026-10-23" })] })], catalog, context()))[0]).toMatch(/fora dos Horários/);
    expect(warningsOf(reviewImport([patient()], catalog, context({ holidays: new Set(["2026-10-21"]) })))).toEqual(["Fora da grade: feriado."]);
    expect(warningsOf(reviewImport([patient({ appointments: [appt({ date: "2026-11-02" })] })], catalog, context()))).toEqual(["Fora da grade: feriado."]);
    const blocks = [{ agendaId: "ag-ana", start: toInstant("2026-10-21", "09:15", TZ), end: toInstant("2026-10-21", "10:00", TZ) }];
    expect(warningsOf(reviewImport([patient()], catalog, context({ blocks })))).toEqual(["Fora da grade: horário bloqueado na agenda."]);
    expect(warningsOf(reviewImport([patient({ appointments: [appt({ time: "10:10" })] })], catalog, context()))).toEqual([]);
    expect(warningsOf(reviewImport([patient()], catalog, context({ serviceLocations: [] })))).toEqual(["Fora da grade: o serviço não é oferecido nesse local."]);
  });

  it("retorno e idade-limite da consulta", () => {
    expect(warningsOf(reviewImport([patient({ appointments: [appt({ serviceId: "s-ret" })] })], catalog, context()))).toEqual([
      "Retorno: entra sem a Consulta de origem e sem conferir o prazo.",
    ]);
    expect(warningsOf(reviewImport([patient()], catalog, context({ consultationAgeLimit: 14 })))).toEqual([
      "Paciente com 14 anos ou mais: acima da idade-limite da Consulta.",
    ]);
  });

  it("consulta que já passou fica de fora, sem erro", () => {
    const review = reviewImport([patient({ appointments: [appt({ date: "2026-10-20", time: "07:30" })] })], catalog, context());
    expect(review.errorCount).toBe(0);
    expect(review.totals).toMatchObject({ appointmentsIn: 0, appointmentsSkipped: 1 });
    expect(review.patients[0].appointments[0]).toMatchObject({ skipped: true, warnings: ["Já passou: fica de fora da carga."] });
  });

  it("erros conferidos de novo: horário que ficou ocupado depois do envio", () => {
    const busy = [{ agendaId: "ag-ana", start: toInstant("2026-10-21", "09:00", TZ), end: toInstant("2026-10-21", "09:30", TZ) }];
    const review = reviewImport([patient()], catalog, context({ busy }));
    expect(review.errorCount).toBe(1);
    expect(review.patients[0].appointments[0].errors).toEqual(["Esse horário já está ocupado nessa agenda."]);
    // Com erro, os avisos da consulta não são calculados.
    expect(review.patients[0].appointments[0].warnings).toEqual([]);
  });

  it("já cadastrado: mesmo WhatsApp e mesmo paciente; o cadastro fica e a diferença vira aviso", () => {
    const contacts = [
      {
        id: "c1",
        phone: "+5584981880777",
        name: "Maria de Souza",
        isActive: true,
        patients: [{ id: "pt1", name: "maria souza", birthdate: "1980-05-10", isActive: true, insurancePlanId: null, cardNumber: null }],
      },
    ];
    const review = reviewImport([patient({ insurancePlanId: "plan-unimed", cardNumber: "123" })], catalog, context({ contacts }));
    expect(review.patients[0]).toMatchObject({ kind: "existing_patient", contactId: "c1", patientId: "pt1" });
    expect(review.patients[0].warnings).toEqual([
      "WhatsApp já cadastrado em nome de Maria de Souza (no link: Maria Souza). Fica o cadastro.",
      "Convênio no cadastro: Particular; no link: Unimed, carteirinha 123. Fica o cadastro.",
    ]);
    expect(review.totals).toMatchObject({ newPatients: 0, existingPatients: 1 });
  });

  it("contato já cadastrado com outro paciente: o novo entra no mesmo contato", () => {
    const contacts = [{ id: "c1", phone: "+5584981880777", name: "Ana Souza", isActive: false, patients: [] }];
    const review = reviewImport([patient({ name: "Pedro Souza", birthdate: "2018-01-01", guardianName: "Ana Souza" })], catalog, context({ contacts }));
    expect(review.patients[0]).toMatchObject({ kind: "existing_contact", contactId: "c1", patientId: null, warnings: ["O contato já cadastrado está inativo: volta a ficar ativo com a carga."] });
  });

  it("plano da carga: o já cadastrado pelo id, o próprio contato e só as consultas que entram", () => {
    const contacts = [{ id: "c1", phone: "+5584981880777", name: "Maria Souza", isActive: true, patients: [] }];
    const patients = [
      patient({ appointments: [appt(), appt({ key: "a2", date: "2026-10-20", time: "07:00" })], insurancePlanId: "plan-unimed", cardNumber: "9" }),
      patient({ key: "p2", name: "Pedro", birthdate: "2018-01-01", guardianName: "Maria Souza", appointments: [] }),
      patient({ key: "p3", name: "Lia", phone: "(84) 98111-2233", appointments: [] }),
    ];
    const ctx = context({ contacts });
    const plan = buildLoadPlan(reviewImport(patients, catalog, ctx), patients, catalog, ctx);
    expect(plan[0]).toEqual({
      contactId: "c1",
      phone: "+5584981880777",
      contactName: "Maria Souza",
      patientId: null,
      name: "Maria Souza",
      birthdate: "1980-05-10",
      isContactSelf: true,
      insurancePlanId: "plan-unimed",
      cardNumber: "9",
      appointments: [
        { serviceId: "s-cons", agendaId: "ag-ana", locationId: "loc-centro", scheduledAt: toInstant("2026-10-21", "09:00", TZ).toISOString(), durationMinutes: 30, homeAddress: null },
      ],
    });
    expect(plan[1]).toMatchObject({ contactId: "c1", isContactSelf: false, contactName: "Maria Souza" });
    expect(plan[2]).toMatchObject({ contactId: null, isContactSelf: true, contactName: "Lia", insurancePlanId: null });
  });

  it("plano da carga não sai com erro", () => {
    const patients = [patient({ phone: "" })];
    expect(() => buildLoadPlan(reviewImport(patients, catalog, context()), patients, catalog, context())).toThrow();
  });
});
