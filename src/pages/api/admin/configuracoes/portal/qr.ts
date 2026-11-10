import type { APIRoute } from "astro";
import QRCode from "qrcode";
import { createUserClient } from "../../../../../lib/data/clients";
import { loadPortalSettings } from "../../../../../lib/data/config/portal";
import { portalLinksOf } from "../../../../../lib/data/config/portalLinks";

// QR code do link (F3d; R7 "QR code só pelo botão"): o link do cartaz (`?de=cartaz`) da clínica (`p=clinica`) ou de um
// profissional (`p={id}`), em SVG (na janela) ou PNG ("Baixar imagem"). Só o Administrador (área de Configurações).
export const GET: APIRoute = async ({ request, cookies, locals, url }) => {
  const db = createUserClient(request, cookies);
  const settings = await loadPortalSettings(db, locals.clinic!.clinicId);
  const links = portalLinksOf(url, settings);
  const key = url.searchParams.get("p") ?? "clinica";
  const link = key === "clinica" ? links.clinic : links.professionals.get(key);
  if (!link) return new Response("Link não encontrado.", { status: 404 });
  const options = { errorCorrectionLevel: "M" as const, margin: 2 };
  if (url.searchParams.get("formato") === "png") {
    const png = await QRCode.toBuffer(link.posterUrl, { ...options, width: 1024 });
    const name = key === "clinica" ? "qr-clinica" : `qr-${settings.professionals.find((p) => p.id === key)?.slug ?? "profissional"}`;
    return new Response(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename="${name}.png"`, "Cache-Control": "private, no-store" },
    });
  }
  const svg = await QRCode.toString(link.posterUrl, { ...options, type: "svg" });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, no-store" } });
};
