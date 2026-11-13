import type { APIRoute } from "astro";
import { lookupCep } from "../../../../lib/cep";

// Endereço de quem paga (N3a): a tela pede o CEP aqui e preenche rua e bairro.
// Área do Financeiro (Administrador e Recepção, com o item liberado: middleware).
export const GET: APIRoute = async ({ url }) => {
  const found = await lookupCep(url.searchParams.get("cep") ?? "");
  return new Response(JSON.stringify(found ?? { error: "not_found" }), {
    status: found ? 200 : 404,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=86400" },
  });
};
