import { describe, expect, it } from "vitest";
import { DataError, fromDbError } from "../errors";
import { validateAgenda } from "./agendas";
import { findWindowConflict, type AvailabilityWindow } from "./availability";
import { validateClinicSettingsPatch } from "./clinic";
import { professionalAcceptsPlan, validateInsurancePlan } from "./insurance";
import { validateLocation } from "./locations";
import { validateNotificationRecipient } from "./notificationRecipients";
import { validateProfessional } from "./professionals";
import { servicePriceAt, validateService, type ServiceInput } from "./services";
import { validateMemberAccess } from "./team";

function fieldsOf(run: () => unknown): Record<string, string> {
  try {
    run();
  } catch (error) {
    if (error instanceof DataError) return error.fields;
    throw error;
  }
  return {};
}

describe("sobreposição de horários na agenda (decisão de 04/out)", () => {
  const window = (overrides: Partial<AvailabilityWindow>): AvailabilityWindow => ({
    id: crypto.randomUUID(),
    agendaId: "agenda",
    locationId: "local-1",
    serviceId: null,
    weekday: 1,
    startTime: "08:00",
    endTime: "12:00",
    capacity: null,
    isActive: true,
    ...overrides,
  });
  const candidate = (overrides: Partial<AvailabilityWindow>) => ({
    weekday: 1,
    startTime: "10:00",
    endTime: "14:00",
    serviceId: null as string | null,
    capacity: null as number | null,
    ...overrides,
  });

  it("horário geral cruzando outro geral conflita, mesmo em outro local", () => {
    const existing = window({ locationId: "local-2" });
    expect(findWindowConflict(candidate({}), [existing])).toEqual({ kind: "general", window: existing });
  });

  it("geral cruzando um de serviço também conflita (nos dois sentidos)", () => {
    expect(findWindowConflict(candidate({}), [window({ serviceId: "exame-a" })])?.kind).toBe("general");
    expect(findWindowConflict(candidate({ serviceId: "exame-a" }), [window({})])?.kind).toBe("general");
  });

  it("o mesmo serviço não cruza consigo mesmo", () => {
    expect(findWindowConflict(candidate({ serviceId: "exame-a" }), [window({ serviceId: "exame-a" })])?.kind).toBe(
      "same_service",
    );
  });

  it("serviços individuais diferentes podem dividir horário", () => {
    expect(findWindowConflict(candidate({ serviceId: "exame-a" }), [window({ serviceId: "exame-b" })])).toBeNull();
  });

  it("turma não cruza com nenhum outro serviço", () => {
    expect(findWindowConflict(candidate({ serviceId: "turma", capacity: 6 }), [window({ serviceId: "exame-b" })])?.kind).toBe(
      "group",
    );
    expect(findWindowConflict(candidate({ serviceId: "exame-b" }), [window({ serviceId: "turma", capacity: 6 })])?.kind).toBe(
      "group",
    );
  });

  it("encostar não é cruzar; outro dia não conta; inativo não conta", () => {
    expect(findWindowConflict(candidate({ startTime: "12:00", endTime: "13:00" }), [window({})])).toBeNull();
    expect(findWindowConflict(candidate({ startTime: "07:00", endTime: "08:00" }), [window({})])).toBeNull();
    expect(findWindowConflict(candidate({ weekday: 2 }), [window({})])).toBeNull();
    expect(findWindowConflict(candidate({}), [window({ isActive: false })])).toBeNull();
  });

  it("ao reativar, a própria janela não conta como conflito", () => {
    const self = window({});
    expect(findWindowConflict({ ...self }, [self])).toBeNull();
  });

  it("devolve o primeiro conflito da lista", () => {
    const first = window({ startTime: "09:00", endTime: "11:00" });
    expect(findWindowConflict(candidate({}), [first, window({})])?.window).toBe(first);
  });
});

