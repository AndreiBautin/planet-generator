# Working on Planet Generator

A browser app that generates a planet from a seed and lets you fly around
it. **A planet is a pure function of its seed** — that one promise decides
most of what follows. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Before you finish anything

```sh
pnpm verify    # typecheck + lint + format:check + test:run + build
```

Use `pnpm typecheck` (`tsc -b`), never `tsc --noEmit` against the root
config: it is a solution file of references, and `--noEmit` against it
checks nothing. The pre-push hook runs `pnpm verify`; CI runs the same.

## Load-bearing invariants

- **No `Math.random`, anywhere.** All randomness comes from
  `generation/rng.ts`, seeded from the URL. A lint error, with a message.
- **Draw from a named fork per feature** (`rng.fork('terrain')`,
  `rng.fork('clouds')`). A shared stream means adding clouds shifts every
  number terrain draws afterwards — every existing planet would change.
- **The literal-value tests in `rng.test.ts` are the promise.** If they
  fail, a change has moved every shared planet. Updating the snapshot is a
  decision to break old links, not a fix.
  **Until the first public deploy no link has been shared**, so while the
  look is being tuned the pinned values in `planet.test.ts` move freely;
  from the deploy on, they carry the same weight as the generator's.
- **`generation/` imports nothing but itself and `shared/`.** No Three.js,
  no DOM, no clock — so it runs identically in Node, a worker or a test.
- **Time comes from a `Clock`** (`app/clock.ts`); animate from elapsed time,
  never per frame, so a dropped frame does not slow the planet.
- **Port 5185, strict**, in `vite.config.ts`, `start-app.bat` and the
  README. Change all three together.

## Traps

- **TypeScript is pinned to 6.x**: typescript-eslint does not support 7
  yet and refuses to run.
- `crypto.getRandomValues` wants a `Uint8Array<ArrayBuffer>`; a plain
  `new Uint8Array(n)` types as `ArrayBufferLike` under this lib and fails.
- Three.js is ~600 kB; the chunk warning is raised to 800 kB on purpose.

## Where new code goes

Generation rule → `generation/` (pure, tested, own fork). Visual →
`render/`. Control → `ui/`. Config → `app/config.ts` plus `.env.example`.
