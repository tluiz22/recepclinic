import { describe, expect, it } from "vitest";
import {
  backFromProfessional,
  changeProfessionalHref,
  chosenModality,
  initialsOf,
  isPortalHost,
  matchesName,
  matchesSpecialty,
  modalityOptions,
  nextSlotLabel,
  ofName,
  portalBase,
  portalHref,
  portalPublicUrl,
  portalRewrite,
  portalSteps,
  priceLine,
  priceTags,
  privateLabel,
  professionalSteps,
  readFlow,
  shortName,
  stepPosition,
  suggestPortalSlug,
  withName,
} from "./portal";

const TZ = "America/Fortaleza";
/** O valor usa o espaço que não quebra a linha entre "R$" e o número. */
const nb = (text: string) => text.replace(/R\$ /g, "R$\u00a0");
const NOW = new Date("2026-11-09T12:00:00-03:00"); // segunda

describe("endereço do portal", () => {
  it("reconhece agendar. e agendar-teste.", () => {
    expect(isPortalHost("agendar.recepclinic.com.br")).toBe(true);
    expect(isPortalHost("agendar-teste.recepclinic.com.br")).toBe(true);
    expect(isPortalHost("app.recepclinic.com.br")).toBe(false);
    expect(isPortalHost("localhost")).toBe(false);
  });

  it("leva tudo ao /portal, menos os arquivos do site", () => {
    expect(portalRewrite("/vila-serena")).toBe("/portal/vila-serena");
    expect(portalRewrite("/vila-serena/especialidade/")).toBe("/portal/vila-serena/especialidade");
    expect(portalRewrite("/")).toBe("/portal");
    expect(portalRewrite("/admin/login")).toBe("/portal/admin/login");
    expect(portalRewrite("/_astro/app.js")).toBeNull();
    expect(portalRewrite("/favicon.ico")).toBeNull();
    expect(portalRewrite("/portal/vila-serena")).toBeNull();
  });

  it("monta os links da clínica conforme o endereço", () => {
    expect(portalBase("vila-serena", "agendar.recepclinic.com.br")).toBe("/vila-serena");
    expect(portalBase("vila-serena", "teste.recepclinic.com.br")).toBe("/portal/vila-serena");
    expect(portalHref("/x/medicos", { esp: "a", conv: null, de: "" })).toBe("/x/medicos?esp=a");
    expect(portalHref("/x")).toBe("/x");
  });

  it("dá o link público certo para cada painel", () => {
    expect(portalPublicUrl(new URL("https://teste.recepclinic.com.br/admin"), "vs")).toBe("https://agendar-teste.recepclinic.com.br/vs");
    expect(portalPublicUrl(new URL("https://app.recepclinic.com.br/admin"), "vs")).toBe("https://agendar.recepclinic.com.br/vs");
    expect(portalPublicUrl(new URL("http://localhost:4321/admin"), "vs")).toBe("http://localhost:4321/portal/vs");
  });

  it("sugere o apelido pelo nome da clínica", () => {
    expect(suggestPortalSlug("Clínica Vila Serena")).toBe("clinica-vila-serena");
    expect(suggestPortalSlug("  São José & Filhos!  ")).toBe("sao-jose-filhos");
  });
});

describe("busca", () => {
  const cardio = { name: "Cardiologia", terms: ["coração", "pressão alta"] };
  it("acha pelo nome e pelos termos, sem acento e sem maiúsculas", () => {
    expect(matchesSpecialty(cardio, "CARDIO")).toBe(true);
    expect(matchesSpecialty(cardio, "coracao")).toBe(true);
    expect(matchesSpecialty(cardio, "Pressão")).toBe(true);
    expect(matchesSpecialty(cardio, "pele")).toBe(false);
    expect(matchesSpecialty(cardio, "  ")).toBe(true);
  });
  it("acha o médico palavra por palavra", () => {
    expect(matchesName("Dra. Ana Lima", "ana lima")).toBe(true);
    expect(matchesName("Dra. Ana Lima", "lima ana")).toBe(true);
    expect(matchesName("Dra. Ana Lima", "bruno")).toBe(false);
  });
});

describe("passos", () => {
  it("conta só os passos que o paciente faz", () => {
    expect(portalSteps({ specialty: true, professional: true, modality: true })).toHaveLength(7);
    const link = portalSteps({ specialty: false, professional: false, modality: true });
    expect(stepPosition(link, "modality")).toEqual({ current: 1, total: 5 });
    expect(stepPosition(portalSteps({ specialty: false, professional: false, modality: false }), "time")).toEqual({ current: 1, total: 4 });
  });
  it("pelo médico, conta a especialidade e a lista se o paciente passou por elas", () => {
    expect(stepPosition(professionalSteps(readFlow(new URLSearchParams("de=medicos&esp=e1")), true), "time")).toEqual({ current: 4, total: 7 });
    expect(stepPosition(professionalSteps(readFlow(new URLSearchParams("de=especialidade&esp=e1")), true), "modality")).toEqual({ current: 2, total: 6 });
    expect(stepPosition(professionalSteps(readFlow(new URLSearchParams("")), false), "time")).toEqual({ current: 1, total: 4 });
  });
});

