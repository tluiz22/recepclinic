import type { APIRoute } from "astro";
import { lookupCep } from "../../../../../lib/cep";

// Endereço do pagador (cliente, 07/nov/2026): a tela pede o CEP aqui e preenche
// rua, bairro, cidade e UF. Só o Administrador da clínica e o Suporte (quem
// edita o endereço); a consulta ao ViaCEP sai do servidor.
export const GET: APIRoute = async ({ url, locals }) => {
  const clinic = locals.clinic;
  if (!clinic || (!clinic.isPlatformStaff && !clinic.roles.includes("admin"))) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  const found = await lookupCep(url.searchParams.get("cep") ?? "");
  return new Response(JSON.stringify(found ?? { error: "not_found" }), {
    status: found ? 200 : 404,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=86400" },
  });
};
