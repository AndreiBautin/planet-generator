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
  union of its children (tested). They ride in the ground's own patches
  — see "Trees ride with the ground" below.
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
- **This is the planet and the glide, and it was briefly a game.** Eight
  commits (`303c1dc`..`4086e8c`) added a voxel landing, digging and
  building, a salvage airship with modules and fuel, a buried cache read
  off the world's landmarks, and marks drawn from orbit. Reverted in one
  commit on request — _"we've kinda lost the plot… took this from a
  portfolio piece that was supposed to show off graphics and flying"_ —
  and kept whole on the `expedition` branch, which is where to look if
  any of it is wanted back. What survives on `main` is what a reviewer
  sees in ten seconds: the orbit, the dive, the ground up close. Nothing
  from that work should come back as a default-UI feature; a flag or a
  separate page, if at all.

- **Trees ride with the ground, and the tiles are gone.** They were built
  in tiles of their own, and on a phone a tile built after the eye
  reached it was a wood springing up in plain view; a day of narrowing
  that down did not remove it, and they were switched off. Now each
  ground patch is built with the standing features on it, in the same
  request, so a tree cannot arrive after its ground. A patch carries the
  cells ranked under `treesKept` — every feature at the finest level,
  the low-ranked few at coarse ones, sized for the nearest the level is
  ever drawn at the governor's loosest threshold — and the shader shows
  an instance where its rank is under `(reach / distance)²`. A coarse
  patch's trees are the same trees its children carry (tested), so a
  patch giving way to its children changes nothing. Only what stands is
  scattered; floor cover stays painted. None stands in a river or lake.
  **What can still go wrong is the ground being late**: a coarse
  ancestor standing in close up carries too few trees for that distance.
  Judge that in real time — the recorder at 8 ms of sleep a frame gives
  the workers a quarter of the time a real frame does, and made the
  trees look as if they vanished when at real pace they held.
- **The terrain governs its own detail** (`govern` in `terrain.ts`): it
  measures how many levels behind the drawn ground runs and loosens the
  detail threshold while patches are late, tightening again once they
  keep up. A picture a step softer that is all there is a picture; fine
  ground landing after the eye arrives is ground sharpening under it.
  `TERRAIN_MORPH` is set from the governed threshold each frame.
- **Nothing in the ground shader is drawn only within a distance.** The
  sand ripples, snow ridges, stone cracks and procedural bumps all were,
  so each appeared ahead of the eye as it flew — and the cracks read as
  a honeycomb over a desert. Patterns that remain are filtered by
  `fwidth` so they blur away rather than switch, and the photographs
  carry the grain.
- **`?record` in a development build drives time and frames by hand**
  (`window.recorder.step(ms)`, `nudge`), so a flight renders exactly and
  can be compared frame to frame. The preview pane draws nothing on its
  own, and every flicker fix made without this was made blind.
- **The planet turns at two rates**: once in two minutes from orbit,
  once in eight in a glide, the angle carried forward at the blended
  rate so the change never jumps the ground.

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

## Rivers and lakes

`generation/hydrology.ts` works out the water for a whole planet once, on
the patches' own level-7 grid: a priority flood from the sea inwards (each
cell drains to the one it was reached from, so nothing flows uphill), then
rain gathered downstream. A river is a run of cells carrying `RIVER_FLOW`;
a lake is a hollow filled more than `LAKE_DEPTH` deep. It is deterministic
and memoised per planet, so every worker agrees and a river is in the ground
from the first patch that holds it — nothing about it arrives late.

- **`LAKE_DEPTH` was 0.002 and drew sheets of shallows** a few thousandths
  deep across whole river valleys. A shallower hollow is still filled so
  water flows across it; it is just not drawn.
- **The water's surface runs one vertex past a shore, level** (`inland` in
  `patch-data.ts`). Left following the ground there, the sheet climbed the
  bank and stood out of it as a jagged grey wall. Dry vertices otherwise
  sit at sea level, as the sea's sheet always did.
