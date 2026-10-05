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
  **Since the first public deploy the pinned values in `planet.test.ts`
  carry the same weight**: a link to a planet is out in the world, and a
  change that moves those numbers moves the planet behind it. A deliberate
  change of look is allowed — say so in the commit.
- **`generation/` imports nothing but itself and `shared/`.** No Three.js,
  no DOM, no clock — so it runs identically in Node, a worker or a test.
- **Time comes from a `Clock`** (`app/clock.ts`); animate from elapsed time,
  never per frame, so a dropped frame does not slow the planet.
- **Port 5185, strict**, in `vite.config.ts`, `start-app.bat` and the
  README. Change all three together.

- **A worker builds the planet from the seed, not from a planet.** A
  `Planet` holds noise functions, which cannot cross to a worker; the seed
  and dials can, and the seed promise makes the worker's planet the same
  one. Never pass a planet through `postMessage`.
- **Only the newest build is shown** (`builder.ts`): a result for a request
  that was superseded resolves `undefined` and is dropped.
- **Release what a planet held on the GPU** (`release` in `scene.ts`).
  Three does not collect geometry, materials or textures; New planet pressed
  fifty times would otherwise hold fifty planets.

## Traps

- **`BASE_PATH` is set by the deploy** (`/planet-generator/`) and is `/`
  everywhere else. In Git Bash, `BASE_PATH=/x/ pnpm build` is rewritten to a
  Windows path; prefix it with `MSYS_NO_PATHCONV=1`. `vite preview` needs
  `--base /planet-generator/` to serve that build.
- **The service worker matches with `ignoreVary`.** A module script is
  requested with an Origin header and the precache fetched it without one;
  a server answering `Vary: Origin` made every offline lookup miss — found
  by stopping the server, not by reading the code.
- **The worker's version hashes its own source too**, so a fix to how it
  serves reaches installs whose assets did not change.
- **Icons are generated**: `node scripts/generate-icons.mjs`. Change the
  drawing there, not the PNGs.
- **Python edits on Windows write cp1252 by default.** A degree sign once
  landed as invalid UTF-8 in `scene.ts`; open files with `encoding='utf-8'`.

- **TypeScript is pinned to 6.x**: typescript-eslint does not support 7
  yet and refuses to run.
- `crypto.getRandomValues` wants a `Uint8Array<ArrayBuffer>`; a plain
  `new Uint8Array(n)` types as `ArrayBufferLike` under this lib and fails.
- Three.js is ~600 kB; the chunk warning is raised to 800 kB on purpose.

## Where new code goes

Generation rule → `generation/` (pure, tested, own fork). Visual →
`render/`; anything slow there goes in `surface-data.ts` so the worker runs
it. Control → `ui/`, with the feel as pure functions beside the DOM wiring.
Link format → `app/link.ts`. Config → `app/config.ts` plus `.env.example`.
A new file the app needs offline from `public/` → `PUBLIC_FILES` in
`vite.config.ts`.
