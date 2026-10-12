import { expect, it } from "vitest";
import { currentPath, receivedReturn, safeReturnPath, withReturn } from "./returnPath";

it("volta só para telas do dia a dia dentro do painel", () => {
  expect(safeReturnPath("/admin/agenda?date=2026-10-12", "/x")).toBe("/admin/agenda?date=2026-10-12");
  expect(safeReturnPath("/admin/consultas?tab=pendentes", "/x")).toBe("/admin/consultas?tab=pendentes");
  expect(safeReturnPath("/admin/financeiro/dmed?ano=2025", "/x")).toBe("/admin/financeiro/dmed?ano=2025");
  expect(safeReturnPath("/admin/pacientes/8a64cd4f-aa75-430c-8e41-b58e9d20fe1d", "/x")).toBe("/admin/pacientes/8a64cd4f-aa75-430c-8e41-b58e9d20fe1d");
  expect(safeReturnPath("/admin/dashboard", "/x")).toBe("/admin/dashboard");
  expect(safeReturnPath("https://outro.site/admin/agenda", "/x")).toBe("/x");
  expect(safeReturnPath("//outro.site", "/x")).toBe("/x");
  expect(safeReturnPath("/admin/configuracoes", "/x")).toBe("/x");
  expect(safeReturnPath(`/admin/agenda?q=${"a".repeat(2000)}`, "/x")).toBe("/x");
  expect(safeReturnPath(null, "/x")).toBe("/x");
});

it("leva a origem adiante e a recebe de volta, inclusive a origem da origem", () => {
  const search = currentPath(new URL("https://app.exemplo/admin/agenda/buscar?q=Ana&paciente=1"));
  const ficha = withReturn("/admin/pacientes/8a64cd4f-aa75-430c-8e41-b58e9d20fe1d", search);
  expect(receivedReturn(new URL(ficha, "https://app.exemplo"))).toBe("/admin/agenda/buscar?q=Ana&paciente=1");

  const contato = withReturn("/admin/pacientes/contato/1?x=1", currentPath(new URL(ficha, "https://app.exemplo")));
  expect(contato.startsWith("/admin/pacientes/contato/1?x=1&volta=")).toBe(true);
  expect(receivedReturn(new URL(contato, "https://app.exemplo"))).toBe(ficha);

  expect(withReturn("/admin/pacientes/1", "https://outro.site")).toBe("/admin/pacientes/1");
  expect(receivedReturn(new URL("https://app.exemplo/admin/pacientes/1?volta=%2Fadmin%2Fconfiguracoes"))).toBeNull();
});
