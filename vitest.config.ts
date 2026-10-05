import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // Generation is pure math and runs in Node: no DOM, no WebGL, which is
    // also what keeps it honest about not reaching for either.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Generation is where the rules live and where a wrong number is
      // silent; it is held to the higher bar. Rendering is checked by eye.
      include: ['src/generation/**', 'src/app/**', 'src/shared/**'],
      exclude: ['**/*.test.ts'],
    },
  },
})
