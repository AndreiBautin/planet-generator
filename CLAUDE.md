# Working on Planet Generator

A browser app that generates a planet from a seed and lets you fly around
it. **A planet is a pure function of its seed** — that one promise decides
most of what follows. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for
the shape, [docs/TESTING.md](docs/TESTING.md) for what is and is not tested,
[SECURITY.md](SECURITY.md) for the threat model, and
[docs/HISTORY.md](docs/HISTORY.md) for every round of work, report and fix
behind the rules below — search it for the why behind any number.

## Before you finish anything

```sh
pnpm verify    # typecheck + lint + knip + format:check + tests with coverage + build
```

Use `pnpm typecheck` (`tsc -b`), never `tsc --noEmit` against the root
config: it is a solution file of references, and `--noEmit` against it
checks nothing. The pre-push hook runs `pnpm verify` and `pnpm audit
--prod`; CI runs the same, and refuses a lockfile entry outside the npm
registry. Coverage has floors (`vitest.config.ts`): lower one only as a
decision, in the commit message.

## The promise: the same link opens the same planet

- **No `Math.random`, anywhere.** All randomness comes from
  `generation/rng.ts`, seeded from the URL. A lint error, with a message.
- **Draw from a named fork per feature** (`rng.fork('terrain')`). A shared
  stream means adding clouds shifts every number terrain draws afterwards.
- **The pinned values in `rng.test.ts` and `planet.test.ts` are the
  promise.** If they fail, a change has moved every shared planet. Updating
  them is a decision to break old links; a deliberate change of look is
  allowed — say so in the commit.
- **`generation/` imports nothing but itself and `shared/`**: no Three.js,
  no DOM, no clock. `app/` reaches only `generation/` and `shared/`.
  `shared/` reaches nothing. All lint rules.
- **Fine relief is added by the renderer, never folded into `surfaceAt`**
  (`generation/relief.ts`, its own fork; `relief.test.ts` checks the pinned
  height has not moved).
- **A new dial defaults to where every old link already is.** Season's
  default (0.25, the equinox) makes both seasonal terms nought; the woods
  stay summer green there. Do the same for the next one.
- **Time comes from a `Clock`** (`app/clock.ts`); animate from elapsed time,
  never per frame. Anything moving in the world (ships, lightning, carts,
  eruptions) is a function of `DETAIL_TIME`, so every device and a recorded
  run see it in the same place.
- **Port 5185, strict**, in `vite.config.ts`, `start-app.bat` and the
  README. Change all three together.

## Workers and the GPU

- **A worker builds from the seed and dials, never from a `Planet`** (it
  holds noise functions, which cannot cross `postMessage`). Only
  `render/builder.ts` makes a `Worker` (lint). Only the newest build is
  shown; a superseded result resolves `undefined`.
- **The worker's planet cache keys on every dial.** It once left out the
  season and served the old snow line.
- **Nothing that reads the drainage map runs on the page**: hydrology,
  lights/harbours/ruins, falls, sights, the world map are worker jobs
  (`render/work.ts`). The page adopts the map (`adoptHydrology`).
