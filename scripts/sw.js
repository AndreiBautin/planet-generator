/**
 * The service worker template. `vite.config.ts` fills in the version and
 * the list of files at build time and emits it as `sw.js` beside the page.
 *
 * Everything the app needs is cached on install, so after one visit it opens
 * offline — a planet is generated on the device, so offline loses nothing.
 * Pages are fetched network-first, so a new deploy is picked up whenever
 * there is a connection; hashed assets are cache-first, since a hashed file
 * never changes under its name.
 */
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const CACHE = `planet-${VERSION}`

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // There is nothing in the page to lose by swapping it, so a new
      // version takes over at once rather than waiting for every tab to close.
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('planet-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    // Any ?seed= is the same page: the planet is made on the device, so the
    // cached shell serves every link.
    // Past the browser's own cache too: GitHub Pages lets a page be kept for
    // ten minutes, so a deploy reached a phone up to ten minutes late and
    // the last build was what got looked at.
    event.respondWith(
      fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' }).catch(() =>
        caches.match('index.html', { ignoreVary: true }).then((page) => page ?? Response.error()),
      ),
    )
    return
  }

  // ignoreVary: a module script is requested with an Origin header and the
  // precache fetched it without one, so a server that answers `Vary: Origin`
  // would make every offline lookup miss. A hashed file is the same file
  // whoever asks for it.
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((hit) => hit ?? fetch(request)),
  )
})
