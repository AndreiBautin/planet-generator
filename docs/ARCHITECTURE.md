# Architecture

## The shape, and why

Two layers that matter, and two small helpers:

```
src/
  generation/   pure: seed + dials → numbers (heights, colours, positions)
  render/       Three.js: turns those numbers into a scene and draws it
  ui/           the controls (orbit, glide, dials, buttons, share) — drives render
  app/          the link, the config, the clock and the atlas model: pure
  shared/       the logger
  main.ts       the composition root: builds the parts and wires them
  recorder.ts   development only: frame-by-frame driving and measuring,
                loaded by a dynamic import behind config.developer
```

Dependencies point one way: `ui → render → generation`, with `app/` and
`shared/` available to all; `app/` itself reaches only `generation/` and
`shared/`, and `shared/` reaches nothing. **`generation/` imports nothing but itself and
`shared/`** — no Three.js, no DOM, no clock, no `Math.random`.

The domain here is real, which is why it is a layer rather than a folder:
"what does seed k3m9xqa look like" has one right answer that must be the
same on every device and in every release. Isolating it is what makes that
testable in Node without a GPU.

Rendering is not a domain and is not tested by unit tests; it is checked by
eye (see [TESTING.md](TESTING.md)). What _is_ tested on that side is the
logic kept apart from Three.js on purpose — the birth curve, the quality
tiers and governor, the patch quadtree and patch sampling, the swell and
the winds, where a dive lands (`render/places.ts`), the keyboard
(`ui/keys.ts`), and how a finger moves the camera in orbit and in flight.

`render/scene.ts` is still the largest file: `startScene` holds the
renderer, the lights, the per-frame `tick` and the planet swap, because
nearly every part of a frame reads the same camera, sun and shown planet.
What does not need that state lives beside it — `frames.ts` (room and
planet frames), `places.ts`, `starfield.ts`, `post.ts`, `eye-weather.ts`,
`profiler.ts` — and a new per-frame feature goes in a module of its own
with an `update(...)` that `tick` calls, as birds, ships and rain do.

`main.ts` is long for the same reason: it is the one place that holds the
seed, the dials, the system's home and the planet on screen, and most of
its length is panels (atlas, map, system, postcard) whose handlers change
exactly that state. A control that needs only the rig and the planet gets a
file of its own (`ui/dive-button.ts`, `ui/clip-button.ts`); one that
changes which world is shown stays in `main.ts`, where that state lives.

## The rules are lint errors, not prose

`eslint.config.js` enforces, each with a message saying why:

| Rule                                           | Where                       | Why                                                                        |
| ---------------------------------------------- | --------------------------- | -------------------------------------------------------------------------- |
| No `three`, `render/`, `ui/` or `app/` imports | `generation/`               | Generation must run anywhere and give the same numbers.                    |
| No `ui/` imports                               | `render/`                   | The controls drive the renderer, never the reverse.                        |
| No `three`, `render/` or `ui/` imports         | `app/`                      | The link, config and atlas model stay pure and tested in Node.             |
| No imports from the app                        | `shared/`                   | The bottom layer: everything may import it.                                |
| No `new Worker`                                | outside `render/builder.ts` | One place owns the pool, superseding and the queue cap.                    |
| No `localStorage`                              | outside `ui/atlas-store.ts` | Storage is read once, as `unknown`, by a total parser.                     |
| No `Math.random`                               | everywhere                  | One stray call breaks "the same link opens the same planet". Use an `Rng`. |
| No `Date.now`, `new Date()`, `performance.now` | outside `app/clock.ts`      | Time is a parameter, so it can be held still or driven.                    |
| No `import.meta.env`                           | outside `app/config.ts`     | Configuration is parsed once, totally, with defaults.                      |
| No `console`                                   | outside `shared/logger.ts`  | One sink, level-filtered, scalars only.                                    |

Each was proven to fire by writing the violation and watching the build
reject it. `knip` (in `pnpm verify`) fails on an export or a file nothing
reaches, and the page's Content-Security-Policy is described in
[SECURITY.md](../SECURITY.md).

## One request, end to end

Opening `https://andreibautin.github.io/planet-generator/?seed=k3m9xqa&w=70`
and pressing Fly:

1. The **service worker** (`scripts/sw.js`, emitted as `sw.js` by the plugin
   in `vite.config.ts` with the build's exact file list) answers from cache
   if the network is down; otherwise the page loads normally.
2. **`src/main.ts`** reads the config (`app/config.ts`) and the link
   (**`app/link.ts` → `parseLink`**): the seed through `generation/seed.ts`,
   the dials as whole percentages, anything garbled read as its default.
3. **`render/quality.ts` → `pickQuality`** chooses the patch size, how fine
   the ground may split, the cloud texture size, the shadow map and the
   pixel ratio from the screen and core count. **`render/builder.ts`**
   starts a pool of workers (`render/build.worker.ts`, which runs
   `render/work.ts`); every job carries the seed and dials, never a planet,
   and a result for a request that was superseded is dropped.
4. `show` (`main.ts`) calls **`generation/planet.ts` → `createPlanet`** —
   cheap: kind, name and noise functions, each from its own named `fork` of
   the seed. The name goes on screen at once (`ui/hud.ts`). A worker builds
   the drainage map (the `hydrology` job, `generation/hydrology.ts`) and the
   page adopts it with `adoptHydrology`, so rivers, lakes and everything
   that reads them agree with the workers.
5. **`render/scene.ts` → `show`** starts a **`render/patches/terrain.ts`**
   for the planet behind the one on screen and asks a worker for its clouds.
   Each frame the terrain asks **`patches/lod.ts` → `selectLeaves`** which
   cube-sphere patches the camera's view cone needs, requests the missing
   ones ahead of the camera first, and draws the finest one it has for
   each. A worker answers with **`patches/patch-data.ts` → `samplePatch`**
   (height, biome, colour, fine relief from `generation/relief.ts`, water,
   mist, the trees on the ground's own vertices) and the water sheet
   (`patches/water-sheet.ts`), as transferred typed arrays.
6. When the whole faces and the clouds are in, the scene builds the sky,
   air and heavens round the new world and **compiles its shader programs
   first** (`precompile`, so its first frame does not stall), then swaps it
   in (`arrive`), releases the old one's GPU memory and starts the birth
   animation (`render/birth.ts`). The towns, harbours and ruins follow from
   the `lights` job and arrive compiled; a warm-up (`render/warm.ts`)
   compiles what a dive will need while the planet is still in orbit.
7. **Fly**: `ui/rig.ts` asks the scene where to start (`diveFrom` →
   `render/places.ts`: land under the view that runs on ahead) and starts a
   glide (**`ui/glide.ts`**), which travels a great circle and keeps above
   `canopyRadiusAt` — the same arithmetic the patches and trees are drawn
   with. `ui/flight.ts` blends the orbit camera into the glide over the
   dive; gestures (`ui/controls.ts`) and keys (`ui/keys.ts`) steer it.

## Where new code goes

- A new rule of the world (terrain, biomes, cloud cover): `generation/`,
  pure, with a test beside it, drawing randomness from a named `fork`.
- A new visual (a shader, a mesh): `render/`. Anything slow per vertex
  goes in `render/patches/patch-data.ts` or `render/work.ts`, where the
  workers run it.
- A new control: `ui/`, which calls into `render/`, with what it decides
  as a pure function beside the DOM wiring (as `keys.ts` and `glide.ts`).
- Anything that reads the drainage map: a worker job in `render/work.ts`,
  never on the page.
- A new piece of configuration: `app/config.ts`, with a default, a test and
  a line in `.env.example`.
