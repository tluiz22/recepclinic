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

function toHex(channels: number[]): string {
  return `#${channels.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function channelsOf(hex: string): number[] {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
}

/** Mistura `hex` com `other` (0 = só `hex`, 1 = só `other`). */
function mix(hex: string, other: string, amount: number): string {
  const a = channelsOf(hex);
  const b = channelsOf(other);
  return toHex(a.map((c, i) => c + (b[i] - c) * amount));
}

function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (la + 0.05) / (lb + 0.05);
}

/**
 * Cor da clínica para texto e bordas sobre o branco (redesign R11): a própria
 * cor quando ela tem contraste (4,5:1, WCAG AA); senão, escurecida até ter.
 */
export function inkOnWhite(hex: string): string {
  for (let amount = 0; amount <= 1; amount += 0.05) {
    const color = mix(hex, "#000000", amount);
    if (contrast(color, "#FFFFFF") >= 4.5) return color;
  }
  return "#000000";
}

/**
 * Fundo claro do horário escolhido (redesign R11): a cor `ink` misturada com
 * 86% de branco, ou mais clara, até o `ink` ter 4,5:1 sobre ele (teste da R11,
 * QA-01: no verde padrão, ficava em 4,34:1). Sempre termina, porque o `ink`
 * já tem 4,5:1 sobre o branco.
 */
export function tintFor(ink: string): string {
  for (let amount = 0.86; amount < 1; amount += 0.02) {
    const tint = mix(ink, "#FFFFFF", amount);
    if (contrast(ink, tint) >= 4.5) return tint;
  }
  return "#FFFFFF";
}

/**
 * Variáveis CSS da cor da clínica nas páginas do paciente (redesign R11,
 * cliente, 17/out/2026): `--clinic` (topo, botão, dia e horário escolhidos),
 * `--clinic-text` (texto sobre ela), `--clinic-ink` (texto e bordas sobre o
 * branco) e `--clinic-tint` (fundo claro do horário escolhido). As classes
 * `bg-clinic`, `text-clinic-ink` etc. vêm de src/styles/global.css.
 */
export function clinicColorStyle(hex: string): string {
  const ink = inkOnWhite(hex);
  return [
    `--clinic: ${hex}`,
    `--clinic-text: ${readableTextColor(hex)}`,
    `--clinic-ink: ${ink}`,
    `--clinic-tint: ${tintFor(ink)}`,
  ].join("; ");
}
