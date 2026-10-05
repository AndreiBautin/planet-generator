# Planet Generator

Click and a unique world is born — terrain, oceans, clouds and atmosphere —
that you can fly around in the browser and share with a link. Every planet
comes from a seed, so the same link always opens the same world.

> **Status: foundations.** The verification gate, architecture rules,
> seeded randomness and a placeholder sphere are in place. The planet itself
> is next — see [the plan](#the-plan).

## Run it

Double-click **`start-app.bat`** (Windows). It checks for Node and pnpm,
installs dependencies on first run, refuses to start if port 5185 is taken,
starts the dev server in its own window and opens
[http://localhost:5185](http://localhost:5185).

Or by hand:

```sh
pnpm install
pnpm dev        # http://localhost:5185
pnpm verify     # typecheck + lint + format:check + test + build
```

## The one idea

**A planet is a pure function of its seed.** Generation takes a seed and a
few dials and returns numbers; it never touches the renderer, the clock or
`Math.random` — the lint rules make each of those a build error. That is
what lets a link be the whole save file: `?seed=k3m9xqa` opens the same
planet on any device, today or in a year, and the generator's exact output
is pinned by literal-value tests so a refactor cannot quietly move every
shared world.

## The plan

- **Terrain**: layered noise on a sphere — continents, mountains, ocean basins.
- **Oceans, clouds and an atmosphere** with scattering at the limb.
- **Biomes** coloured by height, latitude and moisture.
- **Orbit and fly controls**, smooth on a phone as on a desktop.
- **Dials**: water level, temperature, roughness, size — in the link too.
- Later: planet types (ice, desert, lava, gas giant, rings), moons, night-side
  lights, exporting a still or a flyover.

## Built with

TypeScript (strict), Vite, Three.js, Vitest, ESLint and Prettier, managed
with pnpm. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/TESTING.md](docs/TESTING.md).
