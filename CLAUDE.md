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
- **A biome is made of its features; nothing is dropped onto a base.**
  Reported as _"these seem like random entities dropped onto the original
  stuff"_. `featuresAt` (what stands) and `floorAt` (what covers the floor)
  in `generation/features.ts` run close to one thing per spot where a biome
  is at its fullest — a wood is trees crown to crown with scrub and grass
  under them, pack ice is plates edge to edge with ridges between, a lava
  field is column pavements, cones and rubble — and **the planet's kind
  gates what can grow**: an arid world is desert wherever it is dry enough
  and grows no forest from a damp patch of its noise (it did, and was
  reported). The ground answers to the same fields: `groupingsAt`
  (`generation/grouping.ts`) is read by both the scatterer and
  `samplePatch`, so the painted canopy follows the groves the trees stand
  in and the ground turns stony exactly where the rock lies; `relief.ts`
  draws dry lowland into dunes and snow into drifts, with
  `reliefWeightAt` letting dune country carry relief at a height where
  crags carry none. Rocks are half buried and take the ground's colour,
  grass the turf's.
- **Features stand on a fixed grid, not on the patches.** `scatterPatch`
  (`render/patches/scatter.ts`) takes two candidates per grid cell of
  `CELL` on each cube face, decided by a hash of the cell, so a feature is
  the same one whatever patch carries it and a parent tile is exactly the
  union of its children (tested). They stream in their own level-7 tiles
  near the camera (`flora.ts`, owned by `Terrain` so they turn with the
  planet), because the ground's finest patches only reach a flight's
  height away and a forest that existed only underneath is no forest.
  **Each instance shrinks into the ground over the last stretch of the
  range** (`featureMaterial`), because a wood that stopped at the tile
  line was the plainest sign of assets on a base. Past the range the
  ground shader carries the look: `patternAt` writes canopy, sand, snow
  and stone per vertex and `withGroundDetail` draws crowns, ripples, wind
  ridges and cracks from it — and inside the range the canopy slot draws
  the forest floor instead, through the `DETAIL_RANGE` uniform. The sea
  lifts in a swell near the camera (vertex displacement, held still at
  the shore and faded before coarse patches) with foam on the crests; a
  molten world's lowland runs with glowing channels and pools, and its
  sea is plates and seams.
- **The ground wears photographs, with the baked tiles as the first
  frame.** `public/textures/` holds six CC0 scans from ambientCG (Grass001,
  Ground037, Ground054, Rock030, Snow006, Rock035), colour and GL normal,
  cut to 512 px — about 0.9 MB, precached through `PUBLIC_FILES`. The zips
  they were cut from never enter the repo; the cutting was a one-off
  Pillow script, and each colour map's mean linear luminance is recorded
  in `PHOTO_MEANS` so the shader can level it. `textures.ts` starts every
  layer on the baked tile from `ground-atlas.ts` (ready the instant the
  page is) and swaps the photograph in on a shared uniform object when it
  loads — no recompile, every material at once. **The alien palette still
  rules**: `groundLayer` in the shader divides the photo by its mean and
  part-desaturates it before multiplying the biome colour, so an ochre
  world is ochre with grass-shaped grain, not green. The normal maps are
  laid on triplanar as tilts in the planet's frame and brought into view
  space through `DETAIL_NORMAL_MATRIX`, which the scene sets each frame
  from the terrain group's model-view. The path to `public/` comes through
  `config.assetBase` (the lint refuses `import.meta.env` elsewhere).
  Earlier reasoning kept to baked tiles because photographs of Earth's
  sand would be a lie about which planet this is; the levelling is what
  answers that.
