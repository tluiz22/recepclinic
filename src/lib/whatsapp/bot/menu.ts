// Menu principal — fora do router.ts para os fluxos (ex. booking.ts) poderem
// mandar o menu sem importar o router, que já importa os fluxos.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendInteractiveListMessage } from "../client";
import { sendAndLog } from "./shared";
import * as texts from "./messages";

export async function sendMenu(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null
): Promise<void> {
  const body = texts.menuBodyText();
  await sendAndLog(supabase, guardianId, "bot_menu", body, () =>
    sendInteractiveListMessage({
      to: guardianPhone,
      bodyText: body,
      buttonText: "Escolher opção",
      sections: texts.menuSections(),
    })
  );
}
