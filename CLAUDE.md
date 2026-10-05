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

- **Fine relief is added by the renderer, never folded into
  `surfaceAt`.** Every shared link is pinned by `surfaceAt`'s numbers;
  `generation/relief.ts` has its own fork and `relief.test.ts` checks the
  pinned height has not moved.
- **What a glide flies over is what the patches draw.** Both go through
  `groundRadiusAt`/`drawnHeight` in `patch-data.ts`; change one and the
  glide flies through hills or above them.
- **Close-up detail is two things, and neither is the mesh alone.** Fine
  relief shapes the patches; `render/detail.ts` adds per-pixel grain, bumps
  and water ripples, faded out with distance. Without the shader, a dive
  ended in smooth single-colour land however fine the patches were.
- **Split only what is seen.** `selectLeaves` takes the view cone and the
  planet's real peak height: low down, that cut the patches wanted from 573
  to 297 on a phone and from 1,821 to 717 on a desktop, against caches of a
  few hundred. A cache smaller than the view is permanent thrash.
- **Refine a step at a time.** The terrain asks for one level below what it
  is drawing, not for the leaf; asking for the leaf left the whole faces up
  until the finest ground arrived.
- **Features stand on a fixed grid, not on the patches.** Trees, scrub,
  cacti, rocks, boulders, spires and floes come from `featuresAt` and
  `scatterPatch` (`generation/features.ts`, `render/patches/scatter.ts`):
  one candidate per grid cell of `CELL` on each cube face, decided by a hash
  of the cell, so a feature is the same one whatever patch carries it and a
  parent tile is exactly the union of its children (tested). They stream in
  their own level-7 tiles near the camera (`flora.ts`, owned by `Terrain`
  so they turn with the planet), because the ground's finest patches only
  reach a flight's height away and a forest that existed only underneath
  is no forest. Past the feature range the ground shader carries the look:
  `patternAt` writes canopy, sand, snow and stone per vertex and
  `withGroundDetail` draws crowns, ripples, wind ridges and cracks from it.
  The sea gets a depth attribute for shallows and shore foam, and a molten
  sea its own plates-and-seams shader.
- **Trees are green first and the palette second.** An ochre world's
  "lush" painted orange forests that read as dead ones; the forest also
  stops at real heat however wet the ground is.
- **The sky shader only fills the sky.** Haze over ground is the scene's
  fog. Laying the shader over everything with the ground taken as a sphere
  washed low land out white, because real hills stand above that sphere.

## Traps

- **Every patch geometry wraps the shared index array in its own
  attribute.** Disposing a geometry frees its index's GPU buffer, so one
  shared attribute would be freed from under every other patch.
- **The preview pane draws only while taking a screenshot**, so streaming
  and animation look slower there than they are. Judge pacing on a device.

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