- **Release what a planet held on the GPU** (`release` in `scene.ts`).
  Three collects nothing. A texture held in a uniform (the rings' bands) is
  disposed by hand.
- **Every patch geometry wraps the shared index array in its own
  attribute.** Disposing a geometry frees its index's buffer.
- **The ground's vertex shader is at WebGL's sixteen attributes.** A new
  per-vertex attribute on the ground must replace one.
- **A world's programs are made before it is shown** (`precompile`), and a
  dive's are warmed in orbit (`render/warm.ts`). `compileAsync` compiles for
  the render target bound at the time — bind the composer's `readBuffer`
  first. Anything new and heavy built at arrival goes through
  `compileHeld`. `recorder.stats().programs` jumping marks a compile.
- **`sun.castShadow` is always on**; low down, `shadowMap.needsUpdate` is
  set, every `SHADOW_EVERY` frames. Toggling `castShadow` recompiles every
  program. The map must exist before anything samples it — **after any
  shadow change, look at the orbit**: a missing map shadowed the whole day
  side once.
- **Only woods within `TREE_SHADOW_REACH` cast; past `TREE_DETAIL_REACH`
  trees use the 60-triangle model.** `VisibleGroup` skips hidden children
  in `updateMatrixWorld` — use it for anything that parks thousands of
  hidden objects.

## The ground, the trees and what stands on them

- **What a glide flies over is what the patches draw**: both go through
  `groundRadiusAt`/`drawnHeight` in `patch-data.ts`. The glide's floor is
  `canopyRadiusAt` (ground plus trees); things that stand on the ground use
  `groundRadiusAt`.
- **The drawn mesh is not the true ground on rough terrain** — it runs
  straight between vertices and can stand 0.0006 over `groundRadiusAt` on a
  dune. Small models on rough ground take the highest ground near them
  (`FEEL` in `oases.ts`), or are buried.
- **Split only what is seen, a step at a time** (`selectLeaves` with the
  view cone; ask for one level below what is drawn, not the leaf). Patches
  ahead of the camera first (`aheadOf`).
- **Trees are level of detail on the ground's own vertices**
  (`patches/forest.ts`): finer ground shows its ancestor's trees, coarser
  ground a quarter as many, **each the same size**. No tree ever changes
  size — that was reported as trees growing and shrinking. The instanced
  geometry needs the model's index copied too, or nothing draws.
- **A biome is made of its features, and the planet's kind gates what can
  grow** (`featuresAt`, `floorAt`, `groupingsAt`): woods are stands with a
  sharp edge, rock lies in outcrops, the ground is painted from the same
  fields so the canopy stops where the trees stop. Nothing grows on snow,
  trees are gone by height 0.62, an arid world grows no forest, a molten
  one nothing living. Tested; reported every time it slipped.
- **Trees are green first and the palette second**; snow-laden only where
  the ground is snow.
- **The ground wears photographs levelled to the alien palette** (CC0
  scans, `public/textures/`, `PHOTO_MEANS`): colour maps are
  `SRGBColorSpace`, normal maps and baked tiles linear. Reading a photo as
  linear clipped the grass to one tone. Photos swap in on a shared uniform,
  no recompile.
- **`NearCells` holds three rings of cells** (`HELD_REACH` 0.026); anything
  it holds must fade out inside that, measured from its anchor, or it is met
  part-grown. Two rings reached only 0.0175 near cube seams.
- **Empty instance slots are not drawn** (`drawOnlyLive`); a sized array
  has holes `indexOf(undefined)` skips — fill it.
- **The towns are made from the lights** (settlements.ts): a house where a
  window is lit, a road where the faint lights run, the canopy cleared under
  both (`townCoverOf`); `TOWN_LIGHT` is shared so they cannot disagree.
  Thresholds read back from float32 sit a hair under their literal (0.45
  became 0.44).
- **Every built model wears `weathered.ts`** (roughening, moss on facets that
  face up, no sun through the planet, own light that fades with the day).
  Night light on everything is one shared town glow (`town-glow.ts`) and
  moonlight (`moonlight.ts`, added at `aomap_fragment`, which nothing
  replaces; `withMoonlight` returns if already applied).

## Water

- **Hydrology is a priority flood on the level-7 grid**, deterministic and
  memoised per planet. Lakes spread over every flooded cell at their level;
  water is withheld on snow but rivers still carve it.
- **The water sheet runs one vertex past every shore, level**, held under
  dry ground (`DRY`), and level at the water's height where `liftOf` sinks
  low land under `SEA_RADIUS` — otherwise panes of water stand in the
  beach. Dry vertices are discarded in the shader; dry vertices geomorph
  with the ground. `inland` is settled from wet neighbours.
- **The swell is one table** (`swell.ts`): the water shader is generated
  from it and ships ride it by `swellHeaveAt`. Its steepnesses are held
  short of folding by `swell.test.ts`.
- **Under the sea**: `rig.submerge`, `DEEP_ENOUGH` 0.0042 (reefs and kelp
  live in water that shallow); neither crossing may step more than a
  frame's settling (`rig.test.ts`).

## Shaders

- **One NaN pixel is a black screen.** `pow`, `sqrt` and `log` bases are
  held by `shader-pow.test.ts`: guard in the call or list the reason.
  Square a signed value by multiplying. Clamp anything interpolation can
  push past its range.
- **Shader errors are silent.** An undeclared varying, a GLSL keyword as a
  name (`out`), a vertex shader calling a derivative (`NOISE_VERTEX` exists
  for this), a uniform declared twice: the program fails and the thing just
  is not drawn. **After any shader patch, look for the thing**, and read the
  console for `VALIDATE_STATUS`.
- **A new noise fades by its own pixel span** (`pixelSpan`, `cloudSpan`) or
  it sparkles from orbit. Textures sampled minified and moving need mipmaps.
- **Points under ~2.6 px twinkle** as the planet turns; size up and dim by
  area.
- **The sky shader only fills the sky**; haze over ground is the fog.
- **Tone mapping is AgX at exposure 1.15 with a mild grade.** Judge exposure
  at a low sun over sand or snow. No film grain: a fixed per-pixel hash
  reads as noise on a moving picture.
- **The sun's light is cut past the terminator in every material**
  (`groundDay`, `treeDay`, `weathered`), which is why moonlight is a
  uniform term, not a second light.

## Flight, controls and the page

- **A finger is a stick, not a hand on the camera** (`steer`/`advance` in
  glide.ts): a rate of turn and a pitch the nose follows, banking into
  turns; a drag the height of the screen is about half a turn. Pitch is
  clamped near −12.6°, so a link's tilt past that does nothing.
- **What a key does is `keyAction`** (`ui/keys.ts`, pure, tested).
- **A held glide is `stillGlide`**: its eye at exactly ground + altitude,
  which is what lets a `shot=` link reproduce a picture. A link opens held
  still; the first touch or any button lets go.
- **Links are parsed totally** (`app/link.ts`, fuzzed): a garbled or
  out-of-range part opens the plain planet. A glide link under 4‰ altitude
  is refused and opens in orbit — silently.
- **Only `ui/atlas-store.ts` touches `localStorage`** (lint); the atlas is
  read as `unknown`, pictures must be base64 JPEG.
- **The rail is one flex column**; a mode hides a button with
  `display: none`. No per-mode offsets. Five dock buttons fit 375 px; a
  sixth needs a different layout. Sheets use `showSheet`/`hideSheet`;
  sliders need `refreshSliders()` after a programmatic value.
- **This is the planet and the glide.** A game layer was built and reverted
  on request; it lives on the `expedition` branch. Nothing from it comes
  back as a default-UI feature.

## Traps

- **The page has a CSP** (`index.html`): anything from another origin, or a
  new `blob:`/`data:` use outside images and media, is blocked silently.
  The build strips the dev server's `ws:` and `blob:` workers (its
  reconnect after a restart) and fails if it cannot find them.
