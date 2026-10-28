import { describe, expect, it } from "vitest";
import { changesSchedule, compareSnapshots, snapshotChanges, type AppointmentSnapshot } from "./appointmentChanges";

const before: AppointmentSnapshot = {
  patient: "Ana Souza",
  service: "Consulta pediátrica · 30 min",
  agenda: "Dra. Helena Costa",
  location: "Consultório Centro",
  when: "Sexta-feira, 06/11 às 14:00",
  address: null,
  insurance: "Particular",
  price: "R$ 300,00",
};

describe("alterar atendimento: antes e depois", () => {
  it("todos os dados, com o de antes só no que mudou", () => {
    const after = { ...before, service: "Avaliação inicial · 50 min", price: "R$ 200,00" };
    expect(compareSnapshots(before, after, "Criança")).toEqual([
      { label: "Criança", value: "Ana Souza" },
      { label: "Serviço", value: "Avaliação inicial · 50 min", before: "Consulta pediátrica · 30 min" },
      { label: "Com quem", value: "Dra. Helena Costa" },
      { label: "Local", value: "Consultório Centro" },
      { label: "Quando", value: "Sexta-feira, 06/11 às 14:00" },
      { label: "Convênio", value: "Particular" },
      { label: "Valor", value: "R$ 200,00", before: "R$ 300,00" },
    ]);
    expect(snapshotChanges(before, after)).toEqual([
      { label: "Serviço", from: "Consulta pediátrica · 30 min", to: "Avaliação inicial · 50 min" },
      { label: "Valor", from: "R$ 300,00", to: "R$ 200,00" },
    ]);
  });

  it("endereço que aparece ou some vira traço do outro lado", () => {
    const after = { ...before, location: "Domiciliar", address: "Rua A, 10" };
    expect(snapshotChanges(before, after)).toContainEqual({ label: "Endereço", from: "—", to: "Rua A, 10" });
  });

  it("nada mudou", () => {
    expect(snapshotChanges(before, { ...before })).toEqual([]);
  });

  it("aviso ao paciente só com data, hora, agenda ou local", () => {
    expect(changesSchedule(before, { ...before, service: "Outro" })).toBe(false);
    expect(changesSchedule(before, { ...before, insurance: "Unimed", address: "Rua B" })).toBe(false);
    expect(changesSchedule(before, { ...before, when: "Sábado, 07/11 às 09:00" })).toBe(true);
    expect(changesSchedule(before, { ...before, agenda: "Dr. Rafael" })).toBe(true);
    expect(changesSchedule(before, { ...before, location: "Unidade Sul" })).toBe(true);
  });
});
