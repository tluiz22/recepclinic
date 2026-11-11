import type { APIRoute } from "astro";
import { isUuid } from "../../../../lib/clinicAccess";
import { receivedReturn, withReturn } from "../../../../lib/returnPath";
import { todayIn } from "../../../../lib/clinicTime";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { anonymizePatient, contactForResponsible, getContact, getPatient, setPatientActive, setPatientInsurance, updatePatient } from "../../../../lib/data/patients";
import { linkPatientContact, listPatientContacts, setPrimaryContact, similarRecordsOfContact, unlinkPatientContact } from "../../../../lib/data/patientContacts";
import { releasePortalPhone } from "../../../../lib/data/portalPhone";
import { formatPhoneBR } from "../../../../lib/phone";
import { formOptionalText, formText } from "../../../../lib/forms";

// Paciente (F4.7): salvar dados, plano de saúde (com o item), desativar e reativar;
// anonimizar a pedido (F9.4, LGPD: só Administrador e Suporte; o banco confere de novo); liberar o celular no portal
// (validação da F3, cliente, 10/nov/2026: Administrador e Recepção; o banco confere de novo).
// Responsáveis (VR2, D14): ligar (com a ficha parecida desativada na mesma ação, UI-2), desligar e tornar principal;
// Administrador, Recepção e Suporte (o banco confere de novo).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  // A origem da tela (`?volta=`) segue depois da ação (cliente, 10/out/2026).
  const page = withReturn(`/admin/pacientes/${id}`, receivedReturn(new URL(request.url)));
  // Erro ao ligar um responsável: volta para "Adicionar responsável", no mesmo número (UI-2).
  const addPage = () => {
    const query = new URLSearchParams();
    const contactId = formText(form, "contact_id");
    if (contactId) query.set("contato", contactId);
    else if (formText(form, "phone")) query.set("celular", formText(form, "phone"));
    const volta = receivedReturn(new URL(request.url));
    if (volta) query.set("volta", volta);
    return `/admin/pacientes/${id}/responsavel${query.size ? `?${query}` : ""}`;
  };

  return runFormAction(
    context,
    async () => {
      if (!isUuid(id)) throw new DataError("not_found", "Paciente: não encontrado");
      switch (formText(form, "acao")) {
        case "salvar":
          await updatePatient(
            db,
            clinic.clinicId,
            id,
            { fullName: formText(form, "full_name"), birthdate: formText(form, "birthdate") },
            todayIn(clinic.timezone),
          );
          return { redirectTo: page, message: "Dados salvos." };
        case "plano": {
          if (!clinic.features.includes("insurance")) throw new DataError("not_enabled", "Convênios não liberados");
          const planId = formOptionalText(form, "plan_id");
          await setPatientInsurance(
            db,
            clinic.clinicId,
            id,
            planId ? { planId, cardNumber: formOptionalText(form, "card_number"), cardValidUntil: formOptionalText(form, "card_valid_until") } : null,
          );
          return { redirectTo: page, message: planId ? "Plano salvo." : "Agora é particular." };
        }
        case "desativar":
        case "reativar": {
          const active = formText(form, "acao") === "reativar";
          await setPatientActive(db, clinic.clinicId, id, active);
          return { redirectTo: page, message: active ? "Reativado." : "Desativado: sai das buscas do Marcar; o histórico fica." };
        }
        case "anonimizar": {
          if (!clinic.isPlatformStaff && !clinic.roles.includes("admin")) {
            throw new DataError("forbidden", "Anonimizar: só o Administrador da clínica ou o Suporte");
          }
          const { canceled } = await anonymizePatient(db, clinic.clinicId, id);
          const futures = canceled > 0 ? ` ${canceled} ${canceled === 1 ? "atendimento futuro cancelado" : "atendimentos futuros cancelados"}.` : "";
          return { redirectTo: page, message: `Anonimizado.${futures}` };
        }
        case "liberar_portal": {
          if (!clinic.features.includes("portal")) throw new DataError("not_enabled", "Portal não liberado");
          // Vários responsáveis (VR2): o celular bloqueado é o do responsável escolhido na faixa, desde que ligado ao paciente.
          const linked = await listPatientContacts(db, clinic.clinicId, id);
          const chosen = linked.find((c) => c.contactId === formText(form, "contact_id")) ?? linked.find((c) => c.isPrimary);
          if (!chosen) throw new DataError("not_found", "Responsável não encontrado");
          const contact = { phone: chosen.phone };
          await releasePortalPhone(db, clinic.clinicId, contact.phone);
          return { redirectTo: page, message: `Portal liberado para ${formatPhoneBR(contact.phone)}.` };
        }
        case "ligar_responsavel": {
          const kinship = formOptionalText(form, "kinship");
          if (kinship && kinship.length > 40) throw new DataError("invalid", "Parentesco longo", { kinship: "Parentesco: até 40 letras." });
          const contactId = formOptionalText(form, "contact_id");
          const contact = contactId
            ? await getContact(db, clinic.clinicId, contactId)
            : await contactForResponsible(db, clinic.clinicId, { phone: formText(form, "phone"), fullName: formOptionalText(form, "full_name") });
          const patient = await getPatient(db, clinic.clinicId, id);
          // A ficha parecida só sai se ainda for parecida agora (outra pessoa pode ter mudado no meio).
          const toDeactivate = new Set(form?.getAll("desativar").map(String) ?? []);
          const similar = toDeactivate.size ? await similarRecordsOfContact(db, clinic.clinicId, contact.id, patient) : [];
          await linkPatientContact(db, clinic.clinicId, id, contact.id, kinship);
          const off = similar.filter((r) => toDeactivate.has(r.id));
          for (const record of off) await setPatientActive(db, clinic.clinicId, record.id, false);
          const label = kinship ? `${contact.fullName} (${kinship.toLowerCase()})` : contact.fullName;
          return {
            redirectTo: page,
            message: `${label} ligado a ${patient.fullName}.${off.length ? ` A outra ficha foi desativada.` : ""}`,
          };
        }
        case "desligar_responsavel": {
          const contactId = formText(form, "contact_id");
          const patient = await getPatient(db, clinic.clinicId, id);
          const who = (await listPatientContacts(db, clinic.clinicId, id)).find((c) => c.contactId === contactId);
          const moved = await unlinkPatientContact(db, clinic.clinicId, id, contactId);
          const name = who?.fullName ?? "Responsável";
          const extra = moved > 0 ? ` Os avisos de ${moved === 1 ? "1 consulta futura passaram" : `${moved} consultas futuras passaram`} ao principal.` : "";
          return { redirectTo: page, message: `${name} desligado de ${patient.fullName}.${extra}` };
        }
        case "tornar_principal": {
          const contactId = formText(form, "contact_id");
          await setPrimaryContact(db, clinic.clinicId, id, contactId);
          const who = (await listPatientContacts(db, clinic.clinicId, id)).find((c) => c.contactId === contactId);
          return { redirectTo: page, message: `${who?.fullName ?? "Responsável"} agora é o principal.` };
        }
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    () => (formText(form, "acao") === "ligar_responsavel" ? addPage() : page),
  );
};
