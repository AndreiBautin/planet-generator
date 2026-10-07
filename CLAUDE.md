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
  union of its children (tested). That scatter is gone; see "Trees are
  level of detail on the ground's own vertices" below.
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

- **Trees are level of detail on the ground's own vertices**
  (`patches/forest.ts`), and every earlier scheme is gone — tiles of their
  own, then trees baked into patches and thinned by distance. Both made a
  tree _appear_ somewhere it was already in plain view: the second by
  design, as each tree waited for its rank's distance, which from a glide's
  height was 20–80 pixels tall. Now a tree stands on a vertex of the
  `TREE_LEVEL` grid; finer ground shows its ancestor's trees, which stand
  exactly on it; coarser patches carry a quarter as many trees a level up,
  each twice the size. Over the ground's own blend distance, the trees a
  parent lacks shrink to nothing and the ones it shares grow to its size,
  so a change of level draws the same picture — coverage is constant and
  nothing appears. No worker time: the ground already holds the vertices.
  **The instanced geometry needs the model's index copied too**: without
  it every frame with a tree in it came out empty, with no error anywhere.
  Culled by each patch's bounds, as the model's own know nothing of where
  the instances stand. About 43k trees and 530k triangles before culling
  over a temperate glide on a desktop.

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

**P** takes a plain picture: it draws a frame and reads it back in the
same task (`scene.capture`), since the drawing buffer is not kept; the
page's controls are HTML over the canvas, so the picture is the view
alone. Share sheet where it takes files, a download otherwise.

**The camera button is postcard mode** (`ui/postcard*.ts`, the arithmetic
pure and tested). Pressing it **holds** the view: `rig.hold('frame')`
stops the flight (the seconds a frame read as nought, so no coast, no
tour, no climb) and `scene.hold(true)` stops the planet turning.

- **Time of day is the planet's turn.** The sun never moves; the hour at a
  point is how far round from the sun's longitude the turn has carried it
  (`hourAt`, `turnForHour` — longitude grows by the turn, as `intoRoom`
  does it). A glide is in the planet's frame, so turning the planet turns
  the sun over it; an orbit is in the room's, so after a turn the orbit is
  put back over the same ground (`rig.place` with `scene.orbitOver`).
- **A held glide is `stillGlide`**: level, at rest, its eye at exactly
  `ground(position) + altitude` — what `startGlide` makes. That equality is
  what lets a link reproduce the picture; the eye a moving glide carries
  eases towards the ground ahead and would not match. While framing, a
  drag turns (`faceGlide`) and tilts (finger up, nose up, as in flight),
  and the tilt goes in the link.
- **The card is composed on a 2D canvas, not in the grade pass**, so it is
  the same card on a phone that has no post pass. The preview over the live
  view uses the same grain tile (a hashed 128 px tile, overlay-blended, one
  tile pixel per CSS pixel) and the same `wordsFor` sizes, so what is framed
  is what is sent.
- **The link is `shot=`** (`app/link.ts`): `g,lat,lon,bearing,altitude‰,hour,tilt`
  or `o,lat,lon,distance,hour`, parsed totally — garbled or out of range
  opens the plain planet. Opened, it lands **held still** with no birth
  animation (`rig.hold('still')`), and the first touch lets it go and flies
  on from there; any button lets go too (`letGo`), because a held rig
  never finishes a Land.
- **Unchecked:** the share sheet itself (the preview cannot share files —
  the download was intercepted instead) and the card on a real phone.

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

## Dusk

The sky's own model (single scattering in `atmosphere.ts`) stayed bright
well past sunset while the land went black, because the light on the
ground followed the sun's own `day`. Now:

- **The sky light on the ground follows `twilight`** (the sun from 0.1
  down to −0.2), in the air's own colour rather than reddened sunlight,
  with extra fill while the sun is low and the sky still bright, and a
  faint cool `NIGHT_LIGHT` floor so the land is a shape at night.
- **The ground and the clouds take no direct sun past the terminator**
  (`groundDay`, `cloudDay`): a slope or a cloud's flank turned towards a
  sun already set glowed red across the dark.
- **Stars wait for the sun to be down** (`starlit`).
- **A warm glow round a low sun is added explicitly**, from inside the
  air only. Making scattering steeper with wavelength was tried first: it
  saturated the noon sky to a blue with no red in it, and with steeper
  loss only, a teal world's whole dusk sky went green — which is the
  physics of a teal sky, and not what anybody wants to fly into.

`recorder.sun()` gives the sun's direction in the planet's frame, to start
a glide at a chosen sun height. Don't read it off the light's position:
the shadow camera moves the light.

## Moons and rings

`generation/satellites.ts` decides them from the seed (tested: the same
every time, moons clear of the rings and of each other, rings on about a
quarter of worlds and never a molten one); `render/heavens.ts` draws
them, kept with the clouds when only a dial moves.

- **In the room's frame.** The rings lie in the equator, so the planet's
  turn about its axis leaves them where they are; the moons keep their
  own time (`update`, from the clock).
- **Moons are lit like the ground**, so their phases are just the sun on
  a sphere. Bigger and nearer than a real moon of their size, on purpose.
- **The rings' shadow on the ground** is `ringShadow` in detail.ts, from
  the same bands passed as 16 packed `vec4` uniforms rather than a
  texture: the ground's shader is already near a phone's texture limit.
  The planet's shadow on the rings is the ring shader's own.
- **The band texture lives in a uniform**, where `release` does not look;
  it is disposed by hand when a planet goes.

## Weather

Read off the baked cloud map, like the shower over the eye: a storm is
where the cover passes `STORM` (0.82), and nowhere else (`weather.ts`).

- **Storm bases are slate** in the cloud base's own shader.
- **Rain shafts** are instanced quads under the storm cells, children of
  the cloud layer so they drift with it, each turned to the eye about its
  own vertical. Faded close by, where the shower takes over, and far off,
  where from orbit a storm is its cloud. Coloured from the sky but well
  below it (`SHAFT_LIGHT`): drawn in the sky's own colour they read as
  pillars of light rather than curtains of rain.
- **Lightning** is decided by the clock and a hash of it, so a recorded
  flight sees the same storm every run: every few seconds, a look for a
  storm within a few degrees of the eye, and a double flicker there that
  lights the cloud from inside (`LIGHTNING`, in detail.ts so the cloud
  and the shafts can share it without a cycle) and the land through the
  sky light. About six flashes in thirty seconds of touring an ocean
  world.
- **Snow falls instead of rain on a frozen world** (`Rain.snows`):
  slower, short flakes, swaying. Not yet seen on screen.

## Sound

`render/sound.ts`, made in the browser from two seconds of seeded noise:
wind (band-passed, louder and higher with speed, silent in orbit), surf
(low-passed, in sets, only low over a coast, `coastAround` sampling sea
and land round the eye every few frames), rain (high-passed, the shower's
own strength) and thunder after each lightning strike, delayed and
softened by how far off it struck. **`mixFor` and `thunderFrom` are the
whole decision and are pure and tested**; the class only follows them.
Off until the speaker is pressed: browsers start audio only inside a
gesture. **Not heard by the agent** — the preview plays nothing; what was
checked is the gains moving with the flight (wind ~0.5 in a glide, surf
rising at a coast).

## Landmarks and the guided tour

`generation/landmarks.ts` finds a planet's highest peak, largest lake (a
connected run of lake cells) and longest river (source to mouth along the
drainage) on the hydrology grid, and names them from the seed
(`placeName`). Tested: the peak is the highest cell, the river runs
receiver to receiver into the sea or a lake, the lake is over water.

- **Only thawed water counts.** Water is not drawn on snow, so a lake in
  a snowfield is a dip in the snow; the first tour named one and showed a
  white hill.
- **Tour is guided now** (`guideStep` in `ui/tour.ts`, pure and tested):
  nearest sight first, high to cross the distance (a glide is faster
  higher) and low to arrive, down a river from its source to its mouth,
  lingering over the others, then wandering as before.
- **A sight is named as it comes into view, not when it is underneath**
  (`SIGHTED`, 0.06 rad): the glide looks ahead, and a caption over the
  spot directly below named something out of frame.
- Time of day is wherever the planet's turn puts it; a sight can be
  reached at dusk.

## Phone performance

Measured on the modest phone profile (`?record&cores=4`, 375×812, pixel
ratio 1.5, seed 83tzj46, a 600-frame tour at real-time pace) with
`recorder.stats()`, which reads `renderer.info` for the whole frame
(`autoReset` is off and the scene resets it once per tick, or it reports
only the last pass). Medians / p95:

