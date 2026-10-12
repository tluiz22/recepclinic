import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { revokeFiscalCertificate, saveFiscalSettings, saveServiceFiscalCodes, setFiscalEnvironment, uploadFiscalCertificate } from "../../../../lib/data/fiscal";
import { runFormAction } from "../../../../lib/data/formAction";
import { formChecked, formOptionalText, formText } from "../../../../lib/forms";
import { formatInstant } from "../../../../lib/clinicTime";

// Configurações › Nota fiscal (F11.3, Módulo financeiro): dados fiscais e
// códigos por serviço (Administrador e Suporte) e o certificado A1 (só o
// Administrador da clínica: enviar ou trocar, com o termo, e revogar; o banco
// confere de novo). O arquivo e a senha não vão para log nem para o aviso.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  const page = "/admin/configuracoes/nota-fiscal";

  return runFormAction(
    context,
    async () => {
      switch (formText(form, "acao")) {
        case "dados":
          await saveFiscalSettings(db, clinic.clinicId, {
            cnpj: formText(form, "cnpj"),
            legalName: formText(form, "legal_name"),
            municipalRegistration: formOptionalText(form, "municipal_registration"),
            municipalityIbge: formText(form, "municipality_ibge"),
            simplesNacional: formText(form, "simples_nacional"),
            simplesRegime: formOptionalText(form, "simples_regime"),
            simplesTotalRate: formOptionalText(form, "simples_total_rate"),
            specialRegime: formText(form, "special_regime"),
            serviceCode: formText(form, "service_code"),
            issRate: formText(form, "iss_rate"),
          });
          return { redirectTo: page, message: "Dados fiscais salvos." };
        case "codigos": {
          const ids = form?.getAll("service_id").map(String) ?? [];
          await saveServiceFiscalCodes(
            db,
            clinic.clinicId,
            ids.map((serviceId) => ({ serviceId, code: formOptionalText(form, `code_${serviceId}`) })),
          );
          return { redirectTo: page, message: "Códigos dos serviços salvos." };
        }
        case "certificado": {
          const file = form?.get("pfx");
          const pfx = file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : null;
          const saved = await uploadFiscalCertificate(db, clinic.clinicId, {
            pfx,
            password: formText(form, "password"),
            acceptedTerms: formChecked(form, "terms"),
          });
          return { redirectTo: page, message: `Certificado guardado: ${saved.subjectName}, válido até ${formatInstant(saved.validUntil, clinic.timezone, "dd/MM/yyyy")}.` };
        }
        case "ambiente": {
          const environment = formText(form, "environment");
          await setFiscalEnvironment(db, clinic.clinicId, environment);
          return { redirectTo: page, message: environment === "production" ? "Ambiente trocado: as próximas notas saem em Produção." : "Ambiente trocado: as próximas notas saem em Produção Restrita (testes)." };
        }
        case "revogar":
          await revokeFiscalCertificate(db, clinic.clinicId);
          return { redirectTo: page, message: "Certificado revogado: apagado do cofre, e a emissão de notas está desligada." };
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    page,
  );
};