describe("serviços", () => {
  const base: ServiceInput = {
    name: " Consulta ",
    category: "consultation",
    durationMinutes: 30,
    priceCents: 30000,
    returnDeadlineDays: null,
    preparationInstructions: null,
    schedulingMode: "individual",
  };

  it("normaliza nome e preparo", () => {
    expect(validateService(base).name).toBe("Consulta");
    const exam = validateService({ ...base, category: "exam", preparationInstructions: "  Jejum\r\n\r\nde 8h  " });
    expect(exam.preparation_instructions).toBe("Jejum\n\nde 8h");
    expect(validateService({ ...base, category: "exam", preparationInstructions: "   " }).preparation_instructions).toBeNull();
  });

  it("prazo só para Retorno, preparo e turma só para Exame", () => {
    expect(fieldsOf(() => validateService({ ...base, returnDeadlineDays: 30 }))).toHaveProperty("returnDeadlineDays");
    expect(validateService({ ...base, category: "return_visit", returnDeadlineDays: 30 }).return_deadline_days).toBe(30);
    expect(fieldsOf(() => validateService({ ...base, preparationInstructions: "Jejum" }))).toHaveProperty(
      "preparationInstructions",
    );
    expect(fieldsOf(() => validateService({ ...base, schedulingMode: "group" }))).toHaveProperty("schedulingMode");
    expect(validateService({ ...base, category: "exam", schedulingMode: "group" }).scheduling_mode).toBe("group");
  });

  it("preparo até 3800 caracteres (limite do piloto)", () => {
    const exam = { ...base, category: "exam" as const };
    expect(() => validateService({ ...exam, preparationInstructions: "a".repeat(3800) })).not.toThrow();
    expect(fieldsOf(() => validateService({ ...exam, preparationInstructions: "a".repeat(3801) }))).toHaveProperty(
      "preparationInstructions",
    );
  });

  it("duração e valor inteiros; lista todos os problemas de uma vez", () => {
    expect(fieldsOf(() => validateService({ ...base, name: "", durationMinutes: 0, priceCents: -1 }))).toEqual({
      name: "Informe o nome do serviço",
      durationMinutes: "Duração em minutos inteiros, maior que 0",
      priceCents: "Valor inválido",
    });
    expect(fieldsOf(() => validateService({ ...base, durationMinutes: 30.5 }))).toHaveProperty("durationMinutes");
  });

  it("preço no local: o próprio do local, senão o do serviço; fora da lista, não oferecido", () => {
    const service = {
      priceCents: 30000,
      locations: [
        { locationId: "consultorio", priceCents: null },
        { locationId: "domiciliar", priceCents: 45000 },
      ],
    };
    expect(servicePriceAt(service, "consultorio")).toBe(30000);
    expect(servicePriceAt(service, "domiciliar")).toBe(45000);
    expect(servicePriceAt(service, "outro")).toBeNull();
  });
});

describe("configuração da clínica", () => {
  it("normaliza textos e cor; só valida o que veio", () => {
    expect(validateClinicSettingsPatch({ botNotes: "  ", brandColor: "#0f766e", name: " Clínica " })).toEqual({
      botNotes: null,
      brandColor: "#0F766E",
      name: "Clínica",
    });
    expect(validateClinicSettingsPatch({})).toEqual({});
  });

  it("recusa fuso, hora, idade e cor inválidos", () => {
    expect(
      fieldsOf(() =>
        validateClinicSettingsPatch({ timezone: "Fortaleza", reminderHour: 24, consultationAgeLimitYears: 0, brandColor: "verde", name: "" }),
      ),
    ).toEqual({
      name: "Informe o nome da clínica",
      timezone: "Fuso horário inválido",
      consultationAgeLimitYears: "Idade limite em anos inteiros, maior que 0",
      reminderHour: "Horário do lembrete das 6h às 20h",
      brandColor: "Cor no formato #RRGGBB",
    });
  });

  it("idade limite pode ser desligada (null)", () => {
    expect(validateClinicSettingsPatch({ consultationAgeLimitYears: null })).toEqual({ consultationAgeLimitYears: null });
  });

  it("nas mensagens, só \"da\" ou \"do\" antes do nome (F6.2)", () => {
    expect(validateClinicSettingsPatch({ messageArticle: "do" })).toEqual({ messageArticle: "do" });
    expect(fieldsOf(() => validateClinicSettingsPatch({ messageArticle: "a" as never }))).toEqual({ messageArticle: 'Escolha "da" ou "do"' });
  });
});

