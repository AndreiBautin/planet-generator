# Testing

`pnpm verify` runs typecheck, lint, the format check, the tests and the
build. It gates the pre-push hook (`.githooks/pre-push`) and CI
(`.github/workflows/ci.yml`), which run the same one command so they cannot
disagree.

## What is prioritised

**What would be silently wrong.** In this app that is overwhelmingly
determinism: a generator that changed its output would keep working, keep
drawing believable planets, and quietly change every planet anybody ever
shared. Nothing else would notice. So:

- **Literal values** pin the generator's output (`rng.test.ts`): not "the
  same seed gives the same sequence" — which passes for a generator that
  changed consistently — but the actual numbers.
- **Forks are independent** of each other and of draws from the parent, so
  adding a feature cannot reshape existing terrain.
- **The planet's shape** (`planet.test.ts`, `clouds.test.ts`): pinned
  heights for known seeds, and the properties a reader would notice if they
  broke — the water dial floods land, poles are icy on a temperate world, a
  molten sea never freezes, every kind turns up, cover means cover.
- **Parsing is total**: a malformed seed, link dial or config value degrades
  rather than throws, and a config typo cannot switch on the wrong mode.
- **The patch quadtree** (`lod.test.ts`, `patch-data.test.ts`): the leaves
  tile the sphere exactly once however close the camera is, the ground
  under the camera splits finest and the far side stays whole, ground
  behind the camera stays coarse while ground ahead splits, neighbours
  agree on their shared edge (positions and normals), and the ground a
  glide follows is the ground the patches draw.
- **Fine relief leaves shared planets alone** (`relief.test.ts`): it lives
  on its own fork and the pinned surface heights do not move.
- **Features and surface patterns** (`features.test.ts`,
  `scatter.test.ts`, `relief.test.ts`): a wood at its fullest is nearly a
  tree per spot with undergrowth under it, an arid world grows no forest
  however damp a patch of it, a boreal belt of pines on cold damp ground,
  no forest in real heat, cacti and rock on a desert floor, pack ice plate
  to plate on a frozen sea, columns and cones on a molten one; neither
  layer ever asks for more than one thing per spot on any kind of world;
  dunes over dry lowland and none on snow or at sea, carrying relief where
  crags carry none; a scatter is deterministic, nothing stands on coarse
  patches, a parent tile holds exactly its children's features, every
  feature stands on the ground the patches draw (a floe on the sea), and
  no two are the same size and shade.
- **Flight** (`glide.test.ts`, `flight.test.ts`): a glide stays on the
  sphere, rises before a ridge, never comes below its clearance over bumpy
  ground, turns the way the finger goes, noses up with a finger moving up
  and climbs as it flies, levels itself when left alone and keeps within
  its ceiling and floor, looks up the sky when pitched up, gains speed in a dive and spends it in
  a climb; a dive turned
  back mid-way rises from where it had got to.
- **The baked ground textures** (`ground-atlas.test.ts`): every kind is a
  full square with real variation, the seam is no sharper than the
  sharpest step inside the square (so it tiles), and the colours stay near
  the middle so the biome's colour shows through.
- **The feel, as pure functions** (`orbit.test.ts`, `birth.test.ts`,
  `quality.test.ts`): a flick coasts the same distance however the frames
  fall, a finger that paused does not fling the planet, the birth lands
  exactly on the finished planet, the governor never steps back up.

Generation tests run in Node — no DOM, no WebGL — which also keeps the layer
honest about not reaching for either.

## What is deliberately not tested, and why

- **Rendering.** Whether a shader looks right is a judgement made by eye in
  the browser, not an assertion. Snapshotting pixels across GPUs and drivers
  produces tests that fail for reasons unrelated to the code. Render code is
  kept thin so there is little logic in it to get wrong.
- **Three.js itself**, and that a mesh was added to a scene: that is testing
  the library, or asserting the code calls what the test expected it to call.
- **Frame timing and performance.** Measured in the browser with real
  hardware when it matters, not in a unit test. The governor's _rule_ is
  tested; whether a given phone needs it is not.
- **The service worker and the worker.** Both are thin glue around browser
  APIs that do not exist in Node. They were checked in a real browser
  against a production build: the worker builds the planet off the main
  thread (a New planet press returns in about a millisecond rather than half
  a second), and with the server stopped a link still opens and generates
  its planet. The deploy's smoke test fetches the manifest and the worker
  from the live site.
- **The terrain streaming, the sky and the fog on screen.** `terrain.ts`
  and the scene are glue around Three.js and workers; they were checked by
  flying in a real browser — patches refine with no cracks, the dive and
  Land work, the desert sky is orange and the night sky dark. Features and the
  ground patterns were judged the same way, on temperate, desert, ocean,
  frozen and volcanic seeds. The agent's
  preview pane draws only when it takes a screenshot, so how quickly the
  ground fills in while flying was not seen at real frame rates, and **a
  real phone was not tried**.
- **The birth animation on screen.** The agent's preview pane does not run
  animation frames while hidden, so the animation was not watched; its
  curve is tested, and it is applied in one small function (`pose`).
- **A coverage percentage.** Coverage is reported (`pnpm test:coverage`) but
  not gated; a target produces tests written to raise a number.