describe("caminho", () => {
  it("lê só valores válidos do endereço", () => {
    expect(readFlow(new URLSearchParams("de=x&esp=<script>&conv=abc-1"))).toEqual({ from: null, specialty: null, plan: "abc-1", name: null });
  });
  it("Voltar e Trocar levam à tela de onde o paciente veio", () => {
    const fromList = readFlow(new URLSearchParams("de=medicos&esp=e1&conv=p1"));
    expect(backFromProfessional("/c", "ana", fromList, false)).toBe("/c/medicos?esp=e1&conv=p1");
    const byName = readFlow(new URLSearchParams("de=medicos&esp=todos&nome=ana"));
    expect(backFromProfessional("/c", "ana", byName, false)).toBe("/c/medicos?esp=todos&nome=ana");
    expect(changeProfessionalHref("/c", fromList)).toBe("/c/medicos?esp=e1&conv=p1");
    const fromSpecialty = readFlow(new URLSearchParams("de=especialidade&esp=e1"));
    expect(backFromProfessional("/c", "ana", fromSpecialty, false)).toBe("/c/especialidade");
    const direct = readFlow(new URLSearchParams(""));
    expect(backFromProfessional("/c", "ana", direct, false)).toBe("/c/ana");
    expect(backFromProfessional("/c", "ana", direct, true)).toBe("/c");
    expect(changeProfessionalHref("/c", direct)).toBeNull();
  });
});

describe("particular ou convênio", () => {
  const plans = [
    { id: "p1", name: "Amil", note: "Traga a carteirinha." },
    { id: "p2", name: "Unimed", note: null },
    { id: "p3", name: "Hapvida", note: null },
  ];
  const pro = { acceptsPrivate: true, privatePriceCents: 35000, privatePriceVaries: false, plans };

  it("lista o particular com o valor e cada convênio com a observação", () => {
    expect(modalityOptions(pro)).toEqual([
      { value: "particular", label: nb("Particular, R$ 350"), detail: null },
      { value: "p1", label: "Amil", detail: "Traga a carteirinha." },
      { value: "p2", label: "Unimed", detail: null },
      { value: "p3", label: "Hapvida", detail: null },
    ]);
    expect(modalityOptions({ ...pro, acceptsPrivate: false }).map((o) => o.value)).toEqual(["p1", "p2", "p3"]);
  });
  it("recusa a escolha que não vale mais", () => {
    const options = modalityOptions({ ...pro, plans: plans.slice(0, 1) });
    expect(chosenModality(options, "p2")).toBeNull();
    expect(chosenModality(options, "p1")?.label).toBe("Amil");
  });
  it("mostra o valor como a clínica cadastrou", () => {
    expect(privateLabel({ ...pro, privatePriceCents: 30050 })).toBe(nb("Particular, R$ 300,50"));
    expect(privateLabel({ ...pro, privatePriceVaries: true })).toBe(nb("Particular, a partir de R$ 350"));
    expect(privateLabel({ ...pro, privatePriceCents: null })).toBe("Particular");
  });
  it("resume nos selos e na lista compacta", () => {
    expect(priceTags(pro).map((t) => t.label)).toEqual([nb("Particular R$ 350"), "Amil", "Unimed", "+1"]);
    expect(priceTags({ ...pro, acceptsPrivate: false, plans: [] }).map((t) => t.label)).toEqual(["Não atende particular"]);
    expect(priceLine(pro)).toBe(nb("Particular R$ 350, Amil, Unimed +1"));
    expect(priceLine({ ...pro, acceptsPrivate: false, plans: plans.slice(1) })).toBe("Só convênios: Unimed, Hapvida");
  });
});

describe("textos", () => {
  it("próximo horário em linguagem de paciente", () => {
    expect(nextSlotLabel(new Date("2026-11-09T15:30:00-03:00"), TZ, NOW)).toBe("Hoje, 15:30");
    expect(nextSlotLabel(new Date("2026-11-10T14:00:00-03:00"), TZ, NOW)).toBe("Amanhã, 14:00");
    expect(nextSlotLabel(new Date("2026-11-12T09:30:00-03:00"), TZ, NOW)).toBe("Qui, 12/11, 09:30");
    expect(nextSlotLabel(new Date("2026-11-12T09:30:00-03:00"), TZ, NOW, true)).toBe("Qui 12/11 09:30");
  });
  it("nomes curtos, iniciais e artigos", () => {
    expect(initialsOf("Dra. Ana Lima")).toBe("AL");
    expect(initialsOf("Bruno")).toBe("BR");
    expect(shortName("Dra. Ana Lima")).toBe("Dra. Ana");
    expect(shortName("Ana Lima")).toBe("Ana");
    expect(withName("Dra. Ana Lima")).toBe("com a Dra. Ana");
    expect(withName("Dr. Bruno Tavares")).toBe("com o Dr. Bruno");
    expect(withName("Ana Lima")).toBe("com Ana");
    expect(ofName("Dra. Ana Lima")).toBe("da Dra. Ana Lima");
    expect(ofName("Ana Lima")).toBe("de Ana Lima");
  });
});