describe("cadastros simples", () => {
  it("profissional: obrigatórios e UF em maiúsculas", () => {
    const row = validateProfessional({
      userId: null,
      displayName: " Dra. Helena ",
      profession: "Médica",
      specialty: " ",
      council: "crm",
      councilNumber: "1234",
      councilState: "ce",
    });
    expect(row).toMatchObject({ display_name: "Dra. Helena", specialty: null, council: "CRM", council_state: "CE" });
    expect(
      fieldsOf(() =>
        validateProfessional({ userId: null, displayName: "", profession: "", specialty: null, council: null, councilNumber: null, councilState: "Ceará" }),
      ),
    ).toEqual({ displayName: "Informe o nome", profession: "Informe a profissão", councilState: "UF com 2 letras" });
  });

  it("local: endereço opcional (como no piloto)", () => {
    expect(validateLocation({ name: "Domiciliar", type: "home_visit", address: " " })).toEqual({
      name: "Domiciliar",
      type: "home_visit",
      address: null,
    });
    expect(validateLocation({ name: "Consultório", type: "clinic", address: null }).address).toBeNull();
  });

  it("agenda de profissional precisa do profissional; de recurso, não guarda profissional", () => {
    expect(fieldsOf(() => validateAgenda({ name: "Agenda", kind: "professional", professionalId: null, bufferMinutes: 0 }))).toHaveProperty(
      "professionalId",
    );
    expect(validateAgenda({ name: "Exames", kind: "resource", professionalId: "p1", bufferMinutes: 10 }).professional_id).toBeNull();
    expect(fieldsOf(() => validateAgenda({ name: "Exames", kind: "resource", professionalId: null, bufferMinutes: -5 }))).toHaveProperty(
      "bufferMinutes",
    );
  });

  it("contato do resumo: telefone normalizado em E.164", () => {
    expect(
      validateNotificationRecipient({ label: "Recepção", phone: "(85) 99999-0000", receivesConsultations: true, receivesExams: false }),
    ).toEqual({ label: "Recepção", phone: "+5585999990000", receives_consultations: true, receives_exams: false });
    expect(
      fieldsOf(() => validateNotificationRecipient({ label: "", phone: "123", receivesConsultations: false, receivesExams: false })),
    ).toEqual({ label: "Informe o nome do contato", phone: "Telefone inválido" });
  });

  it("plano: nomes alternativos sem repetição e sem o próprio nome", () => {
    expect(
      validateInsurancePlan({ name: "Unimed", alternativeNames: [" unimed ", "Uni med", "UNI MED", "", "Unimed Fortaleza"], ansCode: " " }),
    ).toEqual({ name: "Unimed", alternative_names: ["Uni med", "Unimed Fortaleza"], ans_code: null });
  });

  it("profissional atende plano ativo fora das exceções", () => {
    expect(professionalAcceptsPlan({ id: "a", isActive: true }, [])).toBe(true);
    expect(professionalAcceptsPlan({ id: "a", isActive: true }, ["a"])).toBe(false);
    expect(professionalAcceptsPlan({ id: "a", isActive: false }, [])).toBe(false);
  });
});

describe("erros do banco", () => {
  it("traduz os códigos do Postgres", () => {
    expect(fromDbError({ code: "23505" }, "Plano").code).toBe("duplicate");
    expect(fromDbError({ code: "23503", message: 'update or delete on table "services" violates foreign key' }, "X").code).toBe("in_use");
    expect(fromDbError({ code: "23503", message: 'insert or update on table "agendas" violates foreign key' }, "X").code).toBe("invalid");
    expect(fromDbError({ code: "23514" }, "X").code).toBe("invalid");
    expect(fromDbError({ code: "23P01" }, "X").code).toBe("conflict");
    expect(fromDbError({ code: "42501" }, "X").code).toBe("forbidden");
    expect(fromDbError({ code: "PGRST116" }, "X").code).toBe("not_found");
    expect(fromDbError({ code: "XX000", message: "boom" }, "X")).toMatchObject({ code: "unexpected", message: "X: boom" });
  });
});

describe("equipe (F4.4b)", () => {
  const base = { roles: ["reception"] as ("admin" | "professional" | "reception")[], professionalId: null, agendaScope: "all" as const, grantedAgendaIds: [] };

  it("Profissional precisa do cadastro de profissional (cliente, 05/out)", () => {
    expect(fieldsOf(() => validateMemberAccess({ ...base, roles: ["professional"] }))).toEqual({
      professionalId: "Escolha o cadastro de profissional desta pessoa",
    });
    expect(validateMemberAccess({ ...base, roles: ["professional", "admin"], professionalId: "p1" })).toMatchObject({
      roles: ["admin", "professional"],
      professionalId: "p1",
    });
  });

  it("sem o papel Profissional, solta o cadastro; acesso a todas, sem agendas avulsas", () => {
    expect(validateMemberAccess({ ...base, professionalId: "p1", grantedAgendaIds: ["a1"], displayName: "  Maria  " })).toEqual({
      displayName: "Maria",
      roles: ["reception"],
      professionalId: null,
      agendaScope: "all",
      grantedAgendaIds: [],
    });
    expect(validateMemberAccess({ ...base, agendaScope: "restricted", grantedAgendaIds: ["a1", "a1"] }).grantedAgendaIds).toEqual(["a1"]);
  });

  it("recusa sem papel, papel desconhecido e acesso inválido", () => {
    expect(fieldsOf(() => validateMemberAccess({ ...base, roles: ["dono" as never], agendaScope: "nenhum" as never }))).toEqual({
      roles: "Escolha ao menos um papel",
      agendaScope: "Escolha o acesso às agendas",
    });
  });
});
