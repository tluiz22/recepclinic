import { registerParams, type RegisterRequest } from "../../../lib/data/contactInteractions";
import { withReturn } from "../../../lib/returnPath";

/** Endereço do "Registrar contato" (CRM C2), com a volta para a tela atual. */
export function registerHref(req: Partial<RegisterRequest> & Pick<RegisterRequest, "source">, returnTo: string): string {
  return withReturn(`/admin/relacionamento/registrar?${new URLSearchParams(registerParams(req))}`, returnTo);
}
