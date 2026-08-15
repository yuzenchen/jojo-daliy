/* JOJO service worker：接收推播 + 點通知開啟 App */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { /* 非 JSON 就用預設 */ }
  e.waitUntil(
    self.registration.showNotification(data.title || "JOJO", {
      body: data.body || "",
      icon: "/api/icon-192.png",
      badge: "/api/icon-192.png",
      lang: "zh-TW",
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) if ("focus" in w) return w.focus();
      return self.clients.openWindow("/");
    })
  );
});
