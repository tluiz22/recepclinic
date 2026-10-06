// Texto legível sobre a cor da clínica (topo das páginas públicas, F5.1):
// branco nas cores escuras, quase preto nas claras (contraste WCAG).

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const DARK_TEXT = "#0F172A";
export const LIGHT_TEXT = "#FFFFFF";

/** Cor do texto (#RRGGBB) com mais contraste sobre o fundo `background` (#RRGGBB). */
export function readableTextColor(background: string): string {
  const bg = luminance(background);
  const withWhite = 1.05 / (bg + 0.05);
  const withDark = (bg + 0.05) / (luminance(DARK_TEXT) + 0.05);
  return withWhite >= withDark ? LIGHT_TEXT : DARK_TEXT;
}
