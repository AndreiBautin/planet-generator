import * as THREE from 'three'

/**
 * The woods through the year — the broadleaves, and the larches among the
 * conifers (one in four): turning red and gold in autumn,
 * bare in winter, fresh green with blossom here and there in spring.
 *
 * Read from the Season dial (planet.ts: 0 the north's midsummer, 0.5 its
 * midwinter) and the place: the south is half a year on, the tropics have
 * none of it, and a planet that barely leans barely has seasons. Each tree
 * turns a little before or after its neighbours, so a wood colours in
 * patches rather than all at once.
 *
 * **The equinox the app opens on (0.25) is still summer green**, everywhere:
 * every link made before this opens on the same woods. Autumn begins just
 * after it in the north, and spring just after the south's equinox (0.75
 * there), which is why spring starts late: begun at 0.72, the default
 * opened the south in blossom.
 *
 * The same rule twice: `leafSeason` here, for the tests, and `LEAF_SEASON_GLSL`
 * for the trees (patches/forest.ts) and the woods painted on the ground past
 * them (detail.ts), so a tree and the ground under it agree.
 */
export interface LeafSeason {
  readonly autumn: number
  readonly winter: number
  readonly spring: number
}

/** The Season dial and how strong a planet's seasons are (`seasonStrength`), for the shaders. */
export const DETAIL_SEASON = { value: new THREE.Vector2(0.25, 0) }

/** How strong a planet's seasons are, 0 to 1, from how far it leans, in radians. */
export function seasonStrength(tilt: number): number {
  return smooth(0.04, 0.24, tilt)
}

/**
 * What the leaves are doing at a place: `lat` the sine of its latitude,
 * `season` the dial, `strength` from `seasonStrength`, `roll` 0 to 1 a tree's
 * own, which moves its turning a few days either way.
 */
export function leafSeason(
  lat: number,
  season: number,
  strength: number,
  roll: number,
): LeafSeason {
  const phase = fract((lat >= 0 ? season : season + 0.5) + (roll - 0.5) * 0.04)
  // Out of the tropics only. Lower than Earth's temperate band, because
  // these worlds are colder: their woods grow mostly between about 6 and 23
  // degrees, and snow lies from about 40, so a band of 17 to 30 found almost
  // no trees to turn.
  const reach = smooth(0.1, 0.25, Math.abs(lat)) * strength
  return {
    autumn: smooth(0.27, 0.33, phase) * (1 - smooth(0.42, 0.47, phase)) * reach,
    winter: smooth(0.42, 0.47, phase) * (1 - smooth(0.66, 0.72, phase)) * reach,
    spring: smooth(0.78, 0.84, phase) * (1 - smooth(0.95, 0.99, phase)) * reach,
  }
}

export const LEAF_SEASON_GLSL = /* glsl */ `
uniform vec2 detailSeason;
// x autumn, y winter, z spring, each 0 to 1: as leafSeason in leaves.ts.
vec3 leafSeason(vec3 up, float roll) {
  float lat = up.y;
  float phase = fract((lat >= 0.0 ? detailSeason.x : detailSeason.x + 0.5) + (roll - 0.5) * 0.04);
  float reach = smoothstep(0.1, 0.25, abs(lat)) * detailSeason.y;
  return vec3(
    smoothstep(0.27, 0.33, phase) * (1.0 - smoothstep(0.42, 0.47, phase)),
    smoothstep(0.42, 0.47, phase) * (1.0 - smoothstep(0.66, 0.72, phase)),
    smoothstep(0.78, 0.84, phase) * (1.0 - smoothstep(0.95, 0.99, phase))) * reach;
}
// A crown's colour for the season, from its summer colour and its own roll:
// gold, orange or red in autumn, bare twigs in winter, fresh green in spring
// and now and then a tree in blossom.
vec3 leafColour(vec3 summer, vec3 season, float roll) {
  vec3 turned = roll < 0.4 ? vec3(0.78, 0.55, 0.08) : (roll < 0.75 ? vec3(0.8, 0.3, 0.06) : vec3(0.58, 0.1, 0.05));
  vec3 bare = vec3(0.3, 0.25, 0.2);
  vec3 fresh = roll > 0.82 ? vec3(0.95, 0.72, 0.8) : summer * vec3(1.15, 1.35, 0.8);
  vec3 colour = mix(summer, turned, season.x);
  colour = mix(colour, bare, season.y);
  return mix(colour, fresh, season.z);
}
`

const smooth = (low: number, high: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}

const fract = (x: number): number => x - Math.floor(x)
