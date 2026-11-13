import { describe, expect, it } from "vitest";
import catalog from "./__fixtures__/catalogo-inicial.json";
import { compileKnowledge, matchQuestion, type ClinicTerms, type KbContent, type KbMatch } from "./match";
import { normalizeText } from "./normalize";

// BC 3.2 — reconhecimento das perguntas com o catálogo inicial aprovado
// (o fixture é o catálogo do banco; tests/db/base-de-conhecimento.test.ts confere).
const kb = compileKnowledge(1, catalog as KbContent);

const clinic: ClinicTerms = {
  services: [
    { id: "s-ped", name: "Consulta pediátrica" },
    { id: "s-us", name: "Ultrassonografia" },
    { id: "s-ret", name: "Retorno" },
  ],
  professionals: [
    { id: "p-ana", name: "Dra. Ana Karina Fernandes" },
    { id: "p-joao", name: "Dr. João Pedro Lima" },
  ],
  plans: [
    { id: "u", names: ["Unimed", "Unimed Fortaleza"] },
    { id: "b", names: ["Bradesco Saúde"] },
  ],
};

const match = (text: string, terms: ClinicTerms = clinic) => matchQuestion(kb, text, terms);
const codeOf = (m: KbMatch) => (m.kind === "answer" ? m.entry.code : m.kind === "ambiguous" ? `?${m.options.map((o) => o.code).join("|")}` : m.kind);

describe("normalização", () => {
  it("sem acento, caixa e pontuação; abreviações por extenso", () => {
    expect(normalizeText("Vcs ATENDEM hj?? Até q horas!")).toBe("voces atendem hoje ate que horas");
    expect(normalizeText("Dra. Ana")).toBe("doutora ana");
    expect(normalizeText("   ")).toBe("");
    // Dias da semana: uma palavra só, sem o "feira".
    expect(normalizeText("Atende na Sexta-feira? e sábados")).toBe("atende na diadasemana e diadasemana");
  });
});

describe("perguntas do catálogo", () => {
  it.each([
    ["Qual o horário de funcionamento?", "F1"],
    ["vcs abrem sabado?", "F1"],
    ["até que horas funciona hj", "F1"],
    ["ATENDEM AOS SÁBADOS", "F1"],
    // C28 (04/nov/2026): dias de atendimento.
    ["Vocês atendem na segunda?", "F1"],
    ["atende terça?", "F1"],
    ["vcs atendem quarta feira", "F1"],
    ["tem atendimento sexta?", "F1"],
    ["quais dias vocês atendem?", "F1"],
    ["que dias tem atendimento", "F1"],
    ["atende todos os dias?", "F1"],
    ["funciona segunda-feira?", "F1"],
    // Homologação no staging (04/nov/2026): "Atende na sexta?" ia para o "não entendi".
    ["Atende na sexta?", "F1"],
    ["atende na quinta?", "F1"],
    ["vocês atendem quinta-feira?", "F1"],
    ["tem atendimento na terça?", "F1"],
    ["abre na sexta?", "F1"],
    ["funciona no sábado?", "F1"],
    ["vcs abrem segunda feira?", "F1"],
    ["onde fica a clinica?", "E1"],
    ["manda a localização por favor", "E1"],
    ["qual o endereço", "E1"],
    ["vocês tem site?", "E2"],
    ["quais serviços vocês oferecem", "S1"],
    ["vocês fazem ultrassonografia?", "S2"],
    ["quais especialidades vocês têm", "S3"],
    ["tem pediatra?", "S4"],
    ["tem médico de pulmão?", "S4"],
    ["quem atende aí?", "P1"],
    ["a dra karina atende ai?", "P2"],
    ["a Dra. Ana Karina atende na quarta?", "P2"],
    ["o dr joão atende na sexta?", "P2"],
    ["qual o crm da doutora?", "P3"],
    ["quanto custa a consulta?", "V1"],
    ["qual o valor?", "V1"],
    ["qto fica com o dr joão?", "V1"],
    ["aceita pix?", "V2"],
    ["pode parcelar no cartão?", "V2"],
    ["vocês aceitam Unimed?", "C1"],
    ["unimed?", "C1"],
    ["quais convênios vocês atendem", "C1"],
    ["quero marcar uma consulta", "M1"],
    // C28: o dia na frase não tira a marcação nem a pergunta do profissional.
    ["quero marcar consulta na terça", "M1"],
    ["quero agendar para quarta", "M1"],
    ["quero marcar para sexta", "M1"],
    ["quero marcar um exame", "X1"],
    ["Encaixe", "EN1"],
    ["Preciso de um encaixe", "EN1"],
    ["Consigo um encaixe?", "EN1"],
    ["dá para adiantar minha consulta?", "EN1"],
    ["quero antecipar o exame", "EN1"],
    ["quero entrar na fila de espera", "EN1"],
    ["o resultado do meu exame já saiu?", "X2"],
    ["quero remarcar", "R1"],
    ["quero cancelar", "K1"],
    ["desmarcar minha consulta", "K1"],
    ["quero marcar o retorno", "T1"],
    ["qual o prazo do retorno?", "T2"],
    ["o retorno é pago?", "T2"],
    ["precisa de jejum?", "PR1"],
    ["qual o preparo do ultrassom", "PR1"],
    ["vocês atendem em casa?", "D1"],
    ["atende bebê?", "I1"],
    ["até que idade vocês atendem?", "I1"],
    ["quero confirmar minha consulta", "CF1"],
    ["que horas é minha consulta?", "CF2"],
    ["vou receber lembrete?", "L1"],
    ["quero falar com o médico", "H1"],
    ["qual o telefone da clínica?", "H2"],
    ["obrigada!", "G1"],
    ["valeu", "G1"],
    ["bom dia", "G2"],
    ["é um robô?", "G3"],
  ])("%s → %s", (text, code) => {
    expect(codeOf(match(text))).toBe(code);
  });
});