- **Pages shares one origin across the account**: the service worker's
  caches are `planet-generator-*` and it deletes only those.
- **The service worker matches with `ignoreVary`**, and its version hashes
  its own source.
- **`BASE_PATH` is set by the deploy** (`/planet-generator/`). In Git Bash
  prefix `MSYS_NO_PATHCONV=1`; `vite preview` needs `--base`.
- **Icons are generated**: `node scripts/generate-icons.mjs`.
- **Python edits on Windows**: open with `encoding='utf-8'` and
  `newline=''`, or the file comes back cp1252 or CRLF.
- **TypeScript is pinned to 6.x** (typescript-eslint). `crypto.getRandomValues`
  wants a `Uint8Array<ArrayBuffer>`.
- **No wall-clock bounds in tests**: they fail on a busy machine, and
  under coverage.

## Checking a change on screen

- **The preview pane draws only while taking a screenshot**, and a hidden
  pane throttles timers to seconds. Pacing and animation are judged on a
  device; `docs/PHONE_CHECKLIST.md` is what only a phone can answer.
- **`?record`** (development builds) puts `window.recorder` on the page:
  `step(ms)`, `bench`, `profile`, `stats`, `terrain`, `sun`, `diveFrom`,
  `glideFrom`, `root`. **Step at real-time pace** (a 33 ms sleep per 33 ms
  step) or the workers starve and stand-ins look like bugs.
- **`?shot=` puts the camera anywhere**: build one with `shotOf` and
  `linkFor`. Golden hour toward the sun on `83tzj46`:
  `shot=g,-9.55,8.738,272,4.0,17.50,8`. Seeds: `83tzj46` temperate,
  `9tcwfzj` frozen and ringed, `h999999` molten, `aaangxg` arid.
- **Screenshots in record mode can be stale**: draw
  `recorder.canvas.toDataURL()` into an overlay `<img>` and screenshot that.
  The pane's `zoom` captures the live canvas, not the overlay. A black
  capture may be a 0 × 0 viewport — set a size first.
- **To find what draws a pixel**, hide or `colorWrite = false` one material
  at a time and read the pixel back; terrain resets `visible` each frame.
  Measure flicker as shimmer per cell over frames, at the reporter's size.
- **The scene rewrites many uniforms every frame**; to force one for a
  check, patch its setter, or the next tick undoes it.
- **Measure a change by what it touched** (`recorder.profile()` medians,
  GPU timer queries), not by the frame's total, which drifts run to run.

## Where new code goes

Generation rule → `generation/` (pure, tested, own fork). Visual →
`render/`, as a module with an `update(...)` that `tick` calls; anything
slow per vertex in `patch-data.ts` or a job in `work.ts`. Control → `ui/`,
with the decision as a pure function beside the DOM wiring. Link format →
`app/link.ts`. Config → `app/config.ts` plus `.env.example`. A new file the
app needs offline from `public/` → `PUBLIC_FILES` in `vite.config.ts`. What
was done and why → a section in `docs/HISTORY.md`; a new invariant or trap
that came out of it → a line here.

## Left open

- Unseen: everything on a real phone, the share sheets, the crest glow with
  the sun ahead, crease shading on a cliff, the rings from below, moonlight
  on water and snow.
- An intermittent 300–510 ms frame some seconds into `9tcwfzj` (JavaScript,
  not a compile or the driver); not found.
- The polish series is closed at the user's request: do not propose more
  look work unprompted.
