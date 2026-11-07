// Passo Cartão (ou Pagamento) da Assinatura (F12.2i): a página do Asaas abre
// em outra aba; esta troca para "Confirmando o pagamento…" e confere a cada
// 5 s (até 10 min) em .../assinatura/pagamento. Confirmado, segue para o
// próximo passo. "Já paguei, conferir agora" confere na hora; "Abrir de novo"
// reabre a página do Asaas. Sem JavaScript, o passo continua funcionando: a
// volta à tela mostra o passo pendente e a conciliação diária confere.

const CHECK_INTERVAL_MS = 5_000;
const MAX_MS = 10 * 60_000;

type CheckResult = { status: "ok"; next: string } | { status: "pending" } | { status: "failed"; message?: string };

function setup(root: HTMLElement): void {
  const idle = root.querySelector<HTMLElement>("[data-payment-idle]");
  const waiting = root.querySelector<HTMLElement>("[data-payment-waiting]");
  const message = root.querySelector<HTMLElement>("[data-payment-message]");
  const opener = root.querySelector<HTMLFormElement | HTMLAnchorElement>("[data-payment-open]");
  const url = root.dataset.checkUrl;
  if (!idle || !waiting || !message || !url) return;
  let timer: number | undefined;
  let startedAt = 0;
  let busy = false;

  const say = (text: string | null) => {
    message.hidden = !text;
    message.textContent = text ?? "";
  };

  const check = async (manual: boolean) => {
    if (busy) return;
    busy = true;
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
      const result = (await response.json()) as CheckResult;
      if (result.status === "ok") {
        window.location.href = result.next;
        return;
      }
      if (result.status === "failed") say(result.message ?? "Não deu para conferir agora. Tente de novo em instantes.");
      else if (manual) say("O Asaas ainda não confirmou. Se acabou de pagar, aguarde alguns segundos.");
    } catch {
      if (manual) say("Sem conexão para conferir. Tente de novo em instantes.");
    } finally {
      busy = false;
    }
  };

  const poll = () => {
    window.clearInterval(timer);
    startedAt = Date.now();
    timer = window.setInterval(() => {
      if (Date.now() - startedAt > MAX_MS) {
        window.clearInterval(timer);
        say("Ainda sem confirmação do Asaas. Quando terminar o pagamento, toque em \"Já paguei, conferir agora\".");
        return;
      }
      void check(false);
    }, CHECK_INTERVAL_MS);
  };

  const showWaiting = () => {
    idle.hidden = true;
    waiting.hidden = false;
    say(null);
    poll();
  };

  if (opener instanceof HTMLFormElement) opener.addEventListener("submit", () => window.setTimeout(showWaiting, 0));
  else opener?.addEventListener("click", () => window.setTimeout(showWaiting, 0));

  root.querySelector("[data-payment-check]")?.addEventListener("click", () => void check(true));
  root.querySelector("[data-payment-reopen]")?.addEventListener("click", () => {
    if (opener instanceof HTMLFormElement) opener.requestSubmit();
    else if (opener instanceof HTMLAnchorElement) window.open(opener.href, "_blank", "noopener");
    poll();
  });

  if (root.dataset.waiting) showWaiting();
}

document.querySelectorAll<HTMLElement>("[data-payment-step]").forEach(setup);
