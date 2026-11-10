// 오프라인 실행과 교차 출처 격리를 맡는 서비스 워커.
// 엔진의 스레드 기능은 COOP, COEP 헤더가 필요한데 GitHub Pages는 헤더를 못 넣으므로 여기서 붙인다.
const VERSION = "janggi-6";
const FILES = [
  "./", "index.html", "style.css", "fonts.css", "board.js", "sound.js", "study.js", "app.js",
  "core/main.js", "core/api.js", "core/commentary.js", "core/engine.js", "core/intent.js", "core/review.js", "core/rules.js", "core/store.js",
  "vendor/ffish.js", "vendor/ffish.wasm", "vendor/stockfish.js", "vendor/stockfish.wasm", "vendor/stockfish.worker.js",
  "data/levels.json", "data/puzzles.json", "data/openings.json", "engine/janggi-9991472750de.nnue",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function isolated(response) {
  if (response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return isolated(cached);
    return isolated(await fetch(request));
  })());
});
