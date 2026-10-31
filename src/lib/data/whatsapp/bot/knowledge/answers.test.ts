import { describe, expect, it } from "vitest";
import catalogContent from "../../../../knowledge/__fixtures__/catalogo-inicial.json";
import { compileKnowledge, matchQuestion, type KbContent } from "../../../../knowledge/match";
import { renderTemplate, templateVariables, variablesWithoutSource } from "../../../../knowledge/template";
import type { Professional } from "../../../config/professionals";
import type { BotService } from "../catalog";
import { clinicTermsOf, composeAnswer, weeklyHoursText, type KbClinicData } from "./answers";

// BC 3.2 — respostas montadas só com o cadastro da clínica; sem o dado, não responde.
const kb = compileKnowledge(1, catalogContent as KbContent);

const service = (id: string, name: string, category: BotService["category"], extra: Partial<BotService> = {}): BotService => ({
  id,
  name,
  category,
  isGroup: false,
  agendas: [{ id: `ag-${id}`, name: "Agenda", professionalName: "Dra. Ana Karina", professionalId: "p-ana", specialty: "Pneumologia pediátrica", locationTypes: ["clinic"] }],
  locationPrices: { clinic: 30000 },
  priceCents: 30000,
  returnDeadlineDays: null,
  preparation: null,
  preparationFile: null,
  ...extra,
});

const professional = (id: string, displayName: string, extra: Partial<Professional> = {}): Professional => ({
  id,
  userId: null,
  displayName,
  profession: "Médica",
  specialty: null,
  council: "CRM",
  councilNumber: "12345",
  councilState: "CE",
  rqe: null,
  phone: null,
  receivesDailySummary: false,
  isActive: true,
  ...extra,
});

function clinicA(): KbClinicData {
  return {
    label: "da Clínica A",
    designation: { noun: "clínica", article: "a" },
    receptionAvailable: true,
    profile: "pediatric",
    ageLimitYears: 18,
    paymentInfo: "Pix, cartão e dinheiro.",
    insuranceInfo: null,
    catalog: {
      services: [
        service("s-ped", "Consulta pediátrica", "consultation", { locationPrices: { clinic: 30000, home_visit: 45000 } }),
        service("s-us", "Ultrassonografia", "exam", { preparation: "Jejum de 6 horas.", locationPrices: { clinic: 20000 } }),
        service("s-ret", "Retorno", "return_visit", { returnDeadlineDays: 30, locationPrices: { clinic: 0 }, priceCents: 0 }),
      ],
      locations: [{ id: "l1", name: "Consultório Aldeota", type: "clinic", address: "Rua A, 100" }],
    },
    professionals: [
      professional("p-ana", "Dra. Ana Karina", { specialty: "Pneumologia pediátrica", rqe: "678" }),
      professional("p-joao", "Dr. João Lima", { specialty: "Pediatria" }),
    ],
    insurance: { enabled: true, plans: [{ id: "u", name: "Unimed", alternativeNames: ["Unimed Fortaleza"] }, { id: "b", name: "Bradesco Saúde", alternativeNames: [] }], exclusions: [{ professionalId: "p-joao", planId: "u" }] },
    receptionHours: [null, { open: "08:00", close: "18:00" }, { open: "08:00", close: "18:00" }, { open: "08:00", close: "18:00" }, { open: "08:00", close: "18:00" }, { open: "08:00", close: "17:30" }, { open: "08:00", close: "12:00" }],
    holidayToday: null,
    website: "https://clinica-a.com.br",
    reminder: { timing: "eve", hour: 14 },
  };
}

/** Clínica B: outro cadastro, sem quase nada. */
function clinicB(): KbClinicData {
  return {
    ...clinicA(),
    label: "do Consultório B",
    profile: "adult",
    ageLimitYears: null,
    paymentInfo: null,
    catalog: { services: [service("s-b", "Consulta clínica", "consultation", { agendas: [], locationPrices: { clinic: 15000 }, priceCents: 15000 })], locations: [] },
    professionals: [],
    insurance: { enabled: false, plans: [], exclusions: [] },
    receptionHours: null,
    website: null,
    reminder: null,
  };
}

function answer(text: string, data: KbClinicData = clinicA(), context = {}) {
  const m = matchQuestion(kb, text, clinicTermsOf(data));
  if (m.kind !== "answer") throw new Error(`não reconheceu "${text}" (${m.kind})`);
  return composeAnswer(kb, m.entry, m.terms, text, data, context);
}
const textOf = (a: ReturnType<typeof answer>) => (a && a.kind === "text" ? a.text : a);