- **A finger is a stick, not a hand on the camera.** Asked for as _"fly up
  down diagonal not just side to side"_, then _"flinging up and down moves
  the entire pov instead of tilting it like a plane would"_ and _"I'll go
  all the way across and barely turn"_. `steer` in glide.ts sets a rate of
  turn and a pitch the nose is asked for; `advance` flies it there — the
  heading swings at the rate, which dies away on its own, the nose follows
  the stick and the stick drifts back level, the altitude changes as a
  share of the speed, and the wings bank into the turn (`roll`, which
  `poseOf` applies to the eye's up). A drag the height of the screen is
  about half a turn (tested). Nothing snaps: a fling is felt over the next
  second or two, which is what makes it read as flying rather than the view
  being dragged. Arrow keys and WASD nudge it; pinch and wheel still set
  the height directly.
- **A tile arriving late grows up out of the ground.** Reported as _"stuff
  is rendering late which makes it feel fake"_. Features are fetched to
  `PREFETCH` times the range they are shown at, the tiles **ahead** of the
  camera first (`aheadOf` in lod.ts, which the ground's patches use too),
  and each tile has a material of its own carrying the moment it arrived,
  so its features scale up over `GROW_SECONDS` rather than appearing. One
  material per tile is cheap: the cache key is shared, so it is a few
  uniforms, not a compile.
- **The sea is Gerstner waves, in the vertex shader, with their own
  normals.** Four trains crossing (`withWaterDetail`), each pushing the
  surface along its direction as well as lifting it, so crests sharpen and
  lean; taller running into the shallows; foam where the surface is
  squeezed most (`v_jac`, the Jacobian's vertical term) and along the
  coast. Faded by view distance so coarse far patches are not torn from
  fine near ones, and held still at the shore. Wavelengths are planet-scale
  exaggerations (0.003–0.02 radii): a real swell is invisible from a glide.
- **Lava flows by flow mapping.** `withLavaDetail` carries the crust on a
  noise current and reads it twice, half a cycle apart, cross-faded — the
  only way a pattern moves without stretching forever — with brighter lava
  streaming along the seams; a molten world's land channels carry a fine
  noise down them. Judge motion on a device: the agent's pane shows stills.
- **The clouds churn in the shader.** `cloudsFromTexture` keeps the baked
  map for where the cloud is and, per pixel, bends where it is read with a
  slow noise and breaks the edges into billows that roll through over a
  minute or two. The map's bytes stay on the mesh (`cloudDataOf`) so the
  rain can ask how heavy the cloud over the eye is.
- **Rain is a shower around the eye, where the cloud over it is heavy.**
  `render/rain.ts`: a box of line streaks placed at the eye and turned to
  the local up each frame, falling in the vertex shader; `coverAt` reads
  the baked map the way `SphereGeometry` maps it (tested with one bright
  texel found by direction), in the layer's own frame, and only below
  0.12 radii up. Weather you fly through, not weather seen from orbit.
- **The sun throws shadows near the ground, from a box that follows the
  eye.** `sun.castShadow` only while flying under 0.2 radii up; the shadow
  camera is an orthographic box a few hundredths of a radius across kept
  over the ground under the camera (scene.ts), because a map over the
  whole planet gives a tree a fraction of a texel. Ground and features cast
  and receive, the sea receives. `quality.shadowMap` is 2048 on a desktop,
  1024 on a good phone, 0 on a modest one. The biases are in planet radii
  and tiny; raise them before suspecting anything else if acne appears.
- **Clouds shade the ground.** `cloudShadow` in detail.ts reads the cloud
  layer's own opacity map (`DETAIL_CLOUDS`) where the sun's ray from a
  point meets the layer, in the layer's frame — it turns 0.15 of a turn
  ahead of the ground (`DETAIL_CLOUD_SPIN`), and the sample is offset
  along `DETAIL_CLOUD_SUN` by the layer's height. The texture's mapping is
  `SphereGeometry`'s: u from `atan(z, -x)`, v from `acos(y)`.
- **A dive gains speed and a climb spends it.** `Glide.rush` (glide.ts),
  built from the pitch and bleeding off level; `speedOf` scales by it and
  the lens widens with it (`Pose.rush` → `camera.fov` in scene.ts). The
  one knob that made the flight feel fast was the field of view, not the
  speed.
- **A wood is a stand, not a sprinkle.** Reported as _"trees still spawn
  seemingly randomly"_. `groupingsAt` ramped softly, so every acre got a
  thin scattering; it is a sharp step now — a broad field says where the
  woods are, a finer one roughens the edge, the inside is solid and the
  outside bare but for a ragged margin of single trees — and rock lies in
  outcrops the same way. `grouping.test.ts` holds both bimodal: mostly
  solid or bare, little in between. The ground is painted by the same
  fields, so the canopy pattern and the forest floor stop where the trees
  stop.
- **The planet shadows what stands on it.** A tree's sunward facets were
  lit by a sun under the horizon, so the night side was black ground
  under white trees and floes. `featureMaterial` scales the direct light
  by the sun's height over the feature's own up.
- **Woods stop at the tree line and never grow on snow.** Asked as _"why
  does every biome have trees?"_ — snowfields grew "hardy pines just below
  the snow line" that read as white posts, and highlands grew forest to
  the peaks. `featuresAt`: nothing grows on the `snow` biome, trees thin
  out from height 0.4 and are gone by 0.62, the boreal belt wants the
  milder cold (warmth above −0.5) so a frozen world has a taiga band, not a
  covering; an arid world grows none; a molten one nothing living. Tested.
- **The features are smooth and roughened, not faceted.** Reported as
  _"still looks like a PS1 game"_. `feature-models.ts` subdivides each rock
  and crown and pushes every vertex by a hash of where it is (`roughen`),
  with smooth normals over the result; rock, boulders, columns and cones
  carry a `stony` attribute and wear the ground's stone photograph
  triplanar in the planet's frame (basalt on a molten world); everything
  else is shaded darker towards its foot so a crown has an underside. Floes
  and columns stay faceted on purpose — a plate of ice and a basalt column
  are flat faces.
- **No two trees are the same tree.** `modelsOf` in feature-models.ts
  gives the kinds there are many of several shapes — a spruce, a fir and a
  pine; a round crown, a poplar and an oak; two scrubs, two rocks, two
  boulders — and `featuresFor` deals a tile's instances out among them by
  their place in the tile, one instanced mesh per shape. The ground under
  them is mottled at field scale in `samplePatch` (lusher and drier,
  lighter and darker, from the fine fork), and its roughness follows the
  texture's height in the shader, with a sheen on snow.
- **Trees are green first and the palette second.** An ochre world's
  "lush" painted orange forests that read as dead ones; the forest also
  stops at real heat however wet the ground is. A pine is snow-laden only
  where the ground is snow — tinted by cold alone it stood as a white post
  on brown highland.
- **The sky shader only fills the sky.** Haze over ground is the scene's
  fog. Laying the shader over everything with the ground taken as a sphere
  washed low land out white, because real hills stand above that sphere.

## The game, and the ground as blocks

[docs/GAME.md](docs/GAME.md) is the design and the backlog. The first
piece is in:

- **Where the ground is has one home: `generation/ground.ts`.** `liftOf`,
  `drawnHeight`, `floorRadiusAt` and `groundRadiusAt` moved there from the
  renderer, and `SEA_RADIUS` with them (the render modules re-export, so
  nothing else moved). The patches, the glide, the features and the voxel
  landing all ask it, so none can disagree about where the ground is.
- **Where the features stand has one home too: `generation/placement.ts`.**
  The grid, the hash and the choice of what is in a cell came out of the
  renderer's scatterer, which now only sizes and colours what placement
  decided. `generation/cube.ts` is the cube-sphere (moved from
  `render/patches/`, re-exported there), with `faceUvOf` as the inverse of
  `directionOn`.
- **A landing is pure** (`generation/voxel.ts`, tested): a tangent frame at
  the landing point, a column's layers from its surface — grass over earth
  over stone, sand, snow, basalt, water or lava below sea level — and the
  features stamped into the air as block trees, stone and floes from the
  same placements the flyover drew. `BLOCK` is 0.0002 radii, so a tree is
  five or six blocks. **An area straddling a cube edge misses the strip over
  the edge**: features are read off the landing point's face only. Twelve
  edges on a planet; accepted until it is seen.

- **A chunk is meshed in the worker and placed by one matrix.**
  `generation/chunk.ts` (pure, tested) turns a landing's 16 × 16 columns
  into the visible faces only, with a one-block halo so edges are decided
  without the neighbour, ambient occlusion baked per corner, and per
  vertex which ground photograph the face wears and where on it; water and
  lava are a second mesh. `render/voxel/landing-view.ts` streams chunks
  around the surveyor through the builder's `chunk` request (the worker
  keeps the last landing, since stamping its features costs more than most
  chunks) and places the whole group with one matrix — moved to the
  landing point at sea level, turned so y is the local up, scaled by
  `BLOCK` — as a child of the terrain group, so it turns with the planet.
  A `Hole` (lod.ts) keeps the planet's own patches and features from being
  drawn under the blocks.
- **Walking is a third camera, on top of the glide.** `ui/walker.ts`
  (pure, tested): gravity, a body of 0.3 × 1.75 blocks, collision one axis
  at a time so a wall is slid along and a one-block step is climbed,
  swimming in fluid. `rig.drop` freezes the glide where it is and stands
  the surveyor at the landing's middle; it does not step until the chunk
  under the feet is in, or it would fall through the world. `takeOff` puts
  the glide back over the column walked to. `ui/walk-controls.ts` is
  installed in the capture phase and stops the event while walking, so the
  orbit and glide gestures on the same canvas never see a walking finger.
  Walking, the camera's near plane is a hand's breadth (`BLOCK * 0.15`)
  and the far plane 3: the depth buffer is spent on the blocks, not on a
  planet the blocks hide.

- **Landings snap to plots, and a plot's edits are saved.** `plotUnder` in
  scene.ts rounds the point under the glide to a grid on its cube face a
  little under an area apart (`PLOT`), so landing near the same place again
  gives the same frame and the same blocks — which is the only way edits
  there can be laid back over the ground. `app/saves.ts` keeps each plot's
  edits and the world's hold in IndexedDB, read as `unknown` and checked;
  an unreadable save degrades to an empty one with a warning. Digging is
  `generation/raycast.ts` (Amanatides & Woo, tested) against the landing's
  blocks; `LandingView.setBlock` edits the chunk and the halos of any
  neighbour sharing the edge and re-meshes those on the page in the same
  frame. A tap digs, Place or a right click builds, the hotbar is the hold.
- **Rows are anchored to the ground at the landing point, not the sea.**
  A landing in the mountains stands far above the sea and ran out of rows
  — the blocks clamped at the top of the column and the planet's own
  slabs towered over the camera. `BASE_ROW` is the ground at the origin;
  `seaRowOf` says where the sea is from there, below the floor on a high
  landing.
- **The agent's preview pane draws a frame only when it takes a
  screenshot**, so a landing streams in one chunk per screenshot and the
  walker does not step between them. A drop that "shows no blocks" there
  is the harness: take a burst of tiny screenshots to pump frames before
  judging. The planet turns once in twelve minutes now (`TURN_MS`), so a
  day on the ground is long enough to build something in.

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
