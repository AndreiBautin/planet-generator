import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * The architecture and the determinism promise, as rules rather than prose.
 *
 *   ui/  →  render/  →  generation/
 *              ↑             ↑
 *            app/  ──────────┘
 *
 * `generation/` is pure: a seed and dials in, numbers out. It may import
 * nothing but itself and `shared/`, so it runs in Node, in a worker or in
 * a test identically — which is the whole of "the same link opens the
 * same planet".
 */
const generationBoundary = {
  patterns: [
    {
      group: ['three', 'three/*'],
      message:
        'generation/ is pure math. Rendering libraries belong in render/; generation hands it numbers.',
    },
    {
      group: ['@/render/*', '@/ui/*', '@/app/*', '../render/*', '../ui/*', '../app/*'],
      message:
        'generation/ may import only itself and shared/. Dependencies point inward: ui → render → generation.',
    },
  ],
}

const renderBoundary = {
  patterns: [
    {
      group: ['@/ui/*', '../ui/*'],
      message: 'render/ must not know about the controls. The UI drives render, never the reverse.',
    },
  ],
}

/** Randomness and time are taken as parameters, never read from the world. */
const ambient = [
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message:
      'Math.random breaks the seed promise: the same link must open the same planet. Take an Rng from generation/rng.',
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'No ambient clock. Take a Clock (app/clock.ts) so time can be held still in a test.',
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'No ambient clock. Take a Clock (app/clock.ts) so time can be held still in a test.',
  },
  {
    selector: "CallExpression[callee.object.name='performance'][callee.property.name='now']",
    message: 'No ambient clock. Take a Clock (app/clock.ts) so frame time can be driven in a test.',
  },
  {
    selector: "MemberExpression[object.type='MetaProperty'][property.name='env']",
    message: 'Read configuration through app/config.ts, which parses it totally with defaults.',
  },
]

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  {
    files: ['**/*.ts', 'eslint.config.js'],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'no-console': ['error'],
      'no-restricted-syntax': ['error', ...ambient],
    },
  },
  {
    files: ['src/generation/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', generationBoundary] },
  },
  {
    files: ['src/render/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', renderBoundary] },
  },
  // The one place each forbidden thing is allowed to live.
  {
    files: ['src/shared/logger.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['src/app/clock.ts', 'src/app/config.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  // Tests may build fixtures however they like; production code may not.
  {
    files: ['**/*.test.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['*.config.ts', '*.config.js'],
    languageOptions: { globals: globals.node },
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
)
