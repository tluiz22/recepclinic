import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { createIssuerSubaccount, refreshIssuerFromAsaas, sendIssuerFiscalInfo, type CredentialInput } from "../../../../lib/data/fiscalIssuerAsaas";
import {
  getFiscalIssuer,
  saveFiscalIssuer,
  setIssuerPayer,
  setIssuerServiceCode,
  setIssuingEnabled,
  setProfessionalRoute,
  type IssuerInput,
} from "../../../../lib/data/fiscalIssuers";
import { runFormAction } from "../../../../lib/data/formAction";
import { formChecked, formText } from "../../../../lib/forms";
import { isUuid } from "../../../../lib/clinicAccess";
import { receivedReturn, withReturn } from "../../../../lib/returnPath";

// Configurações › Nota fiscal (N2b): emissores fiscais. O Administrador e o
// profissional dono (N-P2) salvam os dados, enviam a configuração e o
// certificado ao Asaas e ligam a emissão; só o Administrador escolhe como o
// profissional sem CNPJ emite (N-P1) e quem paga as notas; só o Suporte cria
// a subconta. O banco confere de novo; o certificado e a senha vão direto ao
// Asaas e não entram em log nem no aviso.

const FIELDS: [keyof IssuerInput, string][] = [
  ["cnpj", "cnpj"],
  ["legalName", "legal_name"],
  ["fiscalEmail", "fiscal_email"],
  ["mobilePhone", "mobile_phone"],
  ["companyType", "company_type"],
  ["monthlyIncome", "monthly_income"],
  ["postalCode", "postal_code"],
  ["street", "street"],
  ["streetNumber", "street_number"],
  ["complement", "complement"],
  ["district", "district"],
  ["municipalityIbge", "municipality_ibge"],
  ["municipalRegistration", "municipal_registration"],
  ["simplesNacional", "simples_nacional"],
  ["specialTaxRegime", "special_tax_regime"],
  ["cnae", "cnae"],
  ["serviceCode", "service_code"],
  ["serviceName", "service_name"],
  ["nbsCode", "nbs_code"],
  ["issRate", "iss_rate"],
  ["pisCofinsTaxStatus", "pis_cofins_tax_status"],
  ["taxSituationCode", "tax_situation_code"],
  ["taxClassificationCode", "tax_classification_code"],
  ["operationIndicatorCode", "operation_indicator_code"],
  ["rpsSeries", "rps_series"],
  ["rpsNextNumber", "rps_next_number"],
];

export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  const volta = receivedReturn(new URL(request.url));
  const professionalId = formText(form, "profissional") || null;
  const issuerPage = withReturn(`/admin/configuracoes/nota-fiscal/emissor${professionalId ? `?profissional=${professionalId}` : ""}`, volta);
  const listPage = withReturn("/admin/configuracoes/nota-fiscal", volta);
  const acao = formText(form, "acao");
  const failure = acao === "rota" ? listPage : issuerPage;
  if (professionalId && !isUuid(professionalId)) return context.redirect(listPage, 303);

  /** O emissor que o login pode ver (RLS); sem ele, não há o que fazer. */
  const issuerFromForm = async () => {
    const id = formText(form, "emissor");
    const issuer = isUuid(id) ? await getFiscalIssuer(db, id) : null;
    if (!issuer || issuer.clinicId !== clinic.clinicId) throw new DataError("not_found", "Emissor não encontrado.");
    return issuer;
  };

  return runFormAction(
    context,
    async () => {
      switch (acao) {
        case "rota": {
          const mode = formText(form, "modo");
          if (!professionalId) throw new DataError("invalid", "Escolha o profissional.");
          if (mode === "own") return { redirectTo: issuerPage, message: "Preencha os dados fiscais do CNPJ do profissional." };
          await setProfessionalRoute(db, clinic.clinicId, professionalId, mode as "clinic" | "none");
          return { redirectTo: listPage, message: mode === "none" ? "Pronto: este profissional não emite nota pelo sistema." : "Pronto: as notas deste profissional saem pelo emissor da clínica." };
        }
        case "dados": {
          const input = Object.fromEntries(FIELDS.map(([key, name]) => [key, formText(form, name)])) as IssuerInput;
          await saveFiscalIssuer(db, clinic.clinicId, professionalId, input);
          return { redirectTo: issuerPage, message: "Dados fiscais salvos. Envie ao Asaas para valerem." };
        }
        case "subconta": {
          if (!clinic.isPlatformStaff) throw new DataError("forbidden", "Só o Suporte cria a subconta no Asaas.");
          const issuer = await issuerFromForm();
          await createIssuerSubaccount(issuer.id, locals.userId!);
          return { redirectTo: issuerPage, message: "Subconta criada no Asaas. Agora o emissor envia os documentos e a configuração fiscal." };
        }
        case "atualizar": {
          const issuer = await issuerFromForm();
          await refreshIssuerFromAsaas(issuer.id);
          return { redirectTo: issuerPage, message: "Situação atualizada com o Asaas." };
        }
        case "enviar": {
          const issuer = await issuerFromForm();
          if (!formChecked(form, "autorizo")) throw new DataError("invalid", "Marque a autorização para enviar ao Asaas.", { autorizo: "Marque para enviar." });
          const type = formText(form, "credencial");
          let credential: CredentialInput = null;
          if (type === "CERTIFICATE") {
            const file = form?.get("pfx");
            const pfx = file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : null;
            // Sem arquivo novo: reenvia só os dados (o Asaas guarda o certificado já enviado).
            credential = pfx || !issuer.certificateSentAt ? { type, file: pfx, fileName: file instanceof File ? file.name : "certificado.pfx", password: formText(form, "password") } : null;
          } else if (type === "USER_AND_PASSWORD") {
            const username = formText(form, "username");
            credential = username ? { type, username, password: formText(form, "password") } : null;
          } else if (type === "TOKEN") {
            const accessToken = formText(form, "access_token");
            credential = accessToken ? { type, accessToken } : null;
          }
          await sendIssuerFiscalInfo(issuer.id, credential, locals.userId!);
          return { redirectTo: issuerPage, message: "Configuração fiscal aceita pelo Asaas." };
        }
        case "ligar":
        case "desligar": {
          const issuer = await issuerFromForm();
          await setIssuingEnabled(db, issuer.id, acao === "ligar");
          return { redirectTo: issuerPage, message: acao === "ligar" ? "Emissão ligada: as notas deste emissor já podem sair." : "Emissão desligada." };
        }
        case "pagador": {
          const issuer = await issuerFromForm();
          await setIssuerPayer(db, issuer.id, formText(form, "pagador") === "professional" ? "professional" : "clinic");
          return { redirectTo: issuerPage, message: "Quem paga as notas: salvo." };
        }
        case "codigos": {
          const issuer = await issuerFromForm();
          const ids = form?.getAll("service_id").map(String).filter(isUuid) ?? [];
          for (const serviceId of ids) await setIssuerServiceCode(db, issuer.id, serviceId, formText(form, `code_${serviceId}`));
          return { redirectTo: issuerPage, message: "Códigos dos serviços salvos." };
        }
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    failure,
  );
};
