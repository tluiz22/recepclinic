import { describe, expect, it } from "vitest";
import {
  appointmentField,
  normalizeImportEntries,
  parseImportForm,
  patientField,
  validateImport,
  type ImportAppointment,
  type ImportCatalog,
  type ImportPatient,
} from "./agendaImport";
import { toInstant } from "./clinicTime";

const TZ = "America/Fortaleza";
const today = "2026-10-20";
const now = toInstant(today, "08:00", TZ);

const catalog: ImportCatalog = {
  services: [
    { id: "s-cons", name: "Consulta", durationMinutes: 30, group: false },
    { id: "s-exam", name: "Espirometria", durationMinutes: 20, group: true },
  ],
  agendas: [
    { id: "ag-ana", name: "Dra. Ana" },
    { id: "ag-exames", name: "Exames" },
  ],
  serviceAgendas: [
    { serviceId: "s-cons", agendaId: "ag-ana" },
    { serviceId: "s-exam", agendaId: "ag-exames" },
  ],
  locations: [
    { id: "loc-centro", name: "Centro", homeVisit: false },
    { id: "loc-casa", name: "Domiciliar", homeVisit: true },
  ],
  insurancePlans: [{ id: "plan-unimed", name: "Unimed" }],
};

const appt = (over: Partial<ImportAppointment> = {}): ImportAppointment => ({
  key: "a1",
  date: "2026-10-21",
  time: "09:00",
  serviceId: "s-cons",
  agendaId: "ag-ana",
  locationId: "loc-centro",
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
  appointments: [],
  ...over,
});

const check = (patients: ImportPatient[], busy = [] as Parameters<typeof validateImport>[2]["busy"], cat = catalog) =>
  validateImport(patients, cat, { timeZone: TZ, today, now, busy });

describe("importação da agenda: leitura do link", () => {
  it("lê pacientes e consultas na ordem da tela e tira o que está em branco", () => {
    const form = new FormData();
    form.append("p.k1.name", "  Maria   Souza ");
    form.append("p.k1.birthdate", "1980-05-10");
    form.append("p.k1.phone", "84981880777");
    form.append("p.k1.a.x1.date", "2026-10-21");
    form.append("p.k1.a.x1.time", "09:00");
    form.append("p.k1.a.x1.serviceId", "s-cons");
    form.append("p.k1.a.x2.date", "");
    form.append("p.k1.a.x2.serviceId", "");
    form.append("p.k2.name", "");
    form.append("p.k2.phone", "");
    form.append("p.k3.name", "João");
    form.append("p.BAD.name", "Ignorado");
    form.append("outro", "x");
    const patients = parseImportForm(form);
    expect(patients.map((p) => p.key)).toEqual(["k1", "k3"]);
    expect(patients[0].name).toBe("Maria Souza");
    expect(patients[0].appointments).toEqual([
      { key: "x1", date: "2026-10-21", time: "09:00", serviceId: "s-cons", agendaId: "", locationId: "", homeAddress: "" },
    ]);
  });

  it("aceita a chave dos cartões criados na tela (letra + 8 caracteres)", () => {
    const form = new FormData();
    form.append("p.pk3j9x0q2.name", "Ana");
    form.append("p.pk3j9x0q2.a.ab81kd02m.date", "2026-10-21");
    expect(parseImportForm(form)).toMatchObject([{ key: "pk3j9x0q2", appointments: [{ key: "ab81kd02m" }] }]);
  });

  it("o rascunho do banco é lido sem confiar no formato", () => {
    expect(normalizeImportEntries(null)).toEqual([]);
    expect(normalizeImportEntries([{ key: "k1", name: 3, appointments: [{ key: "a1", date: "2026-10-21" }, { key: "!!" }] }, { key: "../x" }])).toEqual([
      {
        key: "k1",
        name: "",
        birthdate: "",
        phone: "",
        guardianName: "",
        insurancePlanId: "",
        cardNumber: "",
        appointments: [{ key: "a1", date: "2026-10-21", time: "", serviceId: "", agendaId: "", locationId: "", homeAddress: "" }],
      },
    ]);
  });
});

