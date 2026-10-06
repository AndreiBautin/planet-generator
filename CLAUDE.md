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
  it (`userData.plume`).
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