describe("intenções parecidas", () => {
  it("remarcar × cancelar: cada uma na sua", () => {
    expect(codeOf(match("quero remarcar o horário"))).toBe("R1");
    expect(codeOf(match("não vou mais, pode cancelar"))).toBe("K1");
  });

  it("valor × formas de pagamento × convênio", () => {
    expect(codeOf(match("quanto custa a ultrassonografia?"))).toBe("V1");
    expect(codeOf(match("aceita cartão de crédito?"))).toBe("V2");
    expect(codeOf(match("atende pelo plano Bradesco?"))).toBe("C1");
  });

  it("marcar consulta × marcar exame × marcar retorno", () => {
    expect(codeOf(match("quero agendar uma consulta"))).toBe("M1");
    expect(codeOf(match("quero agendar um exame"))).toBe("X1");
    expect(codeOf(match("agendar retorno"))).toBe("T1");
  });

  it("cortesia junto com pergunta: vale a pergunta", () => {
    expect(codeOf(match("bom dia, qual o horário de vocês?"))).toBe("F1");
    expect(codeOf(match("obrigado, quero remarcar"))).toBe("R1");
  });
});

describe("link do portal só com o pedido (cliente, 13/nov/2026)", () => {
  const LINK_FLOWS = new Set(["book_consultation", "book_exam", "book_return", "my_appointments", "reschedule", "cancel", "confirm"]);
  const opensLink = (m: KbMatch) =>
    m.kind === "answer" ? LINK_FLOWS.has(m.entry.flow ?? "") : m.kind === "ambiguous" && m.options.some((o) => LINK_FLOWS.has(o.flow ?? ""));

  it.each([
    "Quanto tá a consulta",
    "Pneumologista pediátrica",
    "consulta",
    "tem vaga amanhã?",
    "tem vaga na terça?",
    "tem horário na sexta?",
    "exame de sangue",
    "retorno",
    "que horas?",
    "quando?",
    "preciso mudar o dia da consulta",
    "não vou poder ir",
    "a consulta está marcada?",
    "tenho marcapasso, posso fazer o exame?",
    "Marcia aqui, sobre o retorno",
    "pode confirmar o valor do exame?",
  ])("%s → sem link", (text) => {
    expect(opensLink(match(text))).toBe(false);
  });

  it("\"quanto tá\", \"quanto sai\": o valor", () => {
    expect(codeOf(match("Quanto tá a consulta"))).toBe("V1");
    expect(codeOf(match("quanto sai o exame?"))).toBe("V1");
    expect(codeOf(match("quanto está a consulta?"))).toBe("V1");
    // A frase inteira: "quanto tá demorando" não é preço.
    expect(codeOf(match("quanto está demorando o resultado?"))).not.toBe("V1");
  });

  it("nome de profissional com \"marc…\" não é pedido de marcar", () => {
    const marcela: ClinicTerms = { ...clinic, professionals: [...clinic.professionals, { id: "p-marcela", name: "Dra. Marcela Souza" }] };
    expect(opensLink(match("exame com a Dra Marcela", marcela))).toBe(false);
  });

  it("cada pedido abre só o seu caminho: \"cancelar\" não oferece remarcar", () => {
    expect(codeOf(match("quero cancelar, não vou poder ir"))).toBe("K1");
  });

  it("toda frase de exemplo e palavra-chave de uma entrada com link traz o pedido dela", () => {
    const words = (text: string) => normalizeText(text).split(" ");
    for (const entry of (catalog as KbContent).entries.filter((e) => e.flow && e.flow !== "waitlist")) {
      for (const text of entry.synonyms) {
        const m = matchQuestion(compileKnowledge(1, { ...(catalog as KbContent), entries: [entry] }), text, clinic);
        expect(m.kind === "answer" || m.kind === "ambiguous", `${entry.code}: "${text}" (${words(text).length} palavras)`).toBe(true);
      }
    }
  });

  it.each([
    ["quero marcar uma consulta", "M1"],
    ["quero agendar para amanhã", "M1"],
    ["tem como agendar para amanhã?", "M1"],
    ["agendamento", "M1"],
    ["marcar retorno", "T1"],
    ["quero agendar um exame", "X1"],
    ["quando é minha consulta?", "CF2"],
    ["quero ver meu agendamento", "CF2"],
    ["preciso remarcar", "R1"],
    ["desmarcar", "K1"],
    ["quero confirmar", "CF1"],
    ["marque uma consulta pra mim", "M1"],
    ["agende uma consulta", "M1"],
    ["meu retorno é quando?", "CF2"],
    ["que dia é meu horário?", "CF2"],
  ])("%s → %s", (text, code) => {
    expect(codeOf(match(text))).toBe(code);
  });
});

