// Notificações do atendimento humano (F8.5c): o navegador acorda este arquivo
// quando chega um aviso do RecepClinic, mesmo com o painel fechado. Um toque
// abre o endereço do aviso (a conversa no WhatsApp ou a tela Atendimento).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "RecepClinic", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "RecepClinic", {
      body: data.body || "",
      icon: "/admin-icon-192.png",
      badge: "/admin-icon-192.png",
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || "/admin/atendimento" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/admin/atendimento", self.location.origin).href;
  event.waitUntil(
    (async () => {
      // Tela do painel já aberta: usa ela; senão, abre (o link do WhatsApp abre o app).
      if (url.startsWith(self.location.origin)) {
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        const open = windows.find((client) => client.url.startsWith(self.location.origin));
        if (open) {
          await open.navigate(url).catch(() => undefined);
          return open.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
