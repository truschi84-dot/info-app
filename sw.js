// Service Worker nur fuer Push-Nachrichten. Er speichert absichtlich NICHTS im
// Cache und faengt keine Anfragen ab - so kann er nie eine alte Fassung der App
// ausliefern. Eingebunden in js/hinweise.js mit updateViaCache: "none".

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { text: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.titel || "Info-App", {
    body: d.text || "",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: d.tag,
    data: { url: d.url || "./" },
  }));
});

// Antippen: offenes App-Fenster nach vorn holen und den Eintrag zeigen,
// sonst die App mit der Adresse des Eintrags oeffnen.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const ziel = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil((async () => {
    const fenster = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const f of fenster) {
      if ("focus" in f) {
        f.postMessage({ art: "oeffnen", url: ziel });
        return f.focus();
      }
    }
    return self.clients.openWindow(ziel);
  })());
});