describe("modelos", () => {
  it("variáveis, sem fonte e preenchimento", () => {
    expect(templateVariables("Em {endereco} ({link_mapa}) {endereco}")).toEqual(["endereco", "link_mapa"]);
    expect(variablesWithoutSource("Site: {site} {pagamento}", ["website"])).toEqual(["pagamento"]);
    expect(variablesWithoutSource("Site: {site}", ["website"])).toEqual([]);
    expect(renderTemplate("Site: {site}", { site: "x" })).toBe("Site: x");
    expect(renderTemplate("Site: {site}", { site: null })).toBeNull();
  });

  it("todo modelo do catálogo tem fonte para as variáveis", () => {
    for (const entry of (catalogContent as KbContent).entries) {
      if (entry.answerType === "template") expect(variablesWithoutSource(entry.template!, entry.sources), entry.code).toEqual([]);
    }
  });

  it("horário da semana, com os dias iguais juntos", () => {
    expect(weeklyHoursText(clinicA().receptionHours)).toBe("Segunda a quinta: 8h às 18h\nSexta: 8h às 17h30\nSábado: 8h às 12h\nDomingo: fechado");
    expect(weeklyHoursText(null)).toBeNull();
  });
});

describe("respostas com os dados da clínica", () => {
  it("horário, com o aviso do feriado de hoje", () => {
    expect(textOf(answer("qual o horário de funcionamento?"))).toContain("Segunda a quinta: 8h às 18h");
    const holiday = { ...clinicA(), holidayToday: "Finados" };
    expect(textOf(answer("vocês abrem hoje?", holiday))).toContain("Hoje (Finados) não há atendimento.");
  });

  it("endereço com o link do mapa", () => {
    const text = textOf(answer("qual o endereço?")) as string;
    expect(text).toContain("Rua A, 100");
    expect(text).toContain("https://www.google.com/maps/search/?api=1&query=Rua%20A%2C%20100");
  });

  it("valores: todos, o serviço citado, o do profissional e o da marcação em andamento", () => {
    const all = textOf(answer("quanto custa?")) as string;
    expect(all).toContain("*Consulta pediátrica*");
    expect(all).toContain("Formas de pagamento*\nPix, cartão e dinheiro.");
    const one = textOf(answer("quanto custa a ultrassonografia?")) as string;
    expect(one).toContain("*Ultrassonografia*\nR$");
    expect(one).not.toContain("Consulta pediátrica");
    const booking = textOf(answer("quanto é?", clinicA(), { serviceId: "s-ped", locationType: "home_visit" })) as string;
    expect(booking).toContain("*Consulta pediátrica*\nR$ 450,00");
    expect(booking).not.toContain("300");
    expect(textOf(answer("quanto custa o retorno?", clinicA(), { serviceId: "s-ret" }))).toContain("Sem custo");
  });

  it("valor pelo convênio: não responde", () => {
    expect(answer("quanto custa pelo convênio?")).toBeNull();
  });

  it("convênios: aceito, não encontrado, exceção do profissional, lista e texto livre", () => {
    expect(textOf(answer("vocês aceitam unimed?"))).toBe("Sim, atendemos *Unimed*.");
    expect(textOf(answer("aceitam amil?"))).toBe("Não encontrei *Amil* entre os convênios que atendemos: Unimed e Bradesco Saúde.");
    expect(textOf(answer("o dr joão atende unimed?"))).toBe("*Dr. João Lima* não atende *Unimed*. Atende *Unimed* por aqui: *Dra. Ana Karina*.");
    expect(textOf(answer("quais convênios vocês aceitam?"))).toBe("Atendemos os convênios: Unimed e Bradesco Saúde.");
    const textOnly = { ...clinicB(), insuranceInfo: "Atendemos Cassi." };
    expect(textOf(answer("quais convênios vocês aceitam?", textOnly))).toBe("Atendemos Cassi.");
    expect(answer("quais convênios vocês aceitam?", clinicB())).toBeNull();
  });

  it("especialidades: encontrada, lista quando não encontra (nunca \"não temos\")", () => {
    expect(textOf(answer("tem pneumopediatra?"))).toBe("Sim! Atende por aqui:\n• *Dra. Ana Karina*: Pneumologia pediátrica");
    const notFound = textOf(answer("tem cardiologista?")) as string;
    expect(notFound).toBe("Atendemos por aqui:\n• *Dra. Ana Karina*: Pneumologia pediátrica\n• *Dr. João Lima*: Pediatria");
    expect(notFound).not.toMatch(/não temos/i);
  });

  it("profissional citado e registro no conselho só quando perguntado", () => {
    const p2 = answer("a dra karina atende aí?");
    expect(textOf(p2)).toBe("Sim, *Dra. Ana Karina* (Médica, Pneumologia pediátrica) atende por aqui.");
    expect(textOf(p2)).not.toContain("CRM");
    expect(textOf(answer("qual o crm da dra karina?"))).toBe("*Dra. Ana Karina*: CRM 12345 CE | RQE 678");
  });

  it("serviço citado oferece marcar; não citado lista", () => {
    const yes = answer("vocês fazem ultrassonografia?");
    expect(yes).toEqual({ kind: "text", text: "Sim, fazemos *Ultrassonografia*.", offerReception: false, book: { category: "exam", serviceId: "s-us" } });
    expect(textOf(answer("quais serviços vocês oferecem?"))).toContain("*Exames*\n• Ultrassonografia");
  });

  it("retorno, preparo, domiciliar e idade", () => {
    expect(textOf(answer("qual o prazo do retorno?"))).toBe("O retorno pode ser marcado em até 30 dias depois da consulta. O retorno não tem custo.");
    expect(answer("qual o preparo do ultrassom?")).toEqual({ kind: "preparation", serviceIds: ["s-us"] });
    expect(textOf(answer("vocês atendem em casa?"))).toContain("Sim, fazemos atendimento domiciliar:\n• Consulta pediátrica: R$");
    expect(textOf(answer("vocês atendem em casa?", clinicB()))).toBe("No momento não fazemos atendimento domiciliar.");
    expect(textOf(answer("atende bebê?"))).toBe("Atendemos crianças e adolescentes. Consultas para menores de 18 anos; a partir dessa idade, só retorno e exames.");
    expect(answer("atende bebê?", clinicB())).toBeNull();
  });

  it("fluxos: marcar com serviço citado, e sem o serviço na clínica não responde", () => {
    expect(answer("quero marcar uma consulta pediátrica")).toEqual({ kind: "flow", flow: "book_consultation", serviceId: "s-ped" });
    expect(answer("quero remarcar")).toEqual({ kind: "flow", flow: "reschedule" });
    expect(answer("quero marcar um exame", clinicB())).toBeNull();
  });

  it("textos fixos, recepção e lembrete", () => {
    expect(answer("é um robô?")).toEqual({ kind: "text", text: "Sou o atendimento automático da Clínica A. Se quiser falar com a recepção, é só escrever *atendente*.", offerReception: false });
    expect(textOf(answer("é um robô?", { ...clinicA(), receptionAvailable: false }))).toBe("Sou o atendimento automático da Clínica A.");
    expect(answer("qual o telefone?")).toMatchObject({ kind: "text", offerReception: true });
    expect(answer("qual o telefone?", { ...clinicA(), receptionAvailable: false })).toMatchObject({ offerReception: false });
    expect(answer("o resultado do meu exame saiu?")).toMatchObject({ kind: "reception" });
    expect(textOf(answer("vou receber lembrete?"))).toBe("Sim! Enviamos um lembrete por aqui na véspera, por volta das 14h, com os botões para confirmar, remarcar ou cancelar.");
  });
});

describe("sem o dado, não responde", () => {
  it.each(["qual o horário de funcionamento?", "qual o endereço?", "vocês têm site?", "aceita pix?", "vou receber lembrete?", "quem atende aí?", "qual o crm do médico?"])(
    "%s (clínica B)",
    (text) => {
      expect(answer(text, clinicB())).toBeNull();
    },
  );
});

describe("isolamento entre clínicas", () => {
  it("a resposta sai só do cadastro da clínica que pergunta", () => {
    const a = textOf(answer("quanto custa a consulta?")) as string;
    const b = textOf(answer("quanto custa a consulta?", clinicB())) as string;
    expect(a).toContain("Consulta pediátrica");
    expect(a).not.toContain("Consulta clínica");
    expect(b).toContain("Consulta clínica");
    expect(b).not.toContain("Consulta pediátrica");
    expect(b).not.toContain("Pix");
  });

  it("nome de serviço de outra clínica não é reconhecido", () => {
    const m = matchQuestion(kb, "vocês fazem ultrassonografia?", clinicTermsOf(clinicB()));
    expect(m.terms.serviceIds).toEqual([]);
  });
});
