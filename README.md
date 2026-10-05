# Planet Generator

Press **New planet** and a world is born — continents, seas, ice caps,
clouds and a glowing rim of air — that you can spin with a finger and share
with a link. Every planet comes from a seed, so the same link always opens
the same world, on any device.

**Live:** [andreibautin.github.io/planet-generator](https://andreibautin.github.io/planet-generator/)

## On a phone

Open the link, then **Add to Home Screen** (Safari's Share menu on iOS;
**Install app** in Chrome's menu on Android). It opens full-screen like an
app and works offline after the first visit — a planet is generated on the
device, so there is nothing to download per world.

- **Drag** to turn it, **flick** to let it coast, **pinch** (or scroll) to zoom.
- **New planet** makes another; **Back** returns to the one before.
- **Tune** opens the dials — water, temperature, roughness. They are in the
  link too, so a shared planet arrives as you tuned it.
- **Share** opens the share sheet, or copies the link where there is none.

Five kinds of world turn up — temperate, ocean, desert, frozen and volcanic —
the rarer ones less often, and each has its own name.

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

**A planet is a pure function of its seed.** Generation takes a seed and
three dials and returns numbers; it never touches the renderer, the clock or
`Math.random` — the lint rules make each of those a build error. That is
what lets a link be the whole save file: `?seed=k3m9xqa&w=70` opens the same
planet on any device, today or in a year, and the generator's output is
pinned by literal-value tests so a refactor cannot quietly move every shared
world.

It is also why the slow part could move to a worker without a second
thought: the worker is handed a seed, makes its own planet, and by the same
promise gets the same one.

## Built with

TypeScript (strict), Vite, Three.js, Vitest, ESLint and Prettier, managed
with pnpm; a hand-written service worker and a generated icon set, deployed
to GitHub Pages. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/TESTING.md](docs/TESTING.md).