describe("importação da agenda: conferência", () => {
  it("paciente com consulta certa passa", () => {
    expect(check([patient({ appointments: [appt()] })])).toEqual({});
  });

  it("paciente sem consulta também entra", () => {
    expect(check([patient()])).toEqual({});
  });

  it("nome, nascimento e WhatsApp são obrigatórios", () => {
    const issues = check([patient({ name: "", birthdate: "", phone: "" })]);
    expect(issues[patientField("p1", "name")]).toBe("Informe o nome do paciente.");
    expect(issues[patientField("p1", "birthdate")]).toBe("Informe a data de nascimento.");
    expect(issues[patientField("p1", "phone")]).toBe("Informe o WhatsApp.");
  });

  it("nascimento no futuro e telefone fora da regra", () => {
    const issues = check([patient({ birthdate: "2026-10-21", phone: "84 9818-80" })]);
    expect(issues[patientField("p1", "birthdate")]).toBe("Data de nascimento inválida.");
    expect(issues[patientField("p1", "phone")]).toMatch(/^Telefone inválido/);
  });

  it("menor de 18 anos precisa do responsável", () => {
    const issues = check([patient({ birthdate: "2015-01-01" })]);
    expect(issues[patientField("p1", "guardianName")]).toMatch(/menor de 18 anos/);
    expect(check([patient({ birthdate: "2015-01-01", guardianName: "Ana Souza" })])).toEqual({});
  });

  it("carteirinha sem convênio", () => {
    expect(check([patient({ cardNumber: "123" })])[patientField("p1", "insurancePlanId")]).toBe("Escolha o convênio da carteirinha.");
    expect(check([patient({ insurancePlanId: "plan-unimed", cardNumber: "123" })])).toEqual({});
  });

  it("mesmo WhatsApp: o responsável tem de ser o mesmo", () => {
    const mae = patient({ key: "p1", name: "Ana Souza" });
    const filho = patient({ key: "p2", name: "Pedro Souza", birthdate: "2018-03-01", guardianName: "Ana Souza" });
    expect(check([mae, filho])).toEqual({});
    const outro = patient({ key: "p3", name: "Lia Lima", birthdate: "2019-03-01", guardianName: "Carla Lima" });
    expect(check([mae, outro])[patientField("p3", "guardianName")]).toMatch(/outro responsável/);
  });

  it("dois pacientes sem responsável no mesmo WhatsApp", () => {
    // Mesmo nome de contato mas outra data: é outra pessoa sem responsável.
    const issues = check([patient({ key: "p1" }), patient({ key: "p2", birthdate: "1990-01-01" })]);
    expect(issues[patientField("p2", "guardianName")]).toBe("Esse WhatsApp já é de outro paciente: informe o responsável.");
  });

  it("paciente repetido em dois cartões", () => {
    const issues = check([patient({ key: "p1" }), patient({ key: "p2" })]);
    expect(issues[patientField("p2", "name")]).toMatch(/Paciente repetido/);
  });

  it("consulta: campos obrigatórios e listas", () => {
    const issues = check([patient({ appointments: [appt({ date: "", time: "", serviceId: "", agendaId: "x" })] })]);
    expect(issues[appointmentField("p1", "a1", "date")]).toBe("Informe a data.");
    expect(issues[appointmentField("p1", "a1", "time")]).toBe("Informe a hora.");
    expect(issues[appointmentField("p1", "a1", "serviceId")]).toBe("Escolha o serviço.");
    expect(issues[appointmentField("p1", "a1", "agendaId")]).toBe("Escolha a agenda na lista.");
  });

  it("data inválida e data que já passou", () => {
    expect(check([patient({ appointments: [appt({ date: "2026-02-31" })] })])[appointmentField("p1", "a1", "date")]).toBe("Data inválida.");
    expect(check([patient({ appointments: [appt({ date: today, time: "07:30" })] })])[appointmentField("p1", "a1", "date")]).toMatch(/já passou/);
    expect(check([patient({ appointments: [appt({ date: today, time: "10:00" })] })])).toEqual({});
  });

  it("serviço que não é atendido na agenda", () => {
    const issues = check([patient({ appointments: [appt({ agendaId: "ag-exames" })] })]);
    expect(issues[appointmentField("p1", "a1", "agendaId")]).toBe("Esse serviço não é atendido nessa agenda.");
  });

  it("local: obrigatório com mais de um; com um só, vale ele", () => {
    expect(check([patient({ appointments: [appt({ locationId: "" })] })])[appointmentField("p1", "a1", "locationId")]).toBe("Escolha o local.");
    const single = { ...catalog, locations: [catalog.locations[0]] };
    expect(check([patient({ appointments: [appt({ locationId: "" })] })], [], single)).toEqual({});
  });

  it("domiciliar pede o endereço", () => {
    const issues = check([patient({ appointments: [appt({ locationId: "loc-casa" })] })]);
    expect(issues[appointmentField("p1", "a1", "homeAddress")]).toBe("Informe o endereço da visita.");
    expect(check([patient({ appointments: [appt({ locationId: "loc-casa", homeAddress: "Rua A, 1" })] })])).toEqual({});
  });

  it("horário ocupado na agenda da clínica", () => {
    const busy = [{ agendaId: "ag-ana", start: toInstant("2026-10-21", "08:45", TZ), end: toInstant("2026-10-21", "09:15", TZ) }];
    expect(check([patient({ appointments: [appt()] })], busy)[appointmentField("p1", "a1", "time")]).toBe("Esse horário já está ocupado nessa agenda.");
    // Termina quando a outra começa: não choca.
    expect(check([patient({ appointments: [appt({ time: "08:15" })] })], busy)).toEqual({});
    // Outra agenda: não choca.
    expect(check([patient({ appointments: [appt()] })], [{ ...busy[0], agendaId: "ag-exames" }])).toEqual({});
  });

  it("duas consultas do link na mesma agenda e hora", () => {
    const issues = check([
      patient({ key: "p1", appointments: [appt()] }),
      patient({ key: "p2", name: "João Lima", phone: "(84) 98188-0778", appointments: [appt({ key: "a9", time: "09:15" })] }),
    ]);
    expect(issues[appointmentField("p2", "a9", "time")]).toBe("Choca com outra consulta deste link na mesma agenda.");
  });

  it("turma de exame não trava o horário", () => {
    const exam = (key: string) => appt({ key, serviceId: "s-exam", agendaId: "ag-exames" });
    expect(check([patient({ appointments: [exam("a1"), exam("a2")] })])).toEqual({});
  });
});
