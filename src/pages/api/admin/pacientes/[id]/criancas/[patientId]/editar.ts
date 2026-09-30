import type { APIRoute } from "astro";
import { createClient } from "../../../../../../../lib/supabase/server";
import { canBeGuardianSelf, isValidBirthdate } from "../../../../../../../lib/patientRegistration";

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const { id: guardianId, patientId } = params;
  const formData = await request.formData();
  const fullName = formData.get("full_name")?.toString().trim();
  const birthdate = formData.get("birthdate")?.toString();
  const notes = formData.get("notes")?.toString().trim() || null;

  if (!guardianId || !patientId || !fullName || !birthdate) {
    return redirect(`/admin/pacientes/${guardianId}?error=1`);
  }

  const editUrl = `/admin/pacientes/${guardianId}/criancas/${patientId}/editar`;

  if (!isValidBirthdate(birthdate)) {
    return redirect(`${editUrl}?error=invalid_birthdate`);
  }

  const supabase = createClient(request, cookies);

  const { data: patient } = await supabase
    .from("patients")
    .select("is_guardian_self")
    .eq("id", patientId)
    .eq("guardian_id", guardianId)
    .maybeSingle();

  if (!patient) {
    return redirect(`/admin/pacientes/${guardianId}?error=not_found`);
  }

  // Próprio responsável só com 18+ (Fase 21): a data nova não pode torná-lo
  // menor de idade.
  if (patient.is_guardian_self && !canBeGuardianSelf(birthdate)) {
    return redirect(`${editUrl}?error=minor_needs_guardian`);
  }

  const { error } = await supabase
    .from("patients")
    .update({ full_name: fullName, birthdate, notes })
    .eq("id", patientId)
    .eq("guardian_id", guardianId);

  if (error) {
    return redirect(`${editUrl}?error=1`);
  }

  // Paciente e responsável são a mesma pessoa: o nome acompanha.
  if (patient.is_guardian_self) {
    await supabase.from("guardians").update({ full_name: fullName }).eq("id", guardianId);
  }

  return redirect(`/admin/pacientes/${guardianId}`);
};
