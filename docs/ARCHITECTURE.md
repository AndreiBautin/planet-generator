# Architecture

## The shape, and why

Two layers that matter, and two small helpers:

```
src/
  generation/   pure: seed + dials → numbers (heights, colours, positions)
  render/       Three.js: turns those numbers into a scene and draws it
  ui/           the controls (dials, buttons) — drives render
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
eye (see [TESTING.md](TESTING.md)).

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

Opening `http://localhost:5185/?seed=k3m9xqa`:

1. **`src/main.ts`** reads the config (`app/config.ts` → `parseConfig`) and
   sets the log level.
2. It reads `seed` from the URL with **`generation/seed.ts` → `parseSeed`**.
   A missing or malformed seed reads as absent, and `newSeed` makes one from
   `crypto.getRandomValues`; the URL is rewritten with `replaceState` so the
   address bar is always a shareable link.
3. **`generation/rng.ts` → `createRng(seed)`** hashes the seed (cyrb128) into
   an sfc32 generator. `fork('placeholder')` derives an independent stream,
   so adding a new feature later never reshapes what already existed.
4. The colour drawn from that stream is handed to
   **`render/scene.ts` → `startScene`**, which builds the renderer, camera,
   light and mesh, and runs the frame loop from **`app/clock.ts`'s
   `systemClock`**.

When terrain arrives, step 4 becomes: generation builds a height and colour
field for the sphere from the forked streams; render uploads it as geometry
and shaders. The seam does not move.

## Where new code goes

- A new rule of the world (terrain, biomes, cloud cover): `generation/`,
  pure, with a test beside it, drawing randomness from a named `fork`.
- A new visual (a shader, a mesh): `render/`.
- A new control: `ui/`, which calls into `render/`.
- A new piece of configuration: `app/config.ts`, with a default, a test and
  a line in `.env.example`.
