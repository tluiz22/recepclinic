import type { APIRoute } from "astro";
import { createClient } from "../../../../lib/supabase/server";
import { normalizePhone } from "../../../../lib/phone";
import { isOverConsultationAgeLimit } from "../../../../lib/age";
import { todayFortaleza } from "../../../../lib/scheduling/returnVisitDeadline";
import {
  canBeGuardianSelf,
  getConsultationAgeLimit,
  isValidBirthdate,
} from "../../../../lib/patientRegistration";

// Cadastrar paciente (Fase 21). Três formas de ligar o paciente a um
// responsável:
//   - `guardian_self=1` (só 18+): o paciente é o próprio responsável, com o
//     telefone dele. Telefone que já é de um responsável → pergunta se é a
//     mesma pessoa (`confirm_same_person=1` confirma e liga ao cadastro
//     existente, junto dos pacientes que ele já tem);
//   - `guardian_mode=existing`: responsável escolhido na busca (`guardian_id`);
//   - `guardian_mode=new`: nome + telefone; telefone já cadastrado adiciona o
//     paciente ao responsável existente (reativando, se estava excluído).
const FORM_URL = "/admin/pacientes?tab=cadastrar";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();
  const patientFullName = formData.get("patient_full_name")?.toString().trim();
  const patientBirthdate = formData.get("patient_birthdate")?.toString();
  const patientNotes = formData.get("patient_notes")?.toString().trim() || null;
  const guardianSelf = formData.get("guardian_self")?.toString() === "1";
  const guardianMode = formData.get("guardian_mode")?.toString() === "existing" ? "existing" : "new";

  if (!patientFullName || !patientBirthdate) {
    return redirect(`${FORM_URL}&error=1`);
  }

  if (!isValidBirthdate(patientBirthdate)) {
    return redirect(`${FORM_URL}&error=invalid_birthdate`);
  }

  if (guardianSelf && !canBeGuardianSelf(patientBirthdate)) {
    return redirect(`${FORM_URL}&error=minor_needs_guardian`);
  }

  const supabase = createClient(request, cookies);
  let guardianId: string;

  if (guardianSelf) {
    const phone = normalizePhone(formData.get("self_phone")?.toString().trim() ?? "");
    if (!phone) return redirect(`${FORM_URL}&error=invalid_phone`);

    const { data: existingGuardian, error: fetchError } = await supabase
      .from("guardians")
      .select("id, full_name, is_active")
      .eq("phone", phone)
      .maybeSingle();
    if (fetchError) return redirect(`${FORM_URL}&error=1`);

    if (existingGuardian) {
      const confirmSamePerson =
        formData.get("confirm_same_person")?.toString() === "1" &&
        formData.get("guardian_id")?.toString() === existingGuardian.id;

      if (!confirmSamePerson) {
        const params = new URLSearchParams({
          tab: "cadastrar",
          confirm_self: "1",
          guardian_id: existingGuardian.id,
          guardian_name: existingGuardian.full_name,
          full_name: patientFullName,
          birthdate: patientBirthdate,
          phone,
        });
        if (patientNotes) params.set("notes", patientNotes);
        return redirect(`/admin/pacientes?${params.toString()}`);
      }

      // No máximo um "próprio responsável" por responsável (índice único
      // parcial da 0026) — inclusive inativo, que pode ser reativado.
      const { data: currentSelf } = await supabase
        .from("patients")
        .select("id")
        .eq("guardian_id", existingGuardian.id)
        .eq("is_guardian_self", true)
        .maybeSingle();
      if (currentSelf) return redirect(`${FORM_URL}&error=self_exists`);

      if (!existingGuardian.is_active) {
        const { error } = await supabase.from("guardians").update({ is_active: true }).eq("id", existingGuardian.id);
        if (error) return redirect(`${FORM_URL}&error=1`);
      }
      guardianId = existingGuardian.id;
    } else {
      const { data: newGuardian, error } = await supabase
        .from("guardians")
        .insert({ full_name: patientFullName, phone })
        .select("id")
        .single();
      if (error || !newGuardian) return redirect(`${FORM_URL}&error=1`);
      guardianId = newGuardian.id;
    }
  } else if (guardianMode === "existing") {
    const selectedId = formData.get("guardian_id")?.toString();
    if (!selectedId) return redirect(`${FORM_URL}&error=guardian_required`);

    const { data: guardian } = await supabase.from("guardians").select("id").eq("id", selectedId).maybeSingle();
    if (!guardian) return redirect(`${FORM_URL}&error=not_found`);
    guardianId = guardian.id;
  } else {
    const guardianFullName = formData.get("guardian_full_name")?.toString().trim();
    const guardianPhoneRaw = formData.get("guardian_phone")?.toString().trim();
    if (!guardianFullName || !guardianPhoneRaw) return redirect(`${FORM_URL}&error=1`);

    const guardianPhone = normalizePhone(guardianPhoneRaw);
    if (!guardianPhone) return redirect(`${FORM_URL}&error=invalid_phone`);

    const { data: existingGuardian, error: guardianFetchError } = await supabase
      .from("guardians")
      .select("id, is_active")
      .eq("phone", guardianPhone)
      .maybeSingle();
    if (guardianFetchError) return redirect(`${FORM_URL}&error=1`);

    if (!existingGuardian) {
      const { data: newGuardian, error: guardianInsertError } = await supabase
        .from("guardians")
        .insert({ full_name: guardianFullName, phone: guardianPhone })
        .select("id")
        .single();
      if (guardianInsertError || !newGuardian) return redirect(`${FORM_URL}&error=1`);
      guardianId = newGuardian.id;
    } else {
      if (!existingGuardian.is_active) {
        // Telefone reaproveitado de um responsável excluído logicamente — reativa em vez de bloquear.
        const { error: reactivateError } = await supabase
          .from("guardians")
          .update({ is_active: true })
          .eq("id", existingGuardian.id);
        if (reactivateError) return redirect(`${FORM_URL}&error=1`);
      }
      guardianId = existingGuardian.id;
    }
  }

  const { error: patientInsertError } = await supabase.from("patients").insert({
    guardian_id: guardianId,
    full_name: patientFullName,
    birthdate: patientBirthdate,
    notes: patientNotes,
    is_guardian_self: guardianSelf,
  });

  if (patientInsertError) {
    return redirect(`${FORM_URL}&error=${patientInsertError.code === "23505" ? "self_exists" : "1"}`);
  }

  // Aviso (sem bloquear) de idade limite para consulta: o paciente pode ser
  // de exame.
  const params = new URLSearchParams({ tab: "pacientes", created: patientFullName });
  const ageLimit = await getConsultationAgeLimit(supabase);
  if (isOverConsultationAgeLimit(patientBirthdate, todayFortaleza(), ageLimit)) {
    params.set("age_limit_warning", "1");
  }
  return redirect(`/admin/pacientes?${params.toString()}`);
};