- **Inland water is flagged per vertex** (`inland` on the water mesh): no
  swell, no surf, its own shallows. A river is a few ten-thousandths deep,
  which by the sea's thresholds is all surf.
- **A river's banks are judged as level** for rock and stone; carved, they
  are steeper than any hillside.
- The recorder has `diveFrom()` and `glideFrom(position, heading)` so a
  look can start on a chosen feature rather than wherever Fly lands.

## The sea

Colour, surf and reflection are all read from the water's true depth
(`depth` on the water mesh) and the reflected ray, in `withWaterDetail`:

- **Turquoise over the shallows, ink over the deep** (`abyss`), so a
  sandbank shows as a paler patch out at sea.
- **Surf lines** are bands of equal depth moving shorewards, broken by the
  churn noise: they follow the coast's shape without anything knowing where
  the coast is. Not on inland water or under ice.
- **The mirror reads the sky the reflection meets**: `DETAIL_SKY` (the haze)
  at a grazing angle, `DETAIL_ZENITH` (thinner, bluer) looking down. From
  orbit the zenith is black, as there is no sky above the sea there.

## Clouds are three shells from one map

`cloudsFromTexture` returns the base deck with two children: brighter tops
3.5 thousandths higher, drawn only over the thickest cover, and a thin high
cirrus layer made in the shader alone. Children so that turning, scaling,
fading (`cloudsSeenFrom` walks them, each by its own radius) and release
all carry over unchanged; rain, cloud shadows and `cloudDataOf` still read
the base deck's map. **Cirrus streaks need bending and breaking**: plain
latitude-stretched noise read as evenly ruled corduroy from orbit.

## Tour and photo

**Tour** (`ui/tour.ts`, pure and tested) is an autopilot that only turns:
it looks ahead, left and right for land and banks towards it, and meanders
on a slow swing where it is land every way. Height stays the glide's own,
so a pinch still changes it mid-tour; a grab, a drag or a key takes over.
`stickFor` turns a wanted turn rate into the stick input the glide reads,
through the glide's own decay, so the tour flies the same aircraft a
finger does. **`heading × up` points right**, which the first draft had
backwards; the test flies it beside a coast to hold that.

**Photo** (the camera top right, or P) draws a frame and reads it back in
the same task (`scene.capture`), since the drawing buffer is not kept; the
page's controls are HTML over the canvas, so the picture is the view
alone. Share sheet where it takes files, a download otherwise.

**Five buttons fit a 375-pixel phone only with the narrow-screen gap and
padding** in `index.html`; a sixth needs a different layout, not less
padding.

## Measuring the ground's lateness

`recorder.terrain()` reports how many wanted leaves are drawn coarser
than asked and how near the nearest is; `recorder.root` is the three.js
scene, for bisecting what draws a given pixel (collapse half the patches
with `scale`, `recorder.step(0)`, read the pixel back). **Measure at
real-time pace** (a 33 ms sleep per 33 ms step): at 3–8 ms the workers
are starved and a coarse stand-in close up — a flat snowy lid on a
stretched rock face, a square of land in the shallows — looks like a bug
in whatever was last changed. At real pace on a desktop, nothing within
0.02 of the eye is ever drawn coarse, and within 0.04 in about a tenth of
frames.

- **Stitch is a band, not an edge row**: a finer patch beside a coarser
  one eases into the coarse shape over a quarter of its width, so a
  stand-in meets its finer neighbours without a straight seam.
- **A dry vertex holds the water sheet just under its own ground** (`DRY`
  in patch-data), and the sheet runs one vertex past every shore —
  sea included — level. At sea level, a plateau lake's sheet dived to the
  sea's height and could stand out of the hillside below.
- **Rivers carve through snow**; only their water is withheld there.
  Skipped on snow, the bed stopped dead at the snow line.
- **The cloud tops fade at grazing angles**: edge-on, two shells read as
  a slab with its sides missing.
