# Architecture

## The shape, and why

Two layers that matter, and two small helpers:

```
src/
  generation/   pure: seed + dials → numbers (heights, colours, positions)
  render/       Three.js: turns those numbers into a scene and draws it
  ui/           the controls (orbit, glide, dials, buttons, share) — drives render
  app/          the clock and the config: the world, behind small ports
  shared/       the logger
  main.ts       the composition root
```

Dependencies point one way: `ui → render → generation`, with `app/` and
`shared/` available to all. **`generation/` imports nothing but itself and
`shared/`** — no Three.js, no DOM, no clock, no `Math.random`.

The domain here is real, which is why it is a layer rather than a folder:
"what does seed k3m9xqa look like" has one right answer that must be the
same on every device and in every release. Isolating it is what makes that
testable in Node without a GPU.

Rendering is not a domain and is not tested by unit tests; it is checked by
eye (see [TESTING.md](TESTING.md)). What _is_ tested on that side is the
logic kept apart from Three.js on purpose: the birth curve, the quality
tiers and governor, the patch quadtree and patch sampling, and how a finger
moves the camera in orbit and in flight.

## The rules are lint errors, not prose

`eslint.config.js` enforces, each with a message saying why:

| Rule                                           | Where                      | Why                                                                        |
| ---------------------------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| No `three`, `render/`, `ui/` or `app/` imports | `generation/`              | Generation must run anywhere and give the same numbers.                    |
| No `ui/` imports                               | `render/`                  | The controls drive the renderer, never the reverse.                        |
| No `Math.random`                               | everywhere                 | One stray call breaks "the same link opens the same planet". Use an `Rng`. |
| No `Date.now`, `new Date()`, `performance.now` | outside `app/clock.ts`     | Time is a parameter, so it can be held still or driven.                    |
| No `import.meta.env`                           | outside `app/config.ts`    | Configuration is parsed once, totally, with defaults.                      |
| No `console`                                   | outside `shared/logger.ts` | One sink, level-filtered, scalars only.                                    |

Each was proven to fire by writing the violation and watching the build
reject it.

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
   the ground may split, the cloud texture size and the pixel ratio from the
   screen and core count. **`render/builder.ts`** starts a pool of workers
   (`render/build.worker.ts`, which runs `render/work.ts`).
4. `show` calls **`generation/planet.ts` → `createPlanet`** — cheap: kind,
   name and noise functions, each from its own named `fork` of the seed. The
   name goes on screen at once (`ui/hud.ts`).
5. **`render/scene.ts` → `show`** starts a **`render/patches/terrain.ts`**
   for the planet behind the one on screen and asks a worker for its clouds.
   Each frame the terrain asks **`patches/lod.ts` → `selectLeaves`** which
   cube-sphere patches (`patches/cube.ts`) the camera needs, requests the
   missing ones nearest first, and draws the finest one it has for each.
   A worker answers with **`patches/patch-data.ts` → `samplePatch`**:
   `surfaceAt` for height, biome and colour, `generation/relief.ts` for the
   close-up crags, rock on steep ground, and a skirt to hide cracks — as
   transferred typed arrays.
6. When the six whole faces and the clouds are in, the scene swaps the new
   planet in, releases the old one's GPU memory and starts the birth
   animation (`render/birth.ts`). The sky is `render/atmosphere.ts`, haze
   is the scene's fog, both scaled to the camera's height.
7. **Fly**: `ui/rig.ts` asks the scene where to start (`diveFrom` — the
   ground under the middle of the view) and starts a glide
   (**`ui/glide.ts`**), which travels a great circle and keeps above
   `groundRadiusAt`, the same arithmetic the patches are drawn with.
   `ui/flight.ts` blends the orbit camera into the glide camera over the
   dive; gestures (`ui/controls.ts`) steer whichever the finger is on.

## Where new code goes

- A new rule of the world (terrain, biomes, cloud cover): `generation/`,
  pure, with a test beside it, drawing randomness from a named `fork`.
- A new visual (a shader, a mesh): `render/`. Anything slow per vertex
  goes in `render/patches/patch-data.ts` or `render/work.ts`, where the
  workers run it.
- A new control: `ui/`, which calls into `render/`.
- A new piece of configuration: `app/config.ts`, with a default, a test and
  a line in `.env.example`.
