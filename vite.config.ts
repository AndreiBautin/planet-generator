import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'

/**
 * Port 5185, pinned and strict. LiftOS takes 5184; a framework default
 * would collide with whatever else is running, and a silent fall-through
 * to 5186 would leave the start script opening the wrong page. The same
 * number is written in `start-app.bat` and the README.
 */
export const PORT = 5185

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: PORT, strictPort: true },
  preview: { port: PORT, strictPort: true },
  // Three.js alone is about 600 kB minified; the default 500 kB warning
  // would fire on every build and be learned as noise. Raised to just
  // above it, so a real jump in size still warns.
  build: { chunkSizeWarningLimit: 800 },
})
