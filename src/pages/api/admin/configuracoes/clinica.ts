import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { removeClinicLogo, uploadClinicLogo, validateLogoFile } from "../../../../lib/data/config/brand";
import { updateClinicSettings, type ClinicProfile, type ClinicSettingsPatch } from "../../../../lib/data/config/clinic";
import { saveReceptionHours } from "../../../../lib/data/config/receptionHours";
import { runFormAction } from "../../../../lib/data/formAction";
import { formChecked, formOptionalInt, formOptionalText, formText } from "../../../../lib/forms";
import { DESIGNATION_PRESETS, type NounArticle } from "../../../../lib/designation";

// Perfil e identidade da clínica (F4.3). As informações e os limites do bot
// (F9.6a) só vêm no formulário com o bot liberado. Marca das páginas públicas
// (F5.1): site, logo novo (arquivo) ou "remover o logo".
//
// Redesign R9 (cliente, 17/out/2026): a tela tem um formulário por bloco, e
// cada um grava só os próprios campos (`bloco`); um erro num bloco não mexe nos
// outros. Sem `bloco`, grava todos, como antes.
const BLOCKS = ["identificacao", "atendimento", "paginas", "bot_info", "bot_limites", "recepcao"] as const;
type Block = (typeof BLOCKS)[number];

const SAVED: Record<Block | "tudo", string> = {
  identificacao: "Identificação salva.",
  atendimento: "Atendimento salvo.",
  paginas: "Páginas públicas salvas.",
  bot_info: "Informações do bot salvas.",
  bot_limites: "Limites do bot salvos.",
  recepcao: "Horário da recepção salvo.",
  tudo: "Dados da clínica salvos.",
};

export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const hasBot = clinic.features.includes("whatsapp_bot");
  const chosen = formOptionalText(form, "bloco");
  const block = BLOCKS.find((b) => b === chosen) ?? null;
  const has = (b: Block) => block === null || block === b;
  return runFormAction(
    context,
    async () => {
      const patch: ClinicSettingsPatch = {};
      if (has("identificacao")) {
        patch.name = formText(form, "name");
        patch.messageArticle = (formOptionalText(form, "message_article") ?? "da") as ClinicSettingsPatch["messageArticle"];
        // Como a clínica é chamada: uma das opções prontas ou "Outro" (nome e artigo).
        const choice = formText(form, "designation");
        const preset = DESIGNATION_PRESETS.find((d) => d.noun === choice);
        patch.messageNoun = preset ? preset.noun : formText(form, "designation_noun");
        patch.messageNounArticle = preset ? preset.article : (formText(form, "designation_article") as NounArticle);
      }
      if (has("atendimento")) {
        patch.profile = formText(form, "profile") as ClinicProfile;
        patch.timezone = formText(form, "timezone");
        patch.consultationAgeLimitYears = formChecked(form, "age_limit_on") ? formOptionalInt(form, "age_limit") : null;
        if (patch.consultationAgeLimitYears === null && formChecked(form, "age_limit_on")) patch.consultationAgeLimitYears = Number.NaN;
        // Campo vazio vira NaN e cai na validação.
        patch.bookingHorizonDays = formOptionalInt(form, "booking_horizon_days") ?? Number.NaN;
      }
      if (has("paginas")) {
        patch.brandColor = formOptionalText(form, "brand_color");
        patch.websiteUrl = formOptionalText(form, "website_url");
      }
      if (hasBot && has("bot_info")) {
        patch.botPaymentInfo = formOptionalText(form, "bot_payment_info");
        patch.botInsuranceInfo = formOptionalText(form, "bot_insurance_info");
        patch.botNotes = formOptionalText(form, "bot_notes");
      }
      if (hasBot && has("bot_limites")) {
        // Campo vazio vira NaN e cai na validação.
        patch.botMaxFutureAppointments = formOptionalInt(form, "bot_max_future_appointments") ?? Number.NaN;
        patch.botMaxNewPatients = formOptionalInt(form, "bot_max_new_patients") ?? Number.NaN;
        patch.botMaxNoShows = formOptionalInt(form, "bot_max_no_shows") ?? Number.NaN;
      }
      const db = createUserClient(request, cookies);
      // Horário da recepção (F8.5b): só pelo próprio bloco; dia desmarcado = fechado.
      if (hasBot && block === "recepcao") {
        const hours = Array.from({ length: 7 }, (_, day) =>
          formChecked(form, `aberta_${day}`) ? { open: formText(form, `abre_${day}`), close: formText(form, `fecha_${day}`) } : null,
        );
        await saveReceptionHours(db, clinic.clinicId, hours);
        return { redirectTo: "/admin/configuracoes", message: SAVED.recepcao };
      }
      // Logo recusado (formato, tamanho) não salva nada, para não perder metade do formulário.
      const file = has("paginas") ? form?.get("logo") : null;
      const logo = file instanceof File && file.size > 0 ? file : null;
      if (logo) validateLogoFile(logo);
      if (Object.keys(patch).length > 0) await updateClinicSettings(db, clinic.clinicId, patch);
      if (logo) await uploadClinicLogo(db, clinic.clinicId, logo);
      else if (has("paginas") && formChecked(form, "remove_logo")) await removeClinicLogo(db, clinic.clinicId);
      return { redirectTo: "/admin/configuracoes", message: SAVED[block ?? "tudo"] };
    },
    "/admin/configuracoes",
  );
};
