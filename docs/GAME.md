# The game

**You command a salvage airship. Every world is a seed. Land, and the
ground under you becomes blocks: dig it, build on it, find what the seed
hides, take off — and what you did shows from orbit.** The ship is the
thing that lasts: built from what the worlds give, and the only thing
that travels between them.

Three hooks, in the order they matter:

1. **The ship is the base; the worlds are the quarries.** Ice from a
   frozen world, basalt from a volcanic one, timber from a temperate one,
   fitted as modules that let you reach the next world. An expedition is a
   run across worlds; the ship and what it has learned are the meta.
2. **Read the planet to find something.** Each seed hides a cache, placed
   by a rule written in the planet's own landmarks, and the clue is that
   rule in words. The flyover is the puzzle board.
3. **Leave a mark you can see from space.** Felled stands, dug pits,
   lamps on the night side, planted forest that spreads: edits feed the
   planet-scale layers, and the payoff of every landing is the take-off.

What stays true from the generator: **the world never changes.** A link
shares the planet; your edits are a diff on top, saved per seed on the
device. Two people opening one seed stand on the same ground.

## Scale

A block is `BLOCK = 0.0002` planet radii, so a tree (0.0011) stands five
or six blocks and a landing area of 256 × 256 blocks is 0.05 radii — about
half the feature range of a glide. Mountains reach a hundred blocks or so
over the plain; the world is built in columns up to 192 high. Curvature
over the area is a block or two and is ignored: the local world is flat,
laid in a tangent frame at the landing point.

## Backlog

Each item ships on its own, verified in the preview and on a phone where
it can be. Checked when live.

### A — The ground

- [ ] **A1 Sampler.** `generation/voxel.ts`: the block at (x, y, z) of a
      landing area, from the planet's own height, biome, moisture and
      features — grass over earth over stone, sand on beaches, snow on the
      heights, basalt and lava on a molten world, water below sea level,
      block trees and stone clusters where the flyover had them. Pure,
      tested, deterministic.
- [ ] **A2 Mesher and renderer.** Chunks of 16 × 16 columns, visible faces
      only, baked vertex ambient occlusion, one texture atlas cut from the
      ground photographs. Streams around the player.
- [ ] **A3 The walker.** Touch: left thumb moves, right thumb looks, jump
      button. Desktop: WASD, mouse look, space. Gravity, collision,
      step-up, swimming in water.
- [ ] **A4 Dig and build.** Raycast to the block looked at; tap to break,
      tap a face to place; a hotbar of what is held. Edits saved per seed
      as a diff and applied over the sampler on load.
- [ ] **A5 Land and take off.** From a glide, Land drops the ship's
      surveyor onto the ground under it; Take off climbs back into the
      glide with the chunks streaming out. The planet, the sky, the
      clouds and the weather are the same ones.

### B — The ship

- [ ] **B1 The ship in flight.** A third-person airship ahead of the eye
      in the glide, drawn from its modules, banking with the turns.
- [ ] **B2 The hold and the workbench.** Cargo by kind, capacity from the
      hold module; a workbench that fits modules from materials: hold,
      lamps, drill, heat shield (volcanic landings), cold runners (frozen
      landings), surveyor scope.
- [ ] **B3 The expedition.** A run: fuel, three worlds offered each jump
      (seeds derived from the expedition's seed), landings gated by the
      ship's modules, the run ending when the fuel is gone. The logbook
      and its unlocks persist across runs.

### C — Reading the planet

- [ ] **C1 Landmarks.** Per seed, from coarse sampling: the highest peak,
      the largest lake, the widest lava field, the edge of the pack ice,
      the deepest valley, the longest coast. Pure, tested, stable.
- [ ] **C2 The cache and its clue.** One cache per world, placed by a rule
      over the landmarks; the clue is the rule in words ("in the lee of
      the highest range, where the lake meets the sand"); the scope reads
      warmer or colder as the ship nears it.
- [ ] **C3 The cache in the ground.** A buried structure in the voxel
      world to dig down to, holding parts and a blueprint.

### D — Marks from orbit

- [ ] **D1 Felled and dug.** Removed features leave the feature grid;
      pits and structures draw as blocks in the glide at low altitude.
- [ ] **D2 Lights.** Lamps placed on the ground are points of light on
      the night side.
- [ ] **D3 Growth.** Planted saplings grow into stands over real days,
      spreading along the moisture map, in the forest layer the glide
      draws.
- [ ] **D4 Water and lava.** A dam fills its basin; a channel carries
      lava. Later, and only once D1–D3 hold.

### E — Phone and polish

- [ ] **E1** One-thumb everything; block targets big; long-press to break.
- [ ] **E2** Landing and take-off as a moment: dust, the ship's shadow,
      the sound of the engine.
- [ ] **E3** The Tune dials lock once a world has been landed on.
