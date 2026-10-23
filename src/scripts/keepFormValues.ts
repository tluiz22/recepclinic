// Formulário que volta com erro mantém o que foi digitado (auditoria de
// frontend, F-02 e F-03). As rotas `/api/admin/...` respondem com um
// redirecionamento e só o aviso; aqui o navegador guarda os campos do
// formulário enviado e, se a tela seguinte for a mesma e mostrar aviso de erro,
// devolve os valores. Guardado só na aba (sessionStorage), lido e apagado na
// carga seguinte, com erro ou não. Senha, arquivo e campos escondidos ficam de
// fora (os escondidos são do servidor, como a `acao`). No fim, aponta o campo
// que falhou (ver `pointToError`).

const KEY = "rc_form_enviado";

type Field = { key: string; value?: string; checked?: boolean; selected?: string[] };
type Saved = { path: string; action: string; index: number; fields: Field[] };

const SKIP = new Set(["hidden", "file", "password", "submit", "button", "reset", "image"]);

function formKey(form: HTMLFormElement): { action: string; index: number } {
  const action = form.getAttribute("action") ?? "";
  const same = [...document.querySelectorAll<HTMLFormElement>("form[method='POST' i]")].filter(
    (f) => (f.getAttribute("action") ?? "") === action,
  );
  return { action, index: same.indexOf(form) };
}

// Campos com nome, na ordem do formulário; nome repetido (ex.: dois "payer_cpf")
// leva o número da ocorrência.
function namedFields(form: HTMLFormElement): [string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement][] {
  const seen = new Map<string, number>();
  const list: [string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement][] = [];
  for (const el of form.elements) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
    if (!el.name || SKIP.has(el.type)) continue;
    const n = seen.get(el.name) ?? 0;
    seen.set(el.name, n + 1);
    list.push([`${el.name}#${n}`, el]);
  }
  return list;
}

function rememberForm(form: HTMLFormElement): void {
  if ((form.getAttribute("method") ?? "").toUpperCase() !== "POST") return;
  const fields: Field[] = namedFields(form).map(([key, el]) => {
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return { key, checked: el.checked };
    if (el instanceof HTMLSelectElement && el.multiple) return { key, selected: [...el.selectedOptions].map((o) => o.value) };
    return { key, value: el.value };
  });
  const saved: Saved = { path: location.pathname, ...formKey(form), fields };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Sem armazenamento (aba privada, bloqueado): segue sem guardar.
  }
}

function restore(): HTMLFormElement | null {
  let saved: Saved | null = null;
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    saved = raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
  if (!saved || saved.path !== location.pathname) return null;
  if (!document.querySelector("[data-flash='error']")) return null;
  const form = [...document.querySelectorAll<HTMLFormElement>("form[method='POST' i]")].filter(
    (f) => (f.getAttribute("action") ?? "") === saved!.action,
  )[saved.index];
  if (!form) return null;
  // Formulário dentro de um cartão recolhido (R6, "Editar"): abre para o erro aparecer.
  for (let box = form.closest("details"); box; box = box.parentElement?.closest("details") ?? null) box.open = true;
  const byKey = new Map(saved.fields.map((f) => [f.key, f]));
  const changed: Element[] = [];
  for (const [key, el] of namedFields(form)) {
    const field = byKey.get(key);
    if (!field) continue;
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      if (field.checked === undefined || el.checked === field.checked) continue;
      el.checked = field.checked;
    } else if (el instanceof HTMLSelectElement && el.multiple) {
      if (!field.selected) continue;
      for (const option of el.options) option.selected = field.selected.includes(option.value);
    } else {
      if (field.value === undefined || el.value === field.value) continue;
      el.value = field.value;
    }
    changed.push(el);
  }
  // Avisa os scripts da tela (ex.: o Pagamento mostra os campos de quem pagou).
  for (const el of changed) {
    if (el.hasAttribute("data-autosubmit")) continue;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return form;
}

// Erro de validação (auditoria, A-02): liga a mensagem aos campos que falharam
// (`aria-invalid` e `aria-describedby`) e põe o foco no primeiro; sem campo
// achado, o foco vai para a própria mensagem. O servidor manda os nomes da
// camada de dados ("displayName", "priceCents"); o formulário usa "display_name"
// e "price". Com a mensagem de cada campo (ajuda contextual, 23/out/2026), ela
// aparece embaixo do campo, no lugar da orientação ligada a ele, e o aviso do
// alto fica curto; se alguma não achar o campo, o aviso do alto segue com todas.
const FIELD_ERROR = "mt-1.5 text-sm font-semibold text-danger";