|        | Draw calls | Triangles     | Script ms   |
| ------ | ---------- | ------------- | ----------- |
| Before | 191 / 221  | 0.86M / 1.18M | 13.6 / 29.7 |
| After  | 160 / 189  | 0.87M / 1.24M | 7.0 / 10.2  |

**Measured on a desktop GPU with the phone profile**, so the script time
is real and the fill cost is not. A real phone's frame time is unmeasured.

What cost most and showed least:

- **The stitch band allocated per vertex.** It rebuilt a closure and its
  neighbour list for every vertex of every patch on every neighbour
  change — 4.7 ms of the frame. The falloff is one array computed once
  (`stitchFalloff`) and a patch's neighbours are cached on its entry.
- **Trees were two draws per patch**, a trunk and a crown of each kind.
  One lathe model now morphs conifer to broadleaf per instance (the
  `broadleaf` attribute, `treeFate.z`), bark and leaf by vertex colour:
  one draw per patch, 77 calls down to about half.
- **Cirrus is off and the cloud shells coarser on a modest phone**
  (`quality.cirrus`, `quality.cloudSegments`). A third transparent shell
  over the whole screen is fill a phone pays for and a glance at a phone
  does not show.

**Measure at real-time pace.** Stepping the recorder with short sleeps
starves the build workers, so patches arrive late, stand-ins stay up and
the numbers describe a frame nobody flies. `?cores=N` pretends the
hardware count for `pickQuality`, development builds only.

## Seen at last: snow, the rings' shadow, the sound

Three features shipped on reasoning were checked on screen (seed `9tcwfzj`
is frozen and ringed; `83tzj46` temperate), and looking found four faults
no test could:

- **The water sheet did not geomorph, and speckled every world from
  orbit.** Past the shores it sits `DRY` under the ground; the ground
  slides towards its parent's shape and the sheet stayed put, so on any
  rough slope it showed through as dots of water — and of ice, on a frozen
  world. In the water shader a vertex with `depth <= 0` now slides to the
  coarse ground at the same depth under it. Found by switching the water
  material's `colorWrite` off and watching the speckle go; **hiding a mesh
  does not work for this, terrain resets `visible` every frame.**
- **A lake stopped at its deep cells.** `lake` was set only where the fill
  stood `LAKE_DEPTH` over the floor, and `waterAt` dilates by one cell, so
  the water ended where the grid did and shores were staircases. A lake
  now spreads over every flooded cell of its hollow at its own level
  (`hydrology.test.ts` holds that no dry neighbour lies under a lake). It
  made lakes about half as big again — **and stood trees up in them**, so
  `pattern`'s canopy is cleared wherever water covers the ground.
- **Pack ice was nought on every land vertex**, so a strip of open water
  followed the grid's triangles round each frozen coast. `ice` is now set
  from warmth everywhere; under the land the sheet is hidden anyway, and
  frozen lakes and rivers ice over as a bonus.
- **The rings shaded only the ground.** `ringShadowFrom(p, sun)` is shared
  now: the water dims its sun light under the bands, and the clouds take
  them too, with the sun in the cloud layer's frame
  (`DETAIL_CLOUD_LAYER_SUN`, turned `1.15×` as the clouds are).

**The sound was measured, not heard**: the gains read off the live graph
over a glide — wind ~0.45 in the air and none in orbit, surf ~0.44 along a
coast, rain 0.5 under a storm, three claps of thunder in twenty seconds
held under one. The levels are right; whether it sounds good is unchecked.

**`?shot=` is the way to put the camera anywhere for a check**: build one
with `shotOf` and `linkFor` in the page and open it with `&record`. A
module imported by hand after an edit is a fresh copy (`?t=` differs), so
read live state through the recorder, not through a second import.

**Not fixed, seen in passing:** land from orbit is a patchwork of
hard-edged dark polygons — the canopy pattern at coarse levels.

## Valley fog at dawn

Mist lies in the valley floors round sunrise and is gone by mid-morning
(`render/valley-fog.ts`, on the ground, the water and the trees). Each
point's own local hour decides it — the rule `ui/postcard.ts`'s `hourAt`
uses — so dawn sweeps round the planet with the day; 1:30 to 10:30, thickest
from 5 to 8.

- **Where: a depth baked per vertex** (`PatchData.mist`, the `mistTop` and
  `treeMist` attributes). The floor of the ground round a point is the
  drainage map's heights over two rings of cells, **their mean less one
  standard deviation** (`floorHeightAt`); mist stands `MIST_DEPTH` over it,
  about the lowest fifth of the land on the worlds measured. Over a lake or
  river it lies just over the water; over the open sea there is none.
- **A depth, not a height.** The first version stored the mist's top as a
  radius and compared it in the shader with the ground's drawn position —
  which is blended towards the parent's shape, so the mist read as under
  the ground almost everywhere and drew nothing.
- **Not a minimum, even a soft one.** A deep cell entering the rings as a
  point crosses a cell edge takes a minimum over at once, and the mist's
  edge stepped; `hydrology.test.ts` holds the floor continuous. Weights
  fall to nothing at the rings' edge for the same reason.
- **Not the lake's level over its shores.** The level a lake holds nearby
  comes off the drainage cells, and mist laid flat to it drew their square
  edges across the land.
- **Drawing:** how far the sight line runs through the mist — its depth over
  the point stretched by how shallowly the line climbs, the whole line when
  the eye is in it — at density 380, never more than 62% opaque, broken by
  two frequencies of roll so it is wisps rather than a sheet. **Paler than
  the sunlight**: lit by the dawn sun's own orange it read as sand. Fades
  out above ~0.1 radii, where it is a grey stain rather than mist.
- **The trap that cost the most time:** the scene rewrites the mist's
  colours every frame, so a debug test that set them to red and then
  stepped a frame painted nothing and looked like the effect was dead. The
  honest test is the density: at 180 the shallow mist was simply invisible.

## Volcanic worlds: plumes, embers, lava light

- **Volcanoes are the tallest summits** (`generation/volcanoes.ts`, tested):
  drainage cells higher than all eight round them, tallest first, at most
  14, kept 0.12 radians apart. None on a world that is not molten.
- **A plume is a stream of puffs, not a quad** (`render/volcanic.ts`). One
  tall billboard was tried first, shaded every way, and always read as a
  beam of light. Each volcano has 28 soft round sprites that leave the vent,
  rise, bend downwind (so a plume is visible from orbit as a trail rather
  than end-on) and grow as they thin, then start again — motion as a
  function of time in the shader, nothing moved per frame. Brown-grey ash
  lit on top and shadowed beneath, near black on the night side, and orange
  at the foot from the vent. Children of the terrain group, released with
  it (`userData.withGround`).
- **Embers** are the rain's arrangement going upwards: points in a box
  round the eye, additive, flickering, dying as they rise, on a molten
  world below about 0.05 radii.
- **The lava sea lights the ground just above it**, falling off over
  0.0009 radii. The first strength lit whole slopes like daylight.
- **Seen in passing, not fixed:** on the night side of `h999999` a low
  slope near the lava draws pale cream, as though lit — it was there before
  any of this, and its cause is not yet found.

## Tilt and seasons

