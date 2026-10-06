import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, type Plugin } from 'vite'

/**
 * Port 5185, pinned and strict. LiftOS takes 5184; a framework default
 * would collide with whatever else is running, and a silent fall-through
 * to 5186 would leave the start script opening the wrong page. The same
 * number is written in `start-app.bat` and the README.
 */
export const PORT = 5185

/** Files in public/ the app needs offline; they are not in the bundle. */
const PUBLIC_FILES = [
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  // The ground's photographs (CC0, ambientCG), colour and normal per kind.
  ...['grass', 'litter', 'sand', 'stone', 'snow', 'basalt', 'ash'].flatMap((kind) => [
    `textures/${kind}-color.jpg`,
    `textures/${kind}-normal.jpg`,
  ]),
  // The biome grounds on land carry colour only (see detail.ts).
  ...['needles', 'savanna', 'tundra', 'salt'].map((kind) => `textures/${kind}-color.jpg`),
]

/**
 * Emits `sw.js` with the exact list of files this build produced. Written
 * here rather than taken from a PWA plugin: it is forty lines, and those
 * plugins trail new Vite majors by months.
 *
 * The version is a hash of the file list and the worker's own source, so any
 * change to any asset — and every asset name carries its content hash —
 * makes a new worker, and an unchanged build leaves the installed one alone.
 */
function serviceWorker(): Plugin {
  return {
    name: 'planet-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = ['./', 'index.html', ...PUBLIC_FILES, ...Object.keys(bundle)]
        .filter((file) => !file.endsWith('.map'))
        .sort()
      const template = readFileSync(new URL('./scripts/sw.js', import.meta.url), 'utf8')
      // The worker's own code is in the hash too: a fix to how it serves
      // must reach installs whose assets did not change.
      const version = createHash('sha256')
        .update(files.join('\n'))
        .update(template)
        .digest('hex')
        .slice(0, 12)
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace('__VERSION__', version)
          .replace('__PRECACHE__', JSON.stringify(files)),
      })
    },
  }
}

export default defineConfig({
  // GitHub Pages serves the app from /planet-generator/; the deploy sets
  // BASE_PATH, and everywhere else it is served from the root.
  base: process.env.BASE_PATH ?? '/',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: PORT, strictPort: true },
  preview: { port: PORT, strictPort: true },
  // Three.js alone is about 600 kB minified; the default 500 kB warning
  // would fire on every build and be learned as noise. Raised to just
  // above it, so a real jump in size still warns.
  build: { chunkSizeWarningLimit: 800 },
  worker: { format: 'es' },
  plugins: [serviceWorker()],
})
