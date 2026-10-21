// Jornada de configuração revista (cliente, 21/out/2026): Profissional → Local
// → Agenda → Serviços → Horários. Um cadastro aberto pelo "próximo passo" de
// outro leva a origem no endereço (`?profissional=`, `?local=`, `?agenda=`,
// `?servico=`): o "Voltar" e o "Cancelar" levam de volta a ela, e o próximo
// passo continua de onde a pessoa estava. No serviço, `?marcar_agenda=` e
// `?marcar_local=` só deixam marcada a agenda ou o local recém-criados.

const SECTIONS = { profissional: "profissionais", local: "locais", agenda: "agendas", servico: "servicos" } as const;

export type OriginKind = keyof typeof SECTIONS;
export type SetupOrigin = { kind: OriginKind; id: string };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Id de um cadastro vindo no endereço (o serviço ainda não salvo é `novo`). */
export function setupParam(url: URL, name: string): string | null {
  const value = url.searchParams.get(name);
  return value && (ID.test(value) || (name === "servico" && value === "novo")) ? value : null;
}

/** A primeira origem presente, na ordem pedida. */
export function setupOrigin(url: URL, kinds: OriginKind[]): SetupOrigin | null {
  for (const kind of kinds) {
    const id = setupParam(url, kind);
    if (id) return { kind, id };
  }
  return null;
}

export function originPage(origin: SetupOrigin): string {
  return `/admin/configuracoes/${SECTIONS[origin.kind]}/${origin.id}`;
}

/** `href` com os parâmetros dados (os vazios ficam de fora). */
export function withParams(href: string, params: Record<string, string | null | undefined>): string {
  const query = Object.entries(params)
    .filter((entry): entry is [string, string] => !!entry[1])
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return query ? `${href}${href.includes("?") ? "&" : "?"}${query}` : href;
}