Each planet leans by a seeded `tilt` (3° to 34°, `rng.fork('tilt')`, so no
other draw moved), and **Season** is a fourth dial (`s=` in the link, 0 the
north's midsummer, 0.5 its midwinter).

- **The sun moves, the planet does not.** The spin axis stays y, as every
  other part assumes (clouds, rings, hydrology, latitude bands); the sun's
  declination is `sunDeclination` = tilt · cos(2π·season), set on the light,
  the sky's own sun uniform and everything that reads `sunDirection`, every
  frame. Its side of the room never changes, so the turn is still the time
  of day and the postcard hours still read true. Midnight sun and polar
  night follow from the geometry alone.
- **The cold moves with it**: `surfaceAt` adds uy · sin(declination) · 1.1
  to warmth, so the summer pole sheds its snow and the winter one spreads
  it — at 34° tilt to the mid-latitudes. It is a dial, so it rebuilds the
  ground like the others.
- **The default is the equinox (0.25)**, where both terms are nought: every
  link made before seasons opens on exactly the same ground. The light's old
  fixed place stood 15° north; that is the one thing an old link shows
  differently, and only in where the shadows fall.

## Aurora

`render/aurora.ts`: a curtain round each pole, on an oval about 21° from
it that wanders a few degrees, standing from 1.016 to 1.06 radii, drawn
additively — green at its foot, red and violet up its height, rays
drifting along it. Put out on the day side and through twilight by the
sun, so it is seen through polar night and on any night side near the
poles. None on molten or arid worlds; its brightness is the seed's own
(`auroraStrength`).

- **It lives in the heavens' group**, built and released with the moons and
  rings, in the room's frame and scaled with the planet's birth.
- **It lights the snow under it** (`DETAIL_AURORA`, in the ground's light
  block): a faint green on the night side under the band. At three times
  the shipped strength the snow read as green daylight.
- Seen: from orbit as a folding oval over a 34°-tilted world in polar night
  (`9jkv67g&s=50`), and from the ground beneath it.

## Surf and coasts

The coast's foam was there and too narrow to see from a glide. In the
water shader now:

- **The wash**: a band of foam at the water's edge whose reach runs up and
  back (`reach`, a few ten-thousandths of depth, on a slow sine broken by
  the churn), seen out to about a radius-unit of view distance.
- **Breaking lines**: `fract(depth · 1250 + time · 0.22)` — a sharp front
  with foam trailing on its seaward side, between depths 0.0002 and 0.0034,
  broken by the churn. Lines of equal depth follow the coast's shape and
  run in towards it.
- **A turquoise band** along the beach where the sand shows through, laid
  over the shallows' existing lightening.

All three are off over ice and on lakes and rivers (`v_inland`). Seen from
a low glide along a bay on `83tzj46`; a faint diagonal shading in the
deeper water there looked like a level-of-detail seam at first and moved
with the view as the shelf's edge, so it was left.

## Atlas

The globe button under the camera opens every world this browser has been
to, kept ones first, each with a picture from orbit; a press opens it, the
star keeps it. Stored in this browser only — no account, nothing sent.

- **`app/atlas.ts` is the model, pure and tested**: one entry a seed (a dial
  moved on a world updates its entry rather than filing a world per notch),
  the newest first, at most 24 unkept, kept ones never pushed out, and
  `parseAtlas` reading storage as `unknown` and dropping whatever it cannot
  trust — a picture must be a `data:image/` URL.
- **`ui/atlas-store.ts` is the only file that may touch `localStorage`**,
  and a lint rule (`no-restricted-globals` and `no-restricted-properties`)
  says so; proved by a probe file that both forms were refused in.
  A full store drops the older pictures and tries once more.
- **The picture is taken 3.5 seconds after a world is shown**, only if it
  is still that world and the view is still the orbit (not a glide, not a
  postcard): `scene.capture`, cropped to the middle square, 160 px JPEG,
  about 9 KB.
- **In the agent's hidden pane nothing is filed** unless frames are stepped
  with `?record`: a world only counts as shown once its ground has arrived,
  which needs frames.

## Star systems

Zooming out past the farthest orbit (wheel or pinch, a deliberate push
rather than one notch: `rig.onBeyond`) or the system button shows the
planet's star and its worlds; choosing one flies there.

- **The system is decided by one seed, its home** (`generation/system.ts`,
  tested): three to six worlds, the home among them, the others' seeds
  derived from the home's, orbits widening outwards by a ratio. A sibling's
  link carries `sys=<home>` (`app/link.ts`), so every member opens the same
  system; without one a planet is the home of its own. New planet makes a
  new home; reopening from the atlas does too (the atlas does not keep the
  home — a sibling kept there becomes its own system's home).
- **The journey is one unbroken shot**: `rig.dolly` eases the orbit out to
  18 radii (past the usual limit, by ratio so the far end is not a crawl)
  with the system's picture up and the destination ringed; the next world
  is made and born where this one was (`show(true)`, the birth animation);
  then the camera dollies in to 3.2. The old world stays on screen, small,
  until the new one's ground has arrived.
- **The picture is SVG** (`ui/system-panel.ts`): orbits as slanted
  ellipses, each world a lit globe in its kind's sea and land, nearer ones
  drawn over further, with a list of buttons under it for a finger or a
  keyboard. The view's own controls step aside while it is up
  (`.systeming`).
- Checked: from 83tzj46, opened the system (Xarzuhu, four worlds) and flew
  to Quique, which arrived as a frozen world with `sys=83tzj46` in its link.
  The journey's middle was not caught on screen — a canvas grab in the
  hidden pane took only a corner of the device-pixel buffer.

## Loose ends, round four

- **The pale slope on a volcanic night was a lava pool glowing as one
  sheet.** Found by elimination: the scene's three lights and the haze
  changed nothing, and switching off the volcanic ground material blacked
  it out. A pool now crusts over like the sea, dark plates and the glow in
  the cracks between them (`crack` in the lava ground block).
- **The patchwork on land from orbit was the canopy threshold on a
  per-vertex weight.** Far off, each vertex's wood weight spreads over its
  fan of triangles as a hexagon, so any threshold drew hexagons. Widening
  the threshold did not help; past `pixelSpan` 0.0006–0.004 the weight now
  darkens the land directly, with no threshold, and the woods are soft
  shading from orbit. Checked by switching the canopy off entirely (the
  patchwork went, and so did the forests) before choosing the fix.
- **The atlas keeps a world's system** (`AtlasEntry.home`, read as the seed
  itself for an entry written before), so a sibling reopened from it is
  back in its own system.
- **The journey between worlds was seen on screen at last**: grabbing the
  whole canvas buffer scaled down (the earlier grab drew only a corner of
  the device-pixel buffer) shows the home world shrinking away, the next
  born small in its place and growing as the camera comes in.

## City lights

Temperate and ocean worlds are lived on (`generation/settlements.ts`,
tested): every land cell of the drainage map scored for coast, a big river,
low ground and a mild climate (with a little chance, so the best sites are
not all one coast), up to 150 towns kept apart, the best sites largest.

- **Lights**: each town a cluster of points, gaussian round its heart,
  never on water; roads of fainter points between near neighbours, bending
  a little. Additive, warm sodium or cold white, lit only where it is dark
  (on through the dusk). Lifted in proportion to how far off they are seen,
  so a coarse patch drawn over the true ground does not swallow them.
- **Glow**: points alone are a few sparks from a glide, so the towns also
  bake a glow map (`townGlow`, 1024 × 512, read in the ground's light block
  as `detailCities`) — warm light on the ground round each town at night.
- **Made in the build worker** (`lights` job in `work.ts`): scoring the
  planet's land is ~0.6 s, a hitch on every arrival when it ran on the
  page. Asked for after the ground near the eye, and dropped if the planet
  changed before it came.
- **The worker's planet cache now keys on every dial.** It left out the
  season, so moving the Season dial within a session handed back the old
  planet and the ground kept the old snow line — a bug from the seasons
  round, caught while adding the job.

## Waterfalls and rapids

- **Rapids are the river's own slope** (`rapids` in `patch-data.ts`, a water
  attribute): the gradient of the water level across each river vertex, in
  radii per radian, white from 0.15 to all white at 0.45. Taken **one-sided
  where only one neighbour is water** — a river is often a single vertex
  wide, and asking for water on both sides found white water on almost
  nothing. Only between water and water, so a bank never reads as a fall.
  About 8% of inland water vertices carry some, 1% are all white.
- **The shader** (`withWaterDetail`) pales the aerated water and lays
  streaked foam over it, solid from afar so a fall shows as a white thread
  from a glide. Damped by ice.
- **Spray at the big drops** (`generation/waterfalls.ts`, tested; spray in
  `render/waterfalls.ts`): river segments of the drainage map that fall at
  least 0.05 to the next cell, the 20 steepest kept apart, each **snapped
  onto the channel as drawn** — `waterAt` wanders a river off the line
  between cell centres, and spray placed on that line hung over a dry
  hillside. None on snow, and none where the water ices over (warmth under
  `FREEZES + 0.3`): the first fall looked at was a frozen river in fog.
  Puffs like the volcanic plumes, low and pale, gone from orbit.
- **Found in the build worker** (`falls` job): it needs the drainage map,
  ~0.4 s when the page had to make its own.

## Birds

- **Where** (`generation/birds.ts`, tested): at most one flock to a cell of
  the drainage map, decided by the cell and the seed alone, so a flock is
  always over the same valley. Gulls over the sea, mostly near coasts; dark
  land birds over the ground, fewer the drier it is. None on a molten
  world or where the water would ice.
