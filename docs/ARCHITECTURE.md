# Architecture

## The shape, and why

Two layers that matter, and two small helpers:

```
src/
  generation/   pure: seed + dials → numbers (heights, colours, positions)
  render/       Three.js: turns those numbers into a scene and draws it
  ui/           the controls (orbit, dials, buttons, share) — drives render
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
tiers and governor, and how a finger moves the camera.

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

Opening `https://andreibautin.github.io/planet-generator/?seed=k3m9xqa&w=70`:

1. The **service worker** (`scripts/sw.js`, emitted as `sw.js` by the plugin
   in `vite.config.ts` with the build's exact file list) answers from cache
   if it has one and the network is down; otherwise the page loads normally.
2. **`src/main.ts`** reads the config (`app/config.ts` → `parseConfig`), and
   the link with **`app/link.ts` → `parseLink`**: the seed through
   `generation/seed.ts` → `parseSeed`, the dials as whole percentages. Any of
   them missing or garbled reads as absent or default; a fresh seed comes
   from `crypto.getRandomValues`.
3. **`render/quality.ts` → `pickQuality`** chooses the icosphere detail,
   cloud texture size and pixel ratio from the screen and core count.
4. `show` calls **`generation/planet.ts` → `createPlanet`** — cheap: it only
   picks the kind (`kinds.ts`), name (`name.ts`) and noise functions, each
   from its own named `fork` of the seed's `rng`. The name goes on screen at
   once (`ui/hud.ts`).
5. **`render/builder.ts`** posts the seed and dials to
   **`render/build.worker.ts`**, which makes the same planet and runs the slow
   part: **`render/surface-data.ts` → `sampleSurface`** asks `surfaceAt` for
   height, biome and colour at every vertex, and `bakeClouds` asks
   `generation/clouds.ts` → `cloudDensityAt` at every texel. The arrays come
   back transferred, not copied. A request superseded by a newer one is
   dropped.
6. **`render/scene.ts` → `show`** turns the arrays into meshes
   (`planet-mesh.ts`, `water.ts`, `clouds.ts`, `atmosphere.ts`, the starfield),
   releases the previous planet's GPU memory, and starts the birth animation
   (`birth.ts`). The frame loop reads the camera from **`ui/controls.ts`**
   (pointer events → the pure **`ui/orbit.ts`**) and the time from
   **`app/clock.ts`**, and the governor lowers the pixel ratio if typical
   frames run slow.

## Where new code goes

- A new rule of the world (terrain, biomes, cloud cover): `generation/`,
  pure, with a test beside it, drawing randomness from a named `fork`.
- A new visual (a shader, a mesh): `render/`.
- A new control: `ui/`, which calls into `render/`.
- A new piece of configuration: `app/config.ts`, with a default, a test and
  a line in `.env.example`.
