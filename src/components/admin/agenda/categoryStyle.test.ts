import { describe, expect, it } from "vitest";
import { agendaCategoriesTitle, CATEGORY_STYLES, SERVICE_TINTS, serviceBesideCategory, serviceLook, serviceTints } from "./categoryStyle";

describe("tipo do atendimento na Agenda", () => {
  it("mostra o serviço quando ele não repete o tipo", () => {
    expect(serviceBesideCategory("Consulta pediátrica", "consultation")).toBe(
      "Consulta pediátrica",
    );
    expect(serviceBesideCategory("Espirometria", "exam")).toBe("Espirometria");
  });

  it("omite o serviço com o mesmo nome do tipo, sem diferença de maiúsculas ou espaços", () => {
    expect(serviceBesideCategory("Retorno", "return_visit")).toBeNull();
    expect(serviceBesideCategory(" retorno ", "return_visit")).toBeNull();
    expect(serviceBesideCategory("CONSULTA", "consultation")).toBeNull();
  });

  it("dá ao Retorno uma cor própria e aos outros tipos o tom do texto", () => {
    expect(CATEGORY_STYLES.return_visit.text).toBe("text-ret-700");
    expect(CATEGORY_STYLES.consultation.text).toBe("text-ink");
    expect(CATEGORY_STYLES.exam.label).toBe("Exame");
  });
});

describe("título do horário de todos os serviços", () => {
  it("junta os tipos da agenda na ordem Consulta, Retorno, Exame", () => {
    expect(
      agendaCategoriesTitle(["return_visit", "consultation", "consultation"]),
    ).toBe("Consulta e Retorno");
    expect(
      agendaCategoriesTitle(["exam", "return_visit", "consultation"]),
    ).toBe("Consulta, Retorno e Exame");
    expect(agendaCategoriesTitle(["exam"])).toBe("Exame");
  });

  it('diz "Todos os serviços" quando a agenda não tem serviço', () => {
    expect(agendaCategoriesTitle([])).toBe("Todos os serviços");
  });
});

describe("cor de cada serviço", () => {
  const ref = (id: string, category: "consultation" | "return_visit" | "exam", createdAt: string) => ({ id, category, createdAt });

  it("dá cores diferentes aos serviços pela ordem de criação e roxo a todo Retorno", () => {
    const tints = serviceTints([
      ref("domiciliar", "consultation", "2026-10-02T10:00:00Z"),
      ref("retorno", "return_visit", "2026-10-01T09:00:00Z"),
      ref("consulta", "consultation", "2026-10-01T10:00:00Z"),
      ref("espirometria", "exam", "2026-10-03T10:00:00Z"),
    ]);
    expect(tints.get("consulta")).toBe(SERVICE_TINTS[0]);
    expect(tints.get("domiciliar")).toBe(SERVICE_TINTS[1]);
    expect(tints.get("espirometria")).toBe(SERVICE_TINTS[2]);
    expect(tints.get("retorno")?.text).toBe("text-ret-700");
  });

  it("serviço novo pega a próxima cor sem mudar as dos outros; depois da última, recomeça", () => {
    const refs = SERVICE_TINTS.map((_, i) => ref(`s${i}`, "consultation", `2026-10-0${i + 1}T10:00:00Z`));
    const before = serviceTints(refs);
    const after = serviceTints([...refs, ref("novo", "exam", "2026-10-20T10:00:00Z")]);
    refs.forEach((r) => expect(after.get(r.id)).toBe(before.get(r.id)));
    expect(after.get("novo")).toBe(SERVICE_TINTS[0]);
  });

  it("mantém o rótulo e o ícone do tipo com a cor do serviço", () => {
    const look = serviceLook("consultation", SERVICE_TINTS[1]);
    expect(look.label).toBe("Consulta");
    expect(look.icon).toBe("clipboard");
    expect(look.text).toBe(SERVICE_TINTS[1].text);
    expect(serviceLook("exam").text).toBe(CATEGORY_STYLES.exam.text);
  });
});
