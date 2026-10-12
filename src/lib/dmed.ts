// Arquivo da DMED (F11.6, cliente, 12/out/2026): declaração de serviços
// médicos e de saúde, que a clínica (pessoa jurídica prestadora) entrega à
// Receita até o fim de fevereiro. Leiaute do Ato Declaratório Executivo Cofis
// nº 34/2024: texto, um registro por linha, cada campo terminado em "|" (o
// último também); datas AAAAMMDD; valores em centavos, sem separador e sem
// zeros à esquerda; CPF e CNPJ só com os dígitos.
//
//   Dmed     cabeçalho (ano de referência = ano-calendário + 1; original)
//   RESPO    responsável pelo preenchimento (em geral o contador)
//   DECPJ    a clínica (tipo 1, prestador de serviço de saúde)
//   PSS      início dos prestados
//   RPPSS    quem pagou (CPF em ordem crescente), com o valor em benefício próprio
//   BRPPSS   cada beneficiário pago por ele (CPF e nascimento em ordem crescente;
//            o nascimento vai sempre, obrigatório quando falta o CPF)
//   FIMDmed  fim
//
// O contador importa o arquivo no programa da Receita (PGD Dmed), que valida
// tudo de novo antes de transmitir.

export type DmedFiller = {
  cpf: string;
  name: string;
  ddd: string;
  phone: string;
  extension: string | null;
  email: string | null;
};

export type DmedDeclarant = {
  cnpj: string;
  legalName: string;
  cnes: string | null;
  /** CPF do responsável perante o CNPJ. */
  legalResponsibleCpf: string;
};

/** Um pagamento do ano, já com quem pagou e o paciente (beneficiário). */
export type DmedPayment = {
  amountCents: number;
  payerCpf: string;
  payerName: string;
  /** O próprio paciente pagou (benefício próprio). */
  selfPaid: boolean;
  patientKey: string;
  patientName: string;
  patientCpf: string | null;
  /** AAAA-MM-DD. */
  patientBirthdate: string;
};

export type DmedBeneficiary = { cpf: string | null; birthdate: string; name: string; cents: number };
export type DmedResponsible = { cpf: string; name: string; ownCents: number; beneficiaries: DmedBeneficiary[] };

/** Agrupa por quem pagou (CPF) e, dentro, por beneficiário; na ordem que a Receita pede. */
export function groupDmed(payments: DmedPayment[]): DmedResponsible[] {
  const byPayer = new Map<string, { cpf: string; name: string; ownCents: number; beneficiaries: Map<string, DmedBeneficiary> }>();
  for (const p of payments) {
    const payer = byPayer.get(p.payerCpf) ?? { cpf: p.payerCpf, name: p.payerName, ownCents: 0, beneficiaries: new Map() };
    payer.name = p.payerName;
    if (p.selfPaid || p.patientCpf === p.payerCpf) {
      payer.ownCents += p.amountCents;
    } else {
      const key = p.patientCpf ?? `sem-cpf:${p.patientKey}`;
      const beneficiary = payer.beneficiaries.get(key) ?? { cpf: p.patientCpf, birthdate: p.patientBirthdate, name: p.patientName, cents: 0 };
      beneficiary.cents += p.amountCents;
      payer.beneficiaries.set(key, beneficiary);
    }
    byPayer.set(p.payerCpf, payer);
  }
  return [...byPayer.values()]
    .sort((a, b) => a.cpf.localeCompare(b.cpf))
    .map((payer) => ({
      cpf: payer.cpf,
      name: payer.name,
      ownCents: payer.ownCents,
      beneficiaries: [...payer.beneficiaries.values()].sort(
        (a, b) => (a.cpf ?? "").localeCompare(b.cpf ?? "") || a.birthdate.localeCompare(b.birthdate) || a.name.localeCompare(b.name),
      ),
    }));
}

/** Texto de campo: sem "|" nem quebra de linha, espaços juntos, no tamanho máximo. */
export function dmedText(value: string, max: number): string {
  return value.replace(/[|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

const line = (fields: (string | number | null)[]) => `${fields.map((f) => (f === null ? "" : String(f))).join("|")}|`;

export function buildDmed({
  year,
  filler,
  declarant,
  responsibles,
}: {
  /** Ano-calendário (o dos pagamentos). */
  year: number;
  filler: DmedFiller;
  declarant: DmedDeclarant;
  responsibles: DmedResponsible[];
}): string {
  const lines = [
    line(["Dmed", year + 1, year, "N", null, null]),
    line(["RESPO", filler.cpf, dmedText(filler.name, 60), filler.ddd, filler.phone, filler.extension, null, filler.email ? dmedText(filler.email, 50) : null]),
    line(["DECPJ", declarant.cnpj, dmedText(declarant.legalName, 150), 1, null, declarant.cnes, declarant.legalResponsibleCpf, "N", null, null]),
  ];
  // PSS: obrigatório para o prestador (tipo 1), mesmo sem pagamentos no ano.
  lines.push(line(["PSS"]));
  for (const r of responsibles) {
    // Valor em benefício próprio: obrigatório só sem beneficiário; zero fica vazio.
    lines.push(line(["RPPSS", r.cpf, dmedText(r.name, 60), r.ownCents > 0 ? r.ownCents : null]));
    for (const b of r.beneficiaries) {
      lines.push(line(["BRPPSS", b.cpf, b.birthdate.replaceAll("-", ""), dmedText(b.name, 60), b.cents]));
    }
  }
  lines.push(line(["FIMDmed"]));
  return `${lines.join("\r\n")}\r\n`;
}