describe("não reconhece", () => {
  it.each(["tem estacionamento?", "que documentos preciso levar?", "asdfgh", "2", "12", "", "sim", "ok"])("%s", (text) => {
    expect(match(text).kind).toBe("none");
  });

  it("serviço que a clínica não tem não aciona \"vocês fazem…?\"", () => {
    expect(codeOf(match("vocês fazem tomografia?"))).not.toBe("S2");
  });
});

describe("filtro clínico", () => {
  it.each(["meu filho está com febre, o que faço?", "posso tomar dipirona antes do exame?", "meu exame deu alterado, é grave?", "qual a dose do xarope?"])(
    "%s → aviso",
    (text) => {
      expect(match(text).kind).toBe("clinical");
    },
  );

  it("sintoma com pedido de marcação abre a marcação (Q1)", () => {
    expect(codeOf(match("quero marcar uma consulta, meu filho está com febre"))).toBe("M1");
  });

  it("jejum, preparo e resultado pronto não acionam o filtro", () => {
    expect(codeOf(match("precisa de jejum para o exame?"))).toBe("PR1");
    expect(codeOf(match("o resultado ficou pronto?"))).toBe("X2");
    expect(codeOf(match("vocês tem consulta de alergia?"))).not.toBe("clinical");
  });
});

describe("nomes da clínica", () => {
  it("serviço, profissional, plano e especialidade citados", () => {
    const m = match("quanto custa a consulta pediátrica com a dra karina pela unimed?");
    expect(m.terms).toEqual({ serviceIds: ["s-ped"], professionalIds: ["p-ana"], planIds: ["u"], specialties: [] });
    expect(match("tem pneumopediatra?").terms.specialties).toEqual(["Pneumologia pediátrica"]);
  });

  it("um nome só, sem doutor(a), não identifica o profissional", () => {
    expect(match("a ana pode me atender?").terms.professionalIds).toEqual([]);
    expect(match("o dr joao atende?").terms.professionalIds).toEqual(["p-joao"]);
  });

  it("\"consulta\" sozinha não identifica a Consulta pediátrica", () => {
    expect(match("quanto custa a consulta?").terms.serviceIds).toEqual([]);
  });

  it("clínica sem os nomes: as perguntas genéricas continuam", () => {
    const empty: ClinicTerms = { services: [], professionals: [], plans: [] };
    expect(codeOf(match("vocês aceitam unimed?", empty))).toBe("C1");
    expect(codeOf(match("vocês fazem ultrassonografia?", empty))).not.toBe("S2");
  });
});

describe("conteúdo da base", () => {
  it("entrada que não está publicada não responde", () => {
    const withoutF1 = compileKnowledge(2, { ...(catalog as KbContent), entries: (catalog as KbContent).entries.filter((e) => e.code !== "F1") });
    expect(matchQuestion(withoutF1, "qual o horário de funcionamento?", clinic).kind).not.toBe("answer");
  });

  it("sinônimo novo passa a valer", () => {
    const content = catalog as KbContent;
    const before = compileKnowledge(2, content);
    expect(matchQuestion(before, "tem estacionamento?", clinic).kind).toBe("none");
    const after = compileKnowledge(3, {
      ...content,
      entries: content.entries.map((e) => (e.code === "E1" ? { ...e, keywords: [...e.keywords, "estacionamento"], synonyms: [...e.synonyms, "tem estacionamento"] } : e)),
    });
    expect(codeOf(matchQuestion(after, "tem estacionamento?", clinic))).toBe("E1");
  });
});
