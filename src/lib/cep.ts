// Busca do CEP (cliente, 07/nov/2026): o endereço do pagador preenche rua,
// bairro, cidade e UF pelo CEP. A consulta sai do servidor (ViaCEP, serviço
// público e gratuito) — o navegador só fala com o RecepClinic (CSP). Sem
// resposta ou CEP inexistente: null, e a pessoa preenche à mão.

export type CepResult = { postalCode: string; street: string; district: string; city: string; state: string };

type Fetcher = typeof fetch;

export async function lookupCep(cep: string, fetcher: Fetcher = fetch, timeoutMs = 4000): Promise<CepResult | null> {
  const digits = cep.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  try {
    const response = await fetcher(`https://viacep.com.br/ws/${digits}/json/`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    if (!data || data.erro) return null;
    const text = (key: string) => (typeof data[key] === "string" ? (data[key] as string).trim() : "");
    const state = text("uf").toUpperCase();
    if (!/^[A-Z]{2}$/.test(state) || !text("localidade")) return null;
    return { postalCode: digits, street: text("logradouro"), district: text("bairro"), city: text("localidade"), state };
  } catch {
    return null;
  }
}
