// Recaptura das imagens da Central de Ajuda (public/ajuda/*.png), com o ponto principal destacado em vermelho.
// Regra do projeto (CLAUDE.md): mudou uma tela que tem captura, anotar em docs/capturas-pendentes.md e pedir autorização
// ao cliente; só ele manda recapturar.
//
// Uso:  npm run dev   (outro terminal, com o banco local no ar: npm run db:start)
//       npm run ajuda:capturas            tudo
//       npm run ajuda:capturas -- config-horarios marcar     só estas (nomes da lista abaixo)
//       npm run ajuda:capturas -- --pendentes                 só as de docs/capturas-pendentes.md (e esvazia a fila)
// Primeira vez na máquina:  npx playwright install chromium
// Variáveis: BASE_URL (padrão http://localhost:4321).
//
// Os dados vêm do seed local (clínica "Clínica Exemplo Saúde", tudo fictício). Depois de recapturar, conferir
// as imagens a olho e rodar `npm test` (um teste confere que todo arquivo citado existe e que nenhum sobra).
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:4321";
const OUT = new URL("../public/ajuda/", import.meta.url).pathname;
const LOGIN = { email: "admin@exemplo-saude.local", password: "recepclinic-local" };
// A agenda do seed começa na segunda-feira da semana seguinte à de `supabase db reset`.
const agendaDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
};

// [nome do arquivo, caminho, textos a destacar (começam com…), seletores CSS a destacar]
export const CAPTURAS = [
  ["inicio", "/admin/dashboard", ["Precisa de você"], []],
  ["agenda-dia", "/admin/agenda", ["Marcar", "Bloquear"], []],
  ["marcar", "/admin/agenda/marcar", ["Paciente"], []],
  ["bloquear", "/admin/agenda/bloquear", ["Dia todo"], []],
  ["bloqueios", "/admin/agenda/bloqueios", [], []],
  ["pacientes", "/admin/pacientes", ["Novo paciente"], ["input[type=search],input[name=q]"]],
  ["paciente-novo", "/admin/pacientes/novo", [], ["button[type=submit]"]],
  ["resumo-do-dia", "/admin/consultas", ["Lembretes", "A registrar"], []],
  ["atendimento", "/admin/atendimento", [], []],
  // Conversa da Júlia aberta (criada num teste local, fora do seed; se faltar, usar outra só com mensagem do
  // paciente: a do Carlos, no seed, mostra "Não enviada"). Com a Central ligada, /admin/atendimento abre Conversas:
  // a captura "atendimento" é da tela sem a Central (refazer desligando a Central da clínica do seed).
  ["conversas", "/admin/conversas?conversa=%2B5584977001122", [], []],
  ["relacionamento", "/admin/pacientes/para-contatar", ["Retomar contato"], []],
  ["metricas", "/admin/metricas", [], []],
  ["financeiro", "/admin/financeiro", ["Falta CPF"], []],
  ["config-clinica", "/admin/configuracoes", ["Identificação", "Atendimento"], []],
  ["config-profissionais", "/admin/configuracoes/profissionais", ["Novo profissional"], []],
  ["config-locais", "/admin/configuracoes/locais", ["Novo local"], []],
  ["config-agendas", "/admin/configuracoes/agendas", ["Nova agenda"], []],
  ["config-servicos", "/admin/configuracoes/servicos", ["Novo serviço"], []],
  // O id da agenda muda a cada seed: "?agenda=@Nome" escolhe o profissional pelo nome (ver abaixo).
  ["config-horarios", "/admin/configuracoes/horarios?agenda=@Dra. Helena Costa", [], ["[data-agenda-owner]"]],
  ["config-feriados", "/admin/configuracoes/feriados", ["Adicionar"], []],
  ["config-convenios", "/admin/configuracoes/convenios", ["Novo plano"], []],
  ["config-lembretes", "/admin/configuracoes/lembretes", [], []],
  ["config-mensagens", "/admin/configuracoes/mensagens", [], []],
  ["config-whatsapp", "/admin/configuracoes/whatsapp", ["Conectar"], []],
  ["config-nota-fiscal", "/admin/configuracoes/nota-fiscal", ["Dados fiscais"], []],
  ["equipe", "/admin/configuracoes/equipe", ["Convidar pessoa"], []],
];