function readMessages(): Record<string, string> {
  try {
    const raw = document.querySelector<HTMLElement>("[data-flash='error']")?.dataset.fieldMessages;
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Onde a mensagem entra: depois do grupo (rádios, caixas) ou da linha do campo, nunca no meio de uma linha. */
function errorAnchor(el: HTMLElement): HTMLElement {
  if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) {
    return el.closest<HTMLElement>("fieldset") ?? el.closest("label")?.parentElement ?? el;
  }
  const parent = el.parentElement;
  if (parent && !(parent instanceof HTMLFormElement) && parent.tagName !== "LABEL" && /flex|grid/.test(getComputedStyle(parent).display) && parent.children.length > 1) {
    return parent;
  }
  return el;
}

function showFieldError(el: HTMLElement, text: string): string {
  const id = `${el.id || el.getAttribute("name")}-erro`;
  let box = document.getElementById(id);
  if (!box) {
    box = document.createElement("p");
    box.id = id;
    box.className = FIELD_ERROR;
    box.setAttribute("data-field-error", "");
    const anchor = errorAnchor(el);
    if (anchor.tagName === "FIELDSET") anchor.append(box);
    else anchor.after(box);
  }
  box.textContent = text;
  // A orientação ligada ao campo (Field: "{id}-orientacao") sai enquanto o erro está na tela.
  const hint = el.id ? document.getElementById(`${el.id}-orientacao`) : null;
  if (hint) hint.hidden = true;
  el.addEventListener(
    "input",
    () => {
      box?.remove();
      if (hint) hint.hidden = false;
    },
    { once: true },
  );
  return id;
}

function pointToError(form: HTMLFormElement | null): void {
  // Formulário num cartão "Editar" (vários por tela, como os blocos da Clínica):
  // a mensagem vai para dentro dele, senão fica no topo, fora da vista (teste da
  // R9, QA-01).
  const flash = document.querySelector<HTMLElement>("main [data-flash='error']");
  if (form && flash && form.closest("[data-edit-card]") && !form.contains(flash)) {
    flash.querySelector("[data-form-error]")?.classList.remove("mt-4");
    form.prepend(flash);
  }
  const message = document.querySelector<HTMLElement>("main [data-form-error]");
  if (!message) return;
  message.id ||= "erro-do-formulario";
  const names = (document.querySelector<HTMLElement>("[data-flash='error']")?.dataset.fields ?? "").split(" ").filter(Boolean);
  const messages = readMessages();
  const scope = form ?? document.querySelector("main");
  const invalid: HTMLElement[] = [];
  let placed = 0;
  for (const name of names) {
    const snake = name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    for (const candidate of [name, snake, snake.replace(/_cents$/, "")]) {
      // Nome repetido (ex.: os "payer_cpf" do Pagamento): o que está à vista.
      const el = [...(scope?.querySelectorAll<HTMLInputElement>(`[name='${candidate}']:not([type=hidden]):not(:disabled)`) ?? [])].find(
        (input) => !input.closest("[hidden]"),
      );
      if (!el) continue;
      const text = typeof messages[name] === "string" ? messages[name] : "";
      const own = text ? showFieldError(el, text) : null;
      if (own) placed++;
      el.setAttribute("aria-invalid", "true");
      const described = (el.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id && !id.endsWith("-orientacao"));
      el.setAttribute("aria-describedby", [own, ...described, message.id].filter(Boolean).join(" "));
      el.addEventListener("input", () => el.removeAttribute("aria-invalid"), { once: true });
      invalid.push(el);
      break;
    }
  }
  const total = Object.keys(messages).length;
  if (total > 0 && placed === total) {
    message.textContent = total === 1 ? "Não salvamos: confira o campo marcado." : `Não salvamos: confira os ${total} campos marcados.`;
  }
  // No meio da tela: no celular, as barras fixas de baixo cobririam um campo
  // perto da borda que o navegador acha que já está à vista (teste da R6, QA-02).
  const target = invalid[0] ?? message;
  target.scrollIntoView({ block: "center" });
  // Mensagem dentro do cartão, acima do campo (QA-01 da R9): se os dois cabem
  // juntos, sobe até a mensagem, com folga para as barras de cima e de baixo.
  if (invalid[0] && form?.contains(message)) {
    const top = message.getBoundingClientRect().top;
    const span = invalid[0].getBoundingClientRect().bottom - top;
    if (top < 80 && span < innerHeight - 180) scrollBy({ top: top - 80 });
  }
  target.focus({ preventScroll: true });
}

// Aponta o erro depois dos scripts da tela, que mostram ou escondem blocos a
// partir dos valores devolvidos (ex.: os campos de quem pagou no Pagamento;
// teste da R5, QA-01). Os scripts de módulo rodam antes do DOMContentLoaded.
const restored = restore();
const point = () => setTimeout(() => pointToError(restored));
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", point, { once: true });
else point();

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  // Envio cancelado por outro script (ex.: o diálogo de confirmação) não conta.
  setTimeout(() => {
    if (!event.defaultPrevented) rememberForm(form);
  });
});

// O diálogo de confirmação envia com `form.submit()`, que não dispara "submit".
document.addEventListener("rc:enviar", (event) => {
  if (event.target instanceof HTMLFormElement) rememberForm(event.target);
});
