/**
 * Ravi Narayana ERP & Delivery PWA Service Worker
 * Version: 1.0.0 (Shell v1)
 *
 * MANDATORY SECURITY INVARIANTS:
 * 1. STRICT NON-CACHING FOR ALL AUTHENTICATED API DATA:
 *    - /api/* is strictly NEVER cached.
 *    - Sensitive financial records, KYC documents, resident dossier data, and delivery
 *      tokens are NEVER written to CacheStorage.
 * 2. SAFE STATIC SHELL CACHING ONLY:
 *    - Only pre-caches the branded /offline fallback page and static assets (icons, logo).
 *    - Static Next.js compiled chunks (_next/static/*) are served via Stale-While-Revalidate.
 * 3. GRACEFUL OFFLINE NAVIGATION:
 *    - Offline navigation requests fall back to the pre-cached /offline view.
 */

const CACHE_NAME = "rn-erp-shell-v3"; // v3: transparent logos and icons (2026-11-10)

const PRECACHE_ASSETS = [
  "/offline",
  "/logo.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-icon-512.png",
  "/icons/apple-touch-icon.png",
  "/manifest.webmanifest",
];

// URLs that must NEVER be intercepted or cached
function isForbiddenCacheUrl(url) {
  const pathname = url.pathname.toLowerCase();

  // All API calls must go over live network
  if (pathname.startsWith("/api/")) return true;

  // Sensitive paths
  if (
    pathname.includes("/auth") ||
    pathname.includes("/storage") ||
    pathname.includes("/documents") ||
    pathname.includes("/kyc") ||
    pathname.includes("/closing")
  ) {
    return true;
  }

  return false;
}

// Installation event: Pre-cache static shell & offline fallback
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn("[PWA SW] Pre-caching completed with non-fatal warning:", err);
      })
  );
});

// Activation event: Purge stale cache generations & claim clients immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              return caches.delete(name);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event: Apply strictly partitioned caching policies
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. Only handle GET requests; all mutations bypass SW entirely
  if (request.method !== "GET") {
    return;
  }

  // 2. Strict Security Boundary: NEVER cache API responses or sensitive endpoints
  if (isForbiddenCacheUrl(url)) {
    return; // Pass through to standard browser network fetch
  }

  // 3. Navigation requests (Page loads)
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        // When device is offline, serve the pre-cached offline fallback
        const cache = await caches.open(CACHE_NAME);
        const cachedFallback = await cache.match("/offline");
        if (cachedFallback) {
          return cachedFallback;
        }
        return new Response("You are currently offline. Please reconnect to continue.", {
          status: 503,
          headers: { "Content-Type": "text/plain" },
        });
      })
    );
    return;
  }

  // 4. Static Compiled Assets (_next/static/*, icons, fonts)
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.hostname.includes("fonts.gstatic.com") ||
    url.pathname === "/logo.png"
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        });

        // Return cached version immediately if available, otherwise fetch from network
        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // 5. Default network pass-through
  return;
});
