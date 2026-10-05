import { describe, expect, it } from "vitest";
import { hashToken, newToken, validateNewClinic } from "./data/onboarding";
import { addedToClinicEmail, inviteEmail, infoRequestEmail } from "./email";
import { emptyAnswers, MAX_ROWS, normalizeAnswers, parseOnboardingForm, sectionsFor, submitProblem } from "./onboardingForm";

const form = (entries: [string, string][]) => {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
};
const all = sectionsFor(["whatsapp_bot", "home_visit", "exams", "daily_summary"]);
const none = sectionsFor([]);

describe("formulário de informações", () => {
  it("seções pelos itens liberados", () => {
    expect(all).toEqual({ botInfo: true, homeVisit: true, exams: true, dailySummary: true, whatsapp: true });
    expect(none).toEqual({ botInfo: false, homeVisit: false, exams: false, dailySummary: false, whatsapp: false });
    expect(sectionsFor(["reminders"]).whatsapp).toBe(true);
  });

  it("linhas repetidas na ordem; linha vazia sai", () => {
    const data = form([
      ["location_name", "Centro"],
      ["location_type", "home_visit"],
      ["location_address", "Rua A, 1"],
      ["location_name", ""],
      ["location_type", "clinic"],
      ["location_address", ""],
      ["team_name", "Ana"],
      ["team_email", " ANA@Exemplo.com "],
      ["team_role", "admin"],
      ["team_name", "Bia"],
      ["team_email", "bia@exemplo.com"],
      ["team_role", "dono"],
    ]);
    const answers = parseOnboardingForm(data, all);
    expect(answers.locations).toEqual([{ name: "Centro", type: "home_visit", address: "Rua A, 1" }]);
    expect(answers.team).toEqual([
      { name: "Ana", email: "ana@exemplo.com", role: "admin" },
      { name: "Bia", email: "bia@exemplo.com", role: "reception" },
    ]);
    // Sem o item domiciliar, o local vira consultório.
    expect(parseOnboardingForm(data, none).locations[0].type).toBe("clinic");
  });

  it("campos de seção não liberada ficam vazios", () => {
    const data = form([
      ["clinic_name", "Clínica X"],
      ["clinic_profile", "adult"],
      ["clinic_payment", "PIX"],
      ["whatsapp_number", "84999990000"],
      ["professional_name", "Dra. Ana"],
      ["professional_summary", "sim"],
    ]);
    const limited = parseOnboardingForm(data, none);
    expect(limited.clinic).toMatchObject({ name: "Clínica X", profile: "adult", paymentInfo: "" });
    expect(limited.whatsapp.number).toBe("");
    expect(limited.professionals[0].receivesSummary).toBe(false);
    const full = parseOnboardingForm(data, all);
    expect(full.clinic.paymentInfo).toBe("PIX");
    expect(full.professionals[0].receivesSummary).toBe(true);
  });

  it("limite de linhas e perfil desconhecido", () => {
    const data = form(Array.from({ length: MAX_ROWS + 5 }, (_, i) => ["team_name", `Pessoa ${i}`] as [string, string]));
    data.append("clinic_profile", "outro");
    const answers = parseOnboardingForm(data, all);
    expect(answers.team).toHaveLength(MAX_ROWS);
    expect(answers.clinic.profile).toBe("");
  });

  it("enviar exige o nome da clínica; respostas antigas no formato atual", () => {
    expect(submitProblem(emptyAnswers())).toMatch(/nome da clínica/);
    expect(submitProblem({ ...emptyAnswers(), clinic: { ...emptyAnswers().clinic, name: "X" } })).toBeNull();
    expect(normalizeAnswers({ clinic: { name: "X" }, services: 1 })).toMatchObject({ clinic: { name: "X", city: "" }, services: "", team: [] });
    expect(normalizeAnswers(null)).toEqual(emptyAnswers());
  });
});

describe("nova clínica e e-mails", () => {
  it("valida e normaliza", () => {
    expect(validateNewClinic({ name: " Clínica ", profile: "mixed", timezone: "America/Fortaleza", adminEmail: " ADM@X.COM " })).toEqual({
      name: "Clínica",
      profile: "mixed",
      timezone: "America/Fortaleza",
      adminEmail: "adm@x.com",
    });
    expect(() => validateNewClinic({ name: "", profile: "mixed", timezone: "Lua/Base", adminEmail: "x" })).toThrow(/Informe o nome/);
  });

  it("código do link aleatório e só o hash guardado", () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("e-mails com o link e o nome da clínica escapado", () => {
    const invite = inviteEmail("a@b.c", { clinicName: "Clínica <Teste>", link: "http://x/confirmar?token_hash=abc&type=invite" });
    expect(invite.subject).toBe("Convite para o painel da Clínica <Teste>");
    expect(invite.html).toContain("Clínica &lt;Teste&gt;");
    expect(invite.html).not.toContain("<Teste>");
    expect(invite.text).toContain("Criar minha senha: http://x/confirmar?token_hash=abc&type=invite");
    expect(addedToClinicEmail("a@b.c", { clinicName: "X", loginUrl: "http://x/admin/login" }).text).toContain("http://x/admin/login");
    expect(infoRequestEmail("a@b.c", { clinicName: "X", link: "http://x/formulario/t", expiresOn: "04/11/2026" }).text).toContain("04/11/2026");
  });
});
