import { expect, it } from "vitest";
import { safeReturnPath } from "./returnPath";

it("volta só para telas do dia a dia dentro do painel", () => {
  expect(safeReturnPath("/admin/agenda?date=2026-10-12", "/x")).toBe("/admin/agenda?date=2026-10-12");
  expect(safeReturnPath("/admin/consultas?tab=pendentes", "/x")).toBe("/admin/consultas?tab=pendentes");
  expect(safeReturnPath("/admin/pacientes/8a64cd4f-aa75-430c-8e41-b58e9d20fe1d", "/x")).toBe("/admin/pacientes/8a64cd4f-aa75-430c-8e41-b58e9d20fe1d");
  expect(safeReturnPath("https://outro.site/admin/agenda", "/x")).toBe("/x");
  expect(safeReturnPath("//outro.site", "/x")).toBe("/x");
  expect(safeReturnPath("/admin/configuracoes", "/x")).toBe("/x");
  expect(safeReturnPath(null, "/x")).toBe("/x");
});
