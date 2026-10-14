import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

/** Every `x.ts` under the given folders that has an `x.test.ts` beside it. */
function testedFilesIn(roots: readonly string[]): string[] {
  return roots.flatMap((root) =>
    readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.test.ts'))
      .map((test) => join(root, test.replace(/\.test\.ts$/, '.ts')).replaceAll('\\', '/'))
      .filter((file) => existsSync(file)),
  )
}

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // Generation is pure math and runs in Node: no DOM, no WebGL, which is
    // also what keeps it honest about not reaching for either.
    environment: 'node',
    // Many tests build a planet's drainage map, settlements or patches:
    // seconds each, and past the default 5 s whenever the machine is busy
    // (the pre-push gate failed on that, not on a wrong number).
    testTimeout: 30_000,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      // Generation is where the rules live and where a wrong number is
      // silent; it is held to the higher bar. Of render/ and ui/, only the
      // files that have tests of their own are counted: they hold the pure
      // arithmetic (the glide, the tour, the swell, the winds) beside WebGL
      // and DOM wiring that is checked by eye, so their floor is lower.
      include: [
        'src/generation/**',
        'src/app/**',
        'src/shared/**',
        ...testedFilesIn(['src/render', 'src/ui']),
      ],
      exclude: ['**/*.test.ts', '**/*.fuzz.test.ts'],
      // Floors a little under where each stands (2026-10-14; render and ui raised after the rig tests), so coverage
      // can only fall by a deliberate change here, never by drift.
      thresholds: {
        'src/generation/**': { lines: 93, functions: 94, branches: 75 },
        'src/app/**': { lines: 96, functions: 92, branches: 94 },
        'src/shared/**': { lines: 95, functions: 95 },
        'src/{render,ui}/**': { lines: 65, functions: 63 },
      },
    },
  },
})
