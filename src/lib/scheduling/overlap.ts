/**
 * A trava `appointments_no_overlap` (migração 0025) recusou a gravação:
 * outro atendimento ativo pegou o mesmo horário entre a checagem de
 * horários livres e o insert/update. Para a tela, é o mesmo que "horário
 * acabou de ser ocupado".
 */
export function isOverlapError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23P01";
}
