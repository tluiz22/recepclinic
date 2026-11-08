import { describe, expect, it } from "vitest";
import { NO_SPECIALTY_GROUP, ownerLabel, ownerOptionGroups, TEAM_OWNER_LABEL } from "./serviceOwner";

const pros = [
  { id: "b", displayName: "Dr. Bruno", isActive: true, specialties: [{ name: "Pediatria" }] },
  { id: "a", displayName: "Dra. Ana", isActive: true, specialties: [{ name: "Cardiologia" }, { name: "Pediatria" }] },
  { id: "c", displayName: "Carla", isActive: true, specialties: [] },
  { id: "d", displayName: "Dr. Desativado", isActive: false, specialties: [{ name: "Cardiologia" }] },
];

describe("dono do serviço (MS)", () => {
  it("nome do dono: profissional com a especialidade principal, a equipe ou sem dono", () => {
    expect(ownerLabel({ professionalId: "a", isTeam: false }, pros)).toBe("Dra. Ana (Cardiologia)");
    expect(ownerLabel({ professionalId: "c", isTeam: false }, pros)).toBe("Carla");
    expect(ownerLabel({ professionalId: null, isTeam: true }, pros)).toBe(TEAM_OWNER_LABEL);
    expect(ownerLabel({ professionalId: null, isTeam: false }, pros)).toBe("Sem profissional");
  });

  it("grupos pela especialidade principal, sem os desativados, sem especialidade no fim e a equipe por último", () => {
    const groups = ownerOptionGroups(pros, { team: true });
    expect(groups.map((g) => g.label)).toEqual(["Cardiologia", "Pediatria", NO_SPECIALTY_GROUP, "Exames"]);
    expect(groups[0].options).toEqual([{ value: "a", label: "Dra. Ana" }]);
    expect(groups.at(-1)!.options[0].value).toBe("equipe");
    expect(ownerOptionGroups(pros, { team: false }).some((g) => g.label === "Exames")).toBe(false);
  });
});