function highlight([texts, selectors]) {
  const mark = (el) => {
    el.style.outline = "3px solid #e11d48";
    el.style.outlineOffset = "3px";
    el.style.borderRadius = el.style.borderRadius || "8px";
  };
  for (const text of texts) {
    const found = [...document.querySelectorAll("a,button,summary,label,h2,h3,legend,span,p")].filter(
      (e) => !e.closest("aside") && e.textContent.trim().replace(/\s+/g, " ").startsWith(text) && e.textContent.trim().length < text.length + 40,
    );
    const innermost = found.filter((e) => !found.some((o) => o !== e && e.contains(o)));
    if (innermost[0]) mark(innermost[0]);
  }
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) mark(el);
  }
}

const QUEUE = new URL("../docs/capturas-pendentes.md", import.meta.url).pathname;
const args = process.argv.slice(2);
const fromQueue = args.includes("--pendentes");
// Uma linha pode listar várias capturas antes do " — " (ex.: o menu de Configurações): todas entram.
const queued = fromQueue
  ? [...new Set([...readFileSync(QUEUE, "utf8").matchAll(/^- (`.+?) — /gm)].flatMap((m) => [...m[1].matchAll(/`([a-z-]+)`/g)].map((n) => n[1])))]
  : [];
if (fromQueue && queued.length === 0) {
  console.log("Nenhuma captura pendente em docs/capturas-pendentes.md.");
  process.exit(0);
}
const wanted = fromQueue ? queued : args;
const unknown = wanted.filter((name) => !CAPTURAS.some(([n]) => n === name));
if (unknown.length) {
  console.error(`Nome(s) desconhecido(s): ${unknown.join(", ")}\nDisponíveis: ${CAPTURAS.map(([n]) => n).join(", ")}`);
  process.exit(1);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: "pt-BR" });
  await page.goto(`${BASE}/admin/login`).catch(() => {
    console.error(`Não consegui abrir ${BASE}. O "npm run dev" está rodando?`);
    process.exit(1);
  });
  await page.fill("input[type=email],input[name=email]", LOGIN.email);
  await page.fill("input[type=password]", LOGIN.password);
  await Promise.all([page.waitForURL(/\/admin\/(dashboard|escolher)/), page.click("button[type=submit]")]);

  let done = 0;
  for (const [name, path, texts, selectors] of CAPTURAS) {
    if (wanted.length && !wanted.includes(name)) continue;
    let url = BASE + path;
    const byName = path.match(/\?agenda=@(.+)$/);
    if (byName) {
      await page.goto(BASE + path.replace(/\?.*$/, ""), { waitUntil: "networkidle" });
      const id = await page.evaluate(
        // Horários escolhe pelo profissional (cliente, 08/nov/2026): o link dele leva o ?agenda=.
        (label) =>
          new URL([...document.querySelectorAll("[data-owner-option] a")].find((a) => a.firstChild?.textContent.trim() === label)?.href ?? "http://x/")
            .searchParams.get("agenda"),
        byName[1],
      );
      if (!id) {
        console.error(`✗ ${name}: agenda "${byName[1]}" não encontrada`);
        process.exitCode = 1;
        continue;
      }
      url = `${BASE}${path.replace(/\?.*$/, "")}?agenda=${id}`;
    }
    const response = await page.goto(url, { waitUntil: "networkidle" });
    if (!response || response.status() >= 400) {
      console.error(`✗ ${name}: ${path} respondeu ${response?.status()}`);
      process.exitCode = 1;
      continue;
    }
    // "Como funciona?" lembrado como aberto no navegador esconderia a tela: começa sempre fechado.
    await page.evaluate(() => document.querySelectorAll("details.how-toggle[open]").forEach((d) => d.removeAttribute("open")));
    await page.evaluate(highlight, [texts, selectors]);
    // O recorte tira a barra inferior fixa do celular, que aparece cortada no computador.
    await page.screenshot({ path: `${OUT}${name}.png`, clip: { x: 0, y: 0, width: 1280, height: 770 } });
    console.log(`✓ ${name}`);
    done += 1;
  }
  console.log(`${done} captura(s) em public/ajuda/. Confira as imagens e rode npm test.`);
  if (fromQueue && !process.exitCode) {
    // Esvazia a fila: tira as linhas das capturas feitas.
    const text = readFileSync(QUEUE, "utf8").replace(/^- `[a-z-]+`.*\n/gm, "");
    writeFileSync(QUEUE, text.replace(/## Pendentes\n\s*$/, "## Pendentes\n\n(nenhuma)\n").replace(/## Pendentes\n\n+(?!\(nenhuma\))$/, "## Pendentes\n\n(nenhuma)\n"));
  }
} finally {
  await browser.close();
}