- **Drawn** (`render/birds.ts`): a few triangles a bird — body and two long
  narrow wings bent at the elbow (broad wings read as scraps of paper) —
  instanced, every turn, bank, wingbeat and glide a function of time in the
  vertex shader. Gulls white with black tips, beating slower and gliding
  more; land birds near black, flying clear of the canopy. Gone to roost at
  dusk.
- **No popping**: the flocks are those of two rings of cells round the eye,
  re-gathered only when the eye changes cell, each kept in its slot; a bird
  fades out by 0.02 radii, well inside the rings' reach, so a flock joining
  or leaving the set is never seen to. Nothing at all above 0.06.

## Eclipses and meteors

- **Solar eclipses** (`render/eclipse.ts`, tested): a moon between the sun
  and the ground throws its shadow — a dark core (6% of the sun left) and a
  soft edge that widens with distance behind the moon. The moons' positions
  go to the shaders each frame as `vec4(centre, radius)`, in the ground's
  frame (`DETAIL_MOONS`) and the cloud layer's (`DETAIL_CLOUD_MOONS`, which
  turns faster). Ground, water, clouds and **trees** all read it; trees
  needed a planet-frame varying (`vTreePlanet`) to. With moons 4–9 radii
  out and orbits tilted a little, a shadow crosses the world on many turns
  of a moon, for some seconds. Under it the whole day dims — the exposure,
  sky and all, not only the ground — when the eye is low.
- **Lunar eclipses**: a moon in the planet's shadow (`moonLight`) dims to a
  dark red and glows faintly, the red of every sunset on the rim at once.
  Seen on screen: a dark red-brown disc beside the planet from a wide
  orbit at dusk, back to grey once it left the shadow.
- **Meteors** (`render/meteors.ts`): 32 streaks, each waiting 14–40 s and
  burning for under a second somewhere new, all a function of time in the
  shader; a third of worlds are in a shower, three times as often, all
  fleeing one radiant. Only on the night side from low down.
  - **Drawn 0.3 radii out, past a glide's horizon**, so a ridge or a cloud
    in front hides one by depth, as it would.
  - **Mostly low in the sky**: a glide looks slightly down, and sees the
    sky only to about ten degrees over the horizon. The first version put
    them from 17° up and **none was ever on screen** — found by forcing
    every streak to burn and seeing the one that happened to be in view.
  - **Double-sided quads**: which face a streak turns to the eye depends
    on which way it runs, and half of them were culled.

## Weather that travels

`render/winds.ts`, tested. The cloud map is carried by winds by latitude —
easterly in the tropics, westerly at the middle latitudes, easterly again
near the poles — so a storm comes up over the horizon, passes and goes on.

- **Two copies, half a period apart.** Carried as it stands the field
  shears without end (two latitudes drift apart for ever), so each copy is
  reborn every 300 s somewhere new round the world. A copy is worn away
  towards rebirth, edges first and cores last, **all the way to nothing at
  the moment it is reborn** — at 0.6 its storm cores still showed faintly
  and popped. The two are joined by keeping the heavier reading, not by
  averaging, which washed every storm to half. One copy is always whole.
- **One reader.** The layer, its shadow on the ground and water, the rain
  shafts (drawn once per copy, turned by their latitude's wind and faded
  as their copy wears), the shower over the eye and the lightning all read
  the cloud through `winds.ts`, so a storm is where it is drawn.
  `coverAt` moved there; `rain.ts` re-exports it.
- **Checked by frame difference**: crossing a rebirth changes the picture
  no more than any other second. The motion itself is held by a test, not
  watched on screen.

## Flythrough clips

The Clip button (`ui/clip-button.ts`) records ten seconds of whatever the
view is doing — a glide, a dive, a stretch of the tour — as a video with
the world's name over the opening and the sound if it is on.

- **Copied as each frame is drawn** (`scene.onFrame`, `ui/clip-recorder.ts`):
  the view's canvas is cleared once a frame is shown, so read on a timer of
  its own it is black. Each frame is drawn onto a canvas of the clip's size
  (no wider than 1280), the title laid over it, and that canvas streamed to
  `MediaRecorder`. MP4 where the browser can make it (what phones play and
  share sheets take), WebM otherwise (`clipFormat`, tested).
- **The sound** comes from a tap on the soundscape's master
  (`Soundscape.stream`); only its picture tracks are stopped after, or the
  next clip would be silent. None if the sound has never been on.
- **Saved by a second press**, not when recording ends: the share sheet
  only opens inside a press, and ten seconds on the press that started the
  clip no longer counts. The button turns into a save arrow for it.
- Checked in the preview with downloads stubbed: a 960 × 600 MP4 of a glide
  with the title in it, played back. **The sound is in it**: with the sound
  turned on by a real press, a glide's clip decoded to audio peaking at
  0.6. From orbit the track is there and silent, which is the soundscape
  being quiet up there, not the clip. **The share sheet was not
  exercised** — it needs a phone.

## Under the sea

The Dive button (shown while flying) takes the glide under the water,
over the sea bed (`floorRadiusAt`, the ground without the sea laid over
it) and under a ceiling just below the surface, so passing waves do not
lift the eye into the air (`rig.submerge`). Pressed again, or once the
water is too shallow to fly in, the glide comes up.

- **Neither crossing is a jump**, and both were at first. Going in, the
  ceiling held from the moment of the dive and put the eye under the
  water in a frame; it now holds only once the eye has sunk past it.
  Coming up, the air's clearance over the sea put the eye 0.01 higher in a
  frame; the glide now keeps flying over the sea bed (`rising`) until it is
  clear of the water, then hands over at the height it was climbing to.
  Checked by tracking the eye: no step larger than an ordinary frame's.
