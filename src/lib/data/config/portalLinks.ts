import { linkForPlace, portalPublicUrl, professionalPublicUrl } from "../../portal";
import type { PortalSettings } from "./portal";

// Os links públicos da tela Configurações › Portal (F3d): o da clínica e o de cada profissional, a partir do
// endereço do painel (teste. → agendar-teste., app. → agendar.).

export type PublicLink = { key: string; label: string; url: string; posterUrl: string };

export function portalLinksOf(appUrl: URL, settings: PortalSettings): { clinic: PublicLink | null; professionals: Map<string, PublicLink> } {
  if (!settings.slug) return { clinic: null, professionals: new Map() };
  const clinicUrl = portalPublicUrl(appUrl, settings.slug);
  const clinic = { key: "clinica", label: "Link da clínica", url: clinicUrl, posterUrl: linkForPlace(clinicUrl, "cartaz") };
  const professionals = new Map(
    settings.professionals.map((p) => {
      const url = professionalPublicUrl(appUrl, settings.slug!, p.slug);
      return [p.id, { key: p.id, label: p.name, url, posterUrl: linkForPlace(url, "cartaz") }];
    }),
  );
  return { clinic, professionals };
}
