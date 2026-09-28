// Formatação do WhatsApp (`*negrito*`, `_itálico_`, `~riscado~`) convertida
// para HTML — Fase 18. O preparo dos exames é escrito pela médica já no
// estilo do WhatsApp (é o mesmo texto que o bot envia na conversa), e as
// telas/páginas do site precisam mostrar esse texto com a mesma aparência.
//
// Usado no servidor (Astro) e no navegador (prévia do cadastro), por isso
// sem dependências. O HTML de entrada é sempre escapado antes — o resultado
// só contém <strong>/<em>/<s> gerados aqui, seguro para `set:html`.
// Quebras de linha não viram <br>: o contêiner usa `white-space: pre-line`.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Mesma regra do WhatsApp: o marcador precisa estar colado no texto
// (`*negrito*` sim, `* negrito *` não), dentro da mesma linha, e não pode
// estar no meio de uma palavra (evita pegar `_` de links, ex.: `a_b_c`).
function applyMarker(html: string, marker: string, tag: string): string {
  const m = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${m}([^\\s${m}](?:[^${m}\\n]*[^\\s${m}])?)${m}(?=$|[^\\p{L}\\p{N}])`, "gmu");
  return html.replace(pattern, `$1<${tag}>$2</${tag}>`);
}

export function whatsAppTextToHtml(text: string): string {
  let html = escapeHtml(text);
  html = applyMarker(html, "*", "strong");
  html = applyMarker(html, "_", "em");
  html = applyMarker(html, "~", "s");
  return html;
}

// Resumo de uma linha (tabela de tipos de exame): primeira linha com texto,
// sem os marcadores, cortada em `maxLength` caracteres.
export function whatsAppTextSummary(text: string, maxLength = 60): string {
  const firstLine = text
    .split("\n")
    .map((line) => line.replace(/[*_~]/g, "").trim())
    .find((line) => line.length > 0) ?? "";
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength - 1).trimEnd()}…` : firstLine;
}

// Limite do preparo: o WhatsApp aceita até 4096 caracteres por mensagem de
// texto, e o bot manda o preparo + a linha do link na mesma mensagem.
export const MAX_PREPARATION_LENGTH = 3800;

// Normaliza o texto vindo do formulário: o textarea envia `\r\n`; tira
// espaços sobrando no começo/fim, mas mantém as linhas em branco do meio
// (fazem parte da formatação da médica).
export function normalizeMultilineText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}