- **What it sees** (`render/underwater.ts`, applied last in the frame so it
  overrules the air): the haze becomes the water's, teal and paler near the
  surface, dim at night; the sky, clouds, moons, birds, meteors and rain
  go; the surface is drawn from below as a bright rippled ceiling (the
  sea's material goes double-sided only while under); the sun through the
  waves draws caustics on the sea bed (`DETAIL_UNDER`), fading with depth;
  and specks of marine snow hang round the eye.
- **Dived to a third of the depth**, near the sea bed, where there is
  something to see: at half the depth the bed was a fog.
- **At night it was a black screen**, which reads as broken: the water now
  keeps a fifth of its light, and the marine snow glows faintly blue-green
  of its own after dark, so a night dive is a dark full of sparks.
- **`rig.test.ts` holds the dive**: under and staying under, refusing a
  lagoon, coming up by itself in the shallows (and saying so), and no step
  through the surface bigger than a frame's settling — that last one fails
  if the ceiling is held from the moment of the dive, as it first was.
- Not seen: a phone.

## Sunbeams

`render/sunbeams.ts`, a pass on the finished frame before the bloom: each
pixel looks back along the line to the sun, gathering the frame's
brightness above a threshold with each step counting less, and adds it in
the sun's own colour. The bright sky round the sun is the light; a cloud,
a ridge or a tree between is dark and leaves a dark ray behind it, so the
beams fall exactly where the picture shows a gap.

- **Strength** (`sunbeamStrength`, tested): strongest with the sun low and
  in view from near the ground, much less overhead, gone below the horizon,
  from orbit, under the sea, and with the sun well off the screen (a point
  behind the eye projects mirrored, so it counts as not in view at all).
- **Tuned by eye with a switch**, since the first strength drew nothing
  anyone would notice: 3.5 times that is clear rays over the trees at dusk
  without washing out the land.
- **Only with the post pass**, so not on a modest phone, which draws
  straight to the screen.

## Rivers that flow

- **The current** comes from the drainage map (`waterAt` → `flow`, tested
  to run towards the cell a river drains into and along the ground): each
  nearby stretch's direction, weighted by how near it is, so it turns
  smoothly round a bend and through a confluence rather than switching
  where one stretch's reach ends. Per water vertex as `current`
  (patch-data.ts), as long as it is fast: a slow stretch half, white water
  two.
- **The shader carries ripples and foam down it**, streaked along the flow,
  as a flow map: two readings half a cycle apart, each carried for a cycle
  (about three seconds) then begun again elsewhere, blended so neither
  jumps. Carried for ever, a bend would stretch the pattern without end.
  The rapids' white water rides the same current.
- Checked in the preview by frame difference over a second: the river
  changes, the land beside it does not. **The direction was checked by
  the test, not by eye.**

## Reefs and fish

- **Reefs** (`reef` in patch-data.ts, a ground attribute; drawn in the
  ground's shader): warm sea bed from just under the surface to 0.006
  down, as clumps of coral in reds, oranges and violets with the plain bed
  between. Seen through the shallows from above — the turquoise lagoons
  read as reef flats — and close to on a dive.
- **Fish** (`generation/fish.ts`, tested; `render/fish.ts`): at most a
  school to a sea cell, by the cell and the seed, on rolls of their own
  (the birds' rolls would put a school under every gull flock). Silver
  and blue anywhere open, orange too where it is warm. Drawn only under
  the water, side-on with a beating tail, circling between the bed and
  the surface, hazed by the water by hand (a shader of its own takes no
  fog).
- **Kept to the cells round the eye by `NearCells`** (render/near-cells.ts),
  now shared with the birds: things in two rings of cells, each holding
  its slot while near, so nothing pops.
- **Tuned on the dive**: at first the nearest school was always just past
  the fade (0.012) and a seen one was five pixels long. They fade at 0.02
  now, as far as the haze lets anything be seen, and are drawn larger than
  life, as the birds are.

## Sister worlds and the galaxy

- **The galaxy's band** (`galaxyBand` in generation/stars.ts; drawn in
  `buildSky`): its plane from the seed, 6000 faint stars crowded along it
  as a bell either side and clumped into a few clouds, and behind them a
  soft glow, mottled, edge frayed, with a dark lane down its middle. The
  first glow was a broad even grey sweep; narrowed and made clumpier.
  Fades with the stars by day (the sky's opacity now walks its children).
- **Sister worlds** (`skyWorlds` in generation/system.ts, tested;
  `render/sisters.ts`): the system's other worlds where they would stand
  from here, the star in the sun's direction and the orbits in the plane
  holding it and the horizontal square to it. Brightness with size
  squared, over the square of the distance between and of the world's own
  distance from the star, and with how much of its lit face is turned
  this way — beyond the star full, between a dark crescent (which can
  still out-shine a far full one, being near: the test says so). Drawn as
  small discs with a glow, in pale versions of their colours, coming out
  a little before the stars. Recomputed only when the sun moves.
- Seen: an evening star over a sunset from a glide, and the band behind
  the planet from orbit.

## Towns you can see

`render/towns.ts`. The buildings and roads are **made from the lights**
(settlements.ts, placed on the drawn ground in the worker): each light of
a town is a house, and the fainter lights strung between towns are a
road, so a house stands wherever a window is lit at night and the two
cannot disagree.

- **Houses**: boxes with pitched roofs, white to ochre walls, red roofs,
  bigger towards a town's bright heart, each turned its own way and sunk a
  little so a slope does not stand it on a corner. Instanced, one mesh per
  cell of the drainage map, so only cells near the eye are drawn; they grow
  up out of the ground from 0.05 to 0.032 radii rather than appearing.
- **Roads**: a narrow strip along each run of road lights, broken where
  two lights are further apart than 0.0045 (another road), faded with
  distance as the houses grow.
- **Town lights now keep off rivers and lakes** (settlements.ts, `dry`,
  tested): the first low pass showed houses standing in a river channel
  and on a waterfall's lip. That moves the lights too, which is right.
- **The threshold between a town's light and a road's is 0.44**, not the
  0.45 a town light starts at: stored as a float32, 0.45 comes back a hair
  under it, and the faintest houses vanished.
- Not done: trees still grow among the houses.

## Lighter first load

- **Three.js is a chunk of its own** (`codeSplitting` in vite.config.ts):
  about 575 kB of the 815 the app was in one file. It changes only when
  the library is upgraded, so a deploy of the app leaves it cached on
  every device that has opened the app before; the app's own chunk is
  about 245 kB (81 gzipped). The size warning is set just above three's
  chunk (600 kB), so a real jump still warns.
- **The optional panels were not split off**, on measurement: clips,
  postcards, the atlas and the system view are a few kB of the app's
  chunk, and loading them on first use would make the clip and postcard
  buttons start asynchronously for almost nothing.
- Checked by serving the production build: both chunks load, the planet
  draws, no console errors.

## Flicker from orbit (reported on a desktop)

Found by holding the camera, stepping frames 16–33 ms apart and marking
pixels that change a lot and change back. That is how to look for it
again: a screenshot shows nothing.

- **The cloud map had no mipmaps.** Sampled minified with the winds
  (winds.ts) and the turn moving it a fraction of a texel a frame, each
  pixel landed on a different texel each frame and every cloud edge — and
  every coast under a cloud's shadow on the ground — sparkled. Mipmapped
  now, and so are the moons' faces and the towns' glow map, which had the
  same fault. Flipping pixels fell three to four times.
- **The coral read raw from orbit.** Its clumps and lumps were finer than
  a pixel and every warm coast sparkled; each noise now fades to its
  average once a pixel spans its grain, as the canopy's always did. So do
  the clouds' billows, for the planet's rim, where the shell is seen
  edge-on.
- **The near plane stands back from orbit** — half the way to the nearest
  thing that can be in front (the air, a ring, a moon), where it was capped
  at a tenth. Not the cause, as it turned out, but ten times the depth
  precision from orbit for nothing.
- **Left:** the rim itself (silhouettes crossing pixels as the planet
  turns, under 4× multisampling), rain (by design), and a faint line where
  a waterfall's sheet meets the cliff's foot.
- **A new noise in a shader fades by its own pixel span**, or it will
  sparkle from orbit. `pixelSpan` in the ground shader, `cloudSpan` in the
  clouds'.

## Towns, finished

- **Trees cleared under the houses and across the fields**
  (`townCoverOf` in settlements.ts, tested; read in patch-data.ts as the
  canopy is decided): `house` near a town light, `farm` in a ring round
  each town out past its houses, both bucketed by drainage-map cell so a
  point asks only about what is near. A wood used to stand through the
  roofs.
- **Fields** (`farm`, a ground attribute; drawn in the ground's shader):
  plots of ripe wheat, green and ploughed earth with darker hedges, on open
  ground — thinning on a beach or a steep slope rather than ruled out by
  any at all, which left a coastal town's fields at nothing. Faded to their
  average colour once a pixel spans a plot.
  - **The plots are laid on the two axes the ground faces least along**,
    as a cube's face would be. A frame of the point's own (east and north
    at that point) is square to the point, so `dot(p, east)` was nought
    everywhere and every point read the same plot. A grid turned by a noise
    was tried and drew the hedges as wavy streaks.
- **Lit windows at night** (`growNear` in towns.ts): two rows of small
  warm panes along each wall, three houses in four lit, coming on through
  the dusk.
- **`TOWN_LIGHT` lives in settlements.ts now**, shared with towns.ts, so
  the house and the cleared ground under it cannot disagree about which
  lights are houses.
- Seen: the town in open grass with fields round it by day, and windows
  lit against the town's glow at night.

## Harbours and ships

A coastal town has a harbour (`generation/harbours.ts`, tested): the
nearest shore to its heart within its reach, a pier out from there, and a
**mouth** a little offshore that must be open sea — twice over, so a lake
or a narrow inlet is no harbour. **Lanes join two mouths when the great
circle between them is sea at every sample**; a ship goes out along it and
back, so a lane is a closed loop. A harbour with no lane keeps a loop of
its own offshore if the water there is open, so no harbour sits empty.
Computed in the worker with the lights (the `lights` job carries
`harbours`), because it walks the surface thousands of times.

`render/ships.ts` draws them: piers as instanced boxes on posts, ships as
an instanced hull with a **square sail across the ship** — a fore-and-aft
sail was drawn first and read as a sliver from astern, which is where a
glide nearly always sees a ship from — and a **V-wake**, two foam arms
spreading from the stern with churned water between that fades first.
**Ships move by `DETAIL_TIME`**, along the lane by arc length, so every
device puts a ship in the same place at the same moment, and are drawn
only within 0.06 rad of the eye: from orbit a ship is a speck that
sparkles as it moves.

**Checking it was the hard part, and the method is worth keeping.** Record
time is deterministic (`DETAIL_TIME` is 5.95 s after 150 steps of 33 ms),
so a `Ships` built in the page from `harboursOf` and updated to that time
says where a ship will be; `shotOf` aims a held-still glide link at it,
and a canvas readback diffed with the group shown and hidden finds it on
screen. A glide link's altitude must be at least 4‰ or the link is
refused and the app opens in orbit — the first two attempts did exactly
that, silently. The ship came out under the HUD at the bottom of the
frame; screenshots in record mode can be stale, so the crop was drawn into
an overlay image and that was screenshotted.

**Ships are lit like houses**, so in the blue daytime haze both read cool;
the hull colours were lifted once for that. **Not seen: a pier on
screen** — its matrices were checked numerically (on the shore, along
`out`, tiny) but no view in the session put one in frame.

## Kelp, light under the sea, and reefs from below

- **Reefs could not be seen from below, and the cause was the dive, not
  the reef.** Warm seas here run 0.006 to 0.008 deep, reefs thinned out by
  0.006, and the dive wanted 0.006 of water under its ceiling (0.0072 in
  all) — so every reef was in water too shallow to dive into. Two changes:
  `DEEP_ENOUGH` in rig.ts is 0.0042 (a little over the 0.0025 the glide
  keeps off the bed, so a dive has room before it surfaces by itself; a
  lagoon at 0.002 is still refused, and `rig.test.ts` → "dives into a warm
  sea" fails at the old value), and reefs stay full to 0.007 and fade by
  0.012 (`REEF_FULL`, `REEF_DEEPEST` in patch-data.ts). Seen: coral clumps
  across the bed on a dive, fish over them.
- **Kelp** (`generation/kelp.ts`, tested; `render/kelp.ts`): the cool
  sea's reef, at most a forest to a drainage cell where the water is too
  cold for coral (`KELP_WARMEST` 0.2) and open, on rolls of its own apart
  from the fish. Each stalk a ribbon of twelve segments from the bed most
  of the way to the surface, blades widening and narrowing, twisting as
  it rises, swaying with the swell and leaning with a current — all in the
  shader by time. Grows only where the bed is 0.0035 to 0.016 down, which
  is water a dive can be in: the first range (to 0.009) put nearly every
  forest where no dive could reach it. Kept round the eye by `NearCells`
  as the fish are.
- **Kelp lit by the haze as the fish are came out the water's blue**, and
  then pale grey-pink once lifted; colours are linear in these shaders and
  read twice as pale on screen. Dark olive values, a lighter rib and
  ruffled edges, so a blade close by is not a flat plank.
- **Light shafts** (`render/sea-light.ts`): soft additive quads hanging
  from the surface, slanted the way the sun comes in and bent towards
  straight down, fading as they fall and shimmering as waves pass. The
  sunbeams pass is off under the sea, since it works from the sun's place
  on the screen. **Anchored to a lattice on the planet**, one shaft to at
  most half the cells, so swimming moves through them rather than
  carrying them along; gathered each frame round the point of the surface
  over the eye (deep down, the eye's own cells never reach the surface)
  and faded out by distance from that point **inside** the lattice's
  reach, so none pops at the rim.
- **A NaN in a shaft blacked out the whole frame.** `pow(1.0 - y, …)` with
  `y` interpolated a hair past 1 is NaN, additive blending carried it, and
  the bloom spread it over everything. Found by hiding each new mesh in
  turn and reading a pixel back. The coordinate is clamped now and the
  output floored at zero.
- **Checked by reading the frame back**, not by screenshot: in record mode
  the pane's screenshot shows a stale frame, so the render call was
  wrapped to copy the canvas after the last pass and the copy shown as an
  image. A frame-to-frame difference with the shafts on and off found no
  recurring jump.
- Not seen: a phone, and kelp at night.

## Herds

- **Where** (`generation/herds.ts`, tested): at most a herd to a drainage
  cell, on rolls of their own apart from the birds, on open `land` — not
  the shore, the high ground or the snow, not where it is too cold for
  grass, and **not in the woods** (`featuresAt`'s trees over 0.4), where
  a herd would stand inside the trees. More where it is grassland than
  scrub. Three coats by the land: tawny on warm dry plains, brown in the
  temperate grass, dark where it is cold. The first thresholds (trees
  under 0.25, a third the chance) left this world with almost none: seven
  in ten land cells carry more trees than that.
- **Drawn** (`render/herds.ts`) as boxes in the PS1 way — a body with a
  higher rump, four legs, a tail, and a head on a neck that pivots at the
  shoulders: down to graze most of the time, up now and then to look
  round. **Instanced meshes in the scene's own light and fog**, not a
  shader of their own, so a herd is lit and hazed exactly as the ground
  under it; with a little of their own coat as light, since flanks away
  from a high sun went black against ground the terrain lights more
  kindly.
- **The ground is measured once per beast**, when its herd comes near:
  each stands where it was placed, turning slowly and shuffling a step
  back and forth, so nothing samples the surface frame by frame. A beast
  in the water or on ground too steep to stand on (the rise over two body
  lengths) is not drawn.
- **Larger than life**, as the birds and trees are: at 0.00013 a herd
  under a glide was specks beside trees ten times its height. 0.0002 now,
  and spread over 0.0011.
- Kept round the eye by `NearCells`; a beast shrinks away between 0.0104
  and 0.016 from the eye, where it is a few pixels, rather than vanishing.
- Seen: a tawny herd of fifteen grazing on a hillside from a glide. Not
  seen: the dark kind, a herd at dusk, a phone.

## Rainbows, sea fog, and snow you can see

- **Snow on a frozen world was never seen, and the cause was the near
  plane.** The shower box is 0.006 across round the eye; the near plane
  sits about a fifth of the eye's height out (0.0059 at 0.03 up), and the
  shower falls up to 0.12 high — so the box was clipped away almost whole
  (7 pixels changed with the flakes on). `Rain.update` takes the near
  plane and widens the box to four times it, the flakes sized by the same
  factor so a flake is the same few pixels at any height. **Rain had the
  same fault**: high over hills the streaks were clipped too.
- **Snow is flakes, not streaks**: a `Points` of its own beside the rain's
  lines, three times as many, swaying, fading in at the top of the box and
  out at its foot so none appears where the fall wraps. As a line a hair
  long a flake was a pixel. Seen: a snow shower over the ice of `9tcwfzj`.
- **Rainbows** (`render/rainbow.ts`, `rainbowStrength` tested): with the
  sun low at your back, sunlight on the eye and rain out on the far side
  (cloud sampled 0.015 to 0.06 away from the sun, the same flowing cover
  every reader uses), a soft bow round the point straight away from the
  sun, a fainter reversed second bow outside it and a brighter sky inside.
  Drawn on a sphere 0.03 round the eye with the depth test on, so near
  hills stand in front of its feet and far ones behind the rain. **Drawn
  at 26 degrees, not 42**: the view is 45 degrees tall and a glide looks
  a little down, so a true bow ringed the whole screen and only its
  corners showed — measured, every point of the ring fell off the frame.
  **Its feet fade towards the horizon**, because the sphere meets the sea a
  few hundredths out and the bow ended there in a hard line across the
  water. Softened towards white: a pure spectrum read as a test card.
  **Eased over 1.6 s**: read straight off the cloud under a fast glide it
  came and went in a second. Measured over 150 s of a low-sun glide: two
  rainbows, of about one and three seconds before easing. The look was
  checked by forcing it on; the trigger by flying.
- **Sea fog** (`seaFogOver` in patch-data.ts, tested): the dawn mist laid
  over cool coastal water too — warm air over cold water — where the sea
  was always given a depth under its surface, which draws nothing. Cool,
  not over the pack ice, and near a coast read off how shallow the sea is.
  The first reach (to a height of −0.035) was a strip a few thousandths
  wide on a coast that shelves fast; to −0.07 it is a bank. Seen: a white
  bank over the near water at dawn. **It reads a little like a sandbank**
  where it ends, being the mist's own flat colour.
- **Reefs from above are back to the shallows.** Running them deeper for
  the dive (above) blotched the warm seas pink from a glide; the ground
  shader now shows from above only the coral down to 0.006 and all of it
  under the sea (`detailUnder`).
- Not seen: a rainbow over land, sea fog from orbit, a phone.

## Lighthouses and ruins

- **A lighthouse beside each harbour** (`Harbour.light` in
  generation/harbours.ts, tested): a little way along the coast from the
  pier, back to land if the coast bends in there, then out to the water's
  edge — and two steps back from it, since the drawn shore is not quite
  where the surface turns to sea and the last step of land stood the tower
  in the shallows. Most harbours get one (93 of 93 on `83tzj46`).
- **Drawn** (`render/lighthouses.ts`) as a tapering white tower with red
  bands, a dark gallery, a lantern and a red cap, built once as instanced
  meshes, each on the ground measured for it. **At each tower's own dusk**
  (its up against the sun, in the planet's frame) the lantern lights and
  two beams turn round it, back to back, each two crossed additive quads
  bright at the lamp and along its middle. Hard-edged, the quads read as
  planks; they fade to their edges now.
- **Ruins on the hilltops** (`generation/ruins.ts`, tested): a drainage
  cell higher than every cell round it, on a lived-on world only, under no
  snow, and at least 0.03 from a living town — whose builders would have
  carted the stones off. About fifty on `83tzj46`. **Found in the build
  worker** with the lights and harbours (`ruinsOf`, on the `lights` job),
  since it reads the drainage map, which the main thread does not hold.
- **Drawn** (`render/ruins.ts`) as stone boxes and columns: a ring of
  twelve columns at broken heights on a two-step platform, now and then a
  lintel, drums fallen among them; or a fort's four walls in gapped
  stretches with tower stumps at the corners and tumbled blocks. Built only
  for those near the eye, a stone at a time where the ground was measured
  for it, shrinking into the ground at the edge of their reach. Pale stone
  with a little light of its own, as the herds have.
- **A sized array has holes, and `indexOf(undefined)` skips them**: the
  ruins' slots were `new Array(n)`, so no ruin ever found a free slot and
  none was drawn — with every test green. Filled with `undefined` now.
  `NearCells` gets away with the same construction only because `reset`
  fills it.
- Seen: a lighthouse by day and turning at night beside a lit town, a
  temple and a fort by day. Not seen: a phone, a ruin at night.

## The phone pass

- **Sunbeams on a modest phone** (`render/sun-fan.ts`): the screen-space
  pass reads the finished frame, and a modest phone draws straight to the
  screen with no frame to read, so it had no beams at all. It gets a fan
  of eighteen soft rays standing in the sky round the sun instead — one
  draw, a few dozen triangles — at the strength `sunbeamStrength` gives
  the pass. **The depth test does the occluding**: the fan stands past the
  ground, so a ridge in front of the sun cuts it off. Clouds do not, which
  is why the pass is still the one for every device that can afford it.
  The first fan was hard wedges, a flag's rising sun; each ray is soft
  across its width now, the width divided by how far along it is so the
  softness holds all the way out from the sun.
- **`docs/PHONE_CHECKLIST.md`** is what only a phone can answer — first
  load, smoothness, heat, the share sheets — with a shot link straight to
  each feature of this backlog on the live site.
- Seen: the fan at sunset on the modest profile (`?cores=4`, 375 × 812).
  Not measured: what it costs on a real phone, which is the checklist's
  job.

## Autumn and spring

`render/leaves.ts` (`leafSeason`, tested; the same rule as GLSL for the
trees in `patches/forest.ts` and the woods painted on the ground in
`detail.ts`): the Season dial turns the woods — red, orange and gold in
autumn, bare grey-brown twigs in winter, fresh green in spring with now and
then a tree in pink-white blossom. Each tree a few days before or after its
neighbours by its own roll, so a wood colours in patches.

- **The default equinox (0.25) stays summer green everywhere**, so every
  link made before this opens on the same woods. That fixed the edges of
  the windows: the south runs half a year on, so its phase at the default
  is 0.75, and spring begun at 0.72 opened the south in blossom; winter
  ending at 0.75 caught it too. Autumn now starts at 0.27, winter ends by
  0.72 and spring starts at 0.78 — the gaps between are plain green.
- **The band is lower than Earth's**: these worlds are colder, their woods
  growing mostly between about 6 and 23 degrees with snow from about 40, so
  the first band (17 to 30 degrees) found almost no trees to turn. Out of
  the tropics from about 6 degrees, full by about 14.
- **One conifer in four turns too, as a larch.** The temperate woods here
  are nearly all conifer — `featuresAt` gave broadleaf at most 0.13 on
  `83tzj46` — and with the broadleaves alone an autumn turned a tree in ten.
- **How strong is the planet's lean**: `seasonStrength`, nothing below
  about 2 degrees, full by about 14.
- Seen: gold and orange larches among the dark conifers in autumn (`s=35`),
  a bare one in winter (`s=58`). **From orbit the change is faint** — the
  woods painted on the ground take it, but there the canopy is a dark tone
  more than a colour. Not seen: blossom, which wants a broadleaf wood in
  spring.

## Bridges and traffic

- **Where a road crosses water** (`Settlements.bridges` in
  generation/settlements.ts, tested): from the last dry ground before it to
  the first after, **spanning the water alone** with a little bank either
  side (`BRIDGE_BANK`), and only under `LONGEST_BRIDGE`. Three wrong answers
  first, each measured: the road's steps (0.0028) walk straight over a
  river, so at the steps alone a whole world had one bridge; looking along
  finely still found one, because **a road's lights scatter sideways** up to
  about 0.008 either side of its line, so two in a row over a river were
  usually further apart than any bridge — spanning light to light, 162 of
  163 crossings came out too long. Found by counting each stage with a
  probe in the test runner. Now 9 to 26 a world.
- **Kept cheap**: a stretch that skipped a step (over the sea, a lake, a
  wide river) is looked along with the full dry test; any other only for a
  river or a lake (`inlandWater`), which returns at once where the cells
  round about have none. Fine sampling with the full test made the
  settlements take seconds and timed out a test.
- **Drawn** (`render/bridges.ts`, the banks' ground found in the build
  worker): a stone deck arched enough to clear the water, low parapets, and
  piers into the river under a long one. **A box built to stand on its base
  is placed by its foot** — the piers were placed by their middle and stood
  half their height up through the deck.
- **Traffic** (`render/traffic.ts`): a horse and a covered wagon on each
  road longer than 0.004, two on a long one, back and forth at a walk by the
  shared clock, with a lantern hung over the front after dusk — a warm point
  in the dark between the towns' glows. A road broken at a river is two
  roads to the carts, which turn back at the water. With the herds' little
  light of their own, or a high sun left the wagons' sides sky-blue.
- **Seen**: two bridges over a river in a town (one arched, with a pier),
  a wagon on a road by day and its lantern by night. **Seen and not
  fixed**: houses standing in that same river — town lights keep off river channels
  but not off the drawn water there; worth a look on its own.

## Rocky coasts

- **Where** (`generation/coasts.ts`, tested): at most a group to a drainage
  cell, on rolls of its own, where land standing at least 0.022 high has
  open water within 0.008 — the sea face of high ground. One to four stacks
  in the shallows off the shore (over water, not past the shelf at −0.03),
  and in about a third of groups an arch, both feet in the water. Found by
  sampling the surface, so it runs on the page with `NearCells` as the
  birds and fish do. The first threshold (0.045 high within 0.005) found two
  groups on a whole world: these coasts are mostly low.
- **Drawn** (`render/rocks.ts`): jagged seven-sided pillars of the world's
  high-ground colour, narrowing and broken at the top, leaning a little;
  an arch is two broad feet with a thick block laid across. Spray bursts
  white round each pillar's foot as its wave comes in. Shrinks into the sea
  at the edge of its reach.
- **Three looks that read wrong, all from the water**: thin pillars read as
  a pier's piles; a pillar stood from a bed thirty times deeper than its
  height in air showed mostly as a long shaft through the clear shallows,
  so a pillar now starts no more than 0.0009 under the surface; and **the
  water along a shore is drawn well above the sea's own level** (checked by
  painting the stacks red: at a thousandth above `SEA_RADIUS` only their
  tops cleared it), so stacks stand 0.0016 to 0.0032 over it. With a little
  light of their own colour, as the herds and ruins have.
- Seen: three stacks and an arch off a wooded shore at midday. Not seen: a
  frozen world's coast, spray at dusk, a phone.

## Eruptions

`render/eruptions.ts` (`eruption`, `eruptionSeed`, tested): each volcano on a
molten world goes through a cycle of its own — quiet, then about a third
of its 45 seconds fountaining — keyed from where it stands, so they do not
all go at once.

- **Fountains**: seventy glowing bombs a vent, each thrown at its own angle
  and speed, arcing up and falling back, yellow-white at the core and red
  at the edge, thrown only while the volcano erupts.
- **Flows**: from each volcano three rivers of lava, the steepest way down
  its flanks to the lava sea or a hollow (found once per world on the page
  from a few thousand surface samples), as ribbons on the ground: a dark
  crust crawling downhill, cracked open to the glow, hotter near the vent
  and in mid-stream, brighter while the volcano erupts.
- **The plume** (volcanic.ts) grows a little and burns a little fiercer at
  the vent while its volcano erupts. Doubled, the lit puffs at the vent
  swelled into one glowing ball over the summit.
- **The seed is passed in, never hashed on the GPU.** The same hash in
  32-bit floats is a different number, so the fountains, the flows and the
  plume each kept their own time. `ERUPTION_GLSL` takes the seed from
  `eruptionSeed` as an attribute everywhere.
- **A GLSL keyword as a name failed in silence**: the bombs' direction was
  called `out`, the shader did not compile, and the fountains drew nothing
  with no error on the page. Found by diffing the frame with the points on
  and off (nothing changed) after reproducing their arithmetic in
  JavaScript (they should have been there).
- **Seen, not fixed**: close to a volcano at night its plume is a large
  glowing mass over the vent — the existing lit puffs, before eruptions.
- Seen: a fountain over a vent and three flows down its flank at night on
  `h999999`. Not seen: a fountain by day, a phone.

## Deserts that live

`generation/oases.ts` (`oasisIn`, `caravanIn`, `desertAt`, tested on the
arid seed `aaangxg`) and `render/deserts.ts`: on desert ground — the
features' cactus share, scaled back up to a share of desert — a drainage
cell may hold an oasis (one in seven, deep desert only) and a caravan (one
in five, desert the whole way), each decided by the cell and the seed.

- **Dunes** (detail.ts): on sand, near enough that a crest spans pixels,
  long ripples run across the ground on a fixed wind — a slow rise to the
  crest and a shaded lee face — warped so they do not read as ruled lines.
- **Oases**: a still pool with a slow ripple of light, a ring of green
  round it, and six to fifteen palms leaning out over the water.
- **Caravans**: four to eight camels, each with an indigo-robed rider,
  plodding there and back along a way of their own by the shared clock,
  bobbing with each stride.
- **The drawn ground is not the true ground on a dune.** The mesh runs
  straight between vertices about 0.0003 apart, and on a steep dune face it
  stood up to 0.0006 above `groundRadiusAt` — over twice a camel's height.
  The first caravans were drawn, in view, and entirely buried: found by
  drawing them with the depth test off. Each point of a way now takes the
  **highest** ground within 0.0003 of it (`FEEL`), and a way rougher than
  0.0006 across that is not walked (`ROUGHEST`) — which turns away about
  three caravans in five, so caravans were made twice as common to keep
  their number. Anything else set on rough ground by `groundRadiusAt`
  alone has this problem.
- **The glide's pitch is clamped to about −12.6°**, so a `shot` link's tilt
  past that does nothing: to look down at something, stand further off.
- **Camels were first a pale grey-beige** and read as ghosts on the sand;
  a dark coat and an indigo rider stand out against it.
- Seen: dunes and an oasis with palms on `aaangxg`, and a caravan on the
  dunes at `shot=g,-36.734,126.65,270,4.0,10.00,-30`. Not seen: a phone,
  a caravan at night.

## Balloons and airships

`generation/aircraft.ts` (`balloonsIn`, `airshipIn`, tested) and
`render/aircraft.ts`: on any world that is not molten, a drainage cell may
hold a meet of one to four hot-air balloons (one in twenty, over thawed
land only) and an airship (one in seventy, over land or sea).

- **Balloons**: faceted teardrop envelopes in twelve gores of two colours
  (two instanced meshes, one per half of the gores, each with its own
  instance colour), a wicker basket on four ropes. Each drifts slowly round
  the meet's point at its own pace on one wind, rising and sinking a
  little and turning on its rope. Its burner fires for a breath every few
  seconds: a flame at the mouth, and at night the whole envelope glows
  from inside in its own colours, like a lantern.
- **Airships**: a long hull with cruciform fins, a gondola and two engine
  pods, in one of five muted hull colours, cruising a slow round of its
  patch of sky with its nose along the way and bobbing gently; the
  gondola's windows lit after dusk.
- **Flown clear of the hills**: each is flown over the highest ground
  under its whole round (`highestUnder`, sampled on two rings), so a round
  over a ridge never passes into it.
- **Their own light follows the day.** The little own-colour light the
  herds and camels carry kept the balloons in full colour against black
  ground at night; it is an instance attribute (`craftLight`) now, faded
  with the sun, beside the burner's glow.
- **The fade is measured from the anchor, inside the guaranteed reach.**
  `NearCells` holds two rings of cells round the eye's, so anything inside
  its own cell within two cells (0.0245) is always held; these shrink away
  between 0.015 and 0.023 from their anchor. The deserts used 0.02–0.03,
  past that reach, so an oasis at the edge could appear part-grown as its
  cell came in: they use the same numbers now, and a caravan is read from
  where it set out, since its camels walk out of their own cell.
- **An airship within about two hull lengths is cut by the near plane** —
  seen as a pale crescent and a floating gondola. Flying into one does
  this; it is the camera, not the model.
- Seen: a meet of four over snowy woods by day and the burner glowing at
  night, and an airship by day and lit at night, on `k3m9xqa`. Not seen:
  the flame itself up close, a phone.

## Comets

`generation/comet.ts` (`cometOf`, `cometInSky`, tested) and
`render/comet.ts`: about one world in three has a great comet in its sky,
decided by the seed — its head 30–70° from the sun, so it shows at dusk
and dawn and on through the night, and its tail 15–30° long.

- **The tail streams away from the sun**, not behind the comet along its
  path: `cometInSky` takes the anti-sun direction less its part along the
  head, and a test holds the tail square to the head and pointing away.
- **Two tails, as a great comet has**: a broad pale dust tail fanning out
  and curling a little off the straight, brighter along its leading edge,
  and a longer, narrow blue ion tail dead straight, its streamers drifting
  slowly outward. A hard nucleus in a soft green-white coma.
- **Drawn as the sister worlds are**: round the eye just inside the far
  plane, so the ground and the clouds hide it; out with the stars, a
  little before them, and faintly there by day, as a great comet is. It
  stands still among the stars and is laid out again only when the sun
  moves (the seasons), not each frame.
- **The oasis glowed green at night**, found looking at the comet over
  the desert: the little own-colour light that keeps shaded sides from the
  sky's blue went on burning in the dark. It fades with the sun where the
  eye is now (`desertDay`), and the pool darkens with it — the balloons'
  fix, as one uniform, since an oasis is never far from the eye.
- Seen: the comet over the desert at dusk on `aaangxg`
  (`shot=g,-36.734,126.65,302,6.0,19.40,0`), and the oasis dark under it.
  Not seen: from orbit, a phone.

## The world map

`generation/world-map.ts` (`bakeMap`, `mapPoint`, `mapDirection`, tested)
and `ui/map-panel.ts`: the map button (under the clip's) or **M** opens
the world laid flat — latitude up the side, longitude across, the planet's
+z at the middle — and a press anywhere on it flies there, heading north.

- **Drawn as the ground is from orbit**, from `surfaceAt`'s own colours,
  shaded as if lit from the north-west so the ranges stand off the page,
  with sea ice, lakes and the biggest rivers (the top 1.5% of the drainage
  map's flow on land) drawn on, faint lines every thirty degrees, and the
  towns as warm squares, larger for the larger.
- **Baked in the builder's worker** (`kind: 'map'`), 512 across, the first
  time it is opened for a world and kept until the seed or a dial changes:
  about 130,000 surface samples is too slow for the page.
- **Where the eye is**: a ring in orbit, an arrow the way it looks when
  flying (`eyeFacing` on the scene, its bearing worked out along the
  ground), moved every frame while the sheet is open.
- **The pixel art is the point**: the canvas is drawn at 512 and shown
  with `image-rendering: pixelated`, a chart in the PS1 manner rather
  than a smoothed photograph.
- **The Dive button moved down a place when flying** (+290) to make room.
- **The browser pane's screenshot showed the map canvas filling the whole
  view**, header and all gone — the tool captured the canvas, not the
  page. The layout was checked by measuring instead: at 375 the map is
  343 by 173 with nothing over the edge.
- **Seasonal snow is not on the map**: it is `surfaceAt`'s colour, and the
  season's snow is laid on in the ground's shader. A green valley on the
  map can be white in midwinter when flown to.
- Seen: maps of `k3m9xqa` and `83tzj46`, a press flying there and the
  arrow following north; a molten world bakes (tested). Not seen: a real phone.
