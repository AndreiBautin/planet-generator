import { describe, expect, it } from 'vitest'

/**
 * GLSL's `pow` is undefined for a negative base, and one NaN pixel blacks
 * out the whole frame: ordinary blending carries NaN through everything
 * drawn over it (NaN × 0 is NaN), and the bloom spreads it. A comet's
 * tail did exactly that, then an audit found two more. This test reads
 * every `pow(` in the renderers' shader strings and refuses any base that
 * is not plainly non-negative — a whole `max`, `abs`, `clamp` or `acos`
 * call — unless it is listed here with the reason it cannot go below
 * nought. A new `pow` fails until someone has thought about its base.
 */

/** Bases that are not guarded in the call itself, each with why it is safe. */
const REASONED: readonly { file: string; base: string; why: string }[] = [
  {
    file: 'atmosphere.ts',
    base: '1.0 + g * g - 2.0 * g * mu',
    why: 'at least (1 − g)²: Henyey–Greenstein',
  },
  {
    file: 'atmosphere.ts',
    base: '1.0 - abs(dot(d, normalize(o)))',
    why: 'a unit dot, so abs is at most 1',
  },
  { file: 'atmosphere.ts', base: 'toward', why: 'max(mu, 0.0) on the line above' },
  { file: 'aurora.ts', base: 'rays', why: 'detailNoise, 0 to 1' },
  { file: 'clouds.ts', base: 'struck / 0.035', why: 'an acos, 0 or more' },
  { file: 'detail.ts', base: '1.0 - abs(ca - cb)', why: 'ca and cb are detailNoise, 0 to 1' },
  { file: 'detail.ts', base: '1.0 - facing', why: 'facing is clamped to 0–1 on the line above' },
  { file: 'fish.ts', base: 'vAway * fishHazeDensity', why: 'a distance times a density' },
  { file: 'haze.ts', base: 'sunward', why: 'max(…, 0.0) on the line above' },
  { file: 'kelp.ts', base: 'vAway * kelpHazeDensity', why: 'a distance times a density' },
  { file: 'meteors.ts', base: 'hash(k + 2.0)', why: 'a fract, 0 to 1' },
  { file: 'scene.ts', base: 'mottle', why: 'noise, 0 to 1' },
  { file: 'sea-light.ts', base: '1.0 - at.y', why: 'at is clamped to 0–1 above' },
  { file: 'sun-fan.ts', base: '1.0 - clamp(vAlong, 0.0, 1.0)', why: 'clamped to 1 at most' },
  { file: 'volcanic.ts', base: 'age', why: 'a fract, 0 to 1' },
  {
    file: 'weather.ts',
    base: 'acos(clamp(dot(normalize(vDir), lightning.xyz), -1.0, 1.0)) / 0.03',
    why: 'an acos, 0 or more',
  },
]

const GUARDED = /^(max|abs|clamp|acos)\(/

/** Every renderer's source, as text, keyed by its path under render/. */
const SOURCES = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(['./**/*.ts', '!./**/*.test.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ).map(([path, text]) => [path.replace(/^\.\//, ''), text]),
)

/** The first argument of a call whose opening paren is at `open`, or the whole call if it is one argument. */
function firstArgument(text: string, open: number): string {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, i)
    } else if (ch === ',' && depth === 1) return text.slice(open + 1, i)
  }
  return text.slice(open + 1)
}

/** Whether `text` from `start` is one balanced call: its first paren closes at its end. */
function isWholeCall(text: string): boolean {
  const open = text.indexOf('(')
  if (open < 0) return false
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')') {
      depth -= 1
      if (depth === 0) return i === text.length - 1
    }
  }
  return false
}

interface Site {
  file: string
  base: string
}

function powSites(): Site[] {
  const sites: Site[] = []
  for (const [file, text] of Object.entries(SOURCES)) {
    const call = /(?<![\w.])pow\(/g
    let found: RegExpExecArray | null
    while ((found = call.exec(text)) !== null) {
      const open = found.index + found[0].length - 1
      const base = firstArgument(text, open).replace(/\s+/g, ' ').trim()
      sites.push({ file, base })
    }
  }
  return sites
}

describe('every pow in a shader has a base that cannot go negative', () => {
  const sites = powSites()

  it('finds the shaders at all', () => {
    expect(sites.length).toBeGreaterThan(10)
  })

  it('refuses a base that is neither guarded in the call nor reasoned about here', () => {
    const unexplained = sites.filter(
      ({ file, base }) =>
        !(GUARDED.test(base) && isWholeCall(base)) &&
        !REASONED.some((r) => r.file === file && r.base === base),
    )
    expect(unexplained, 'add a guard, or list the base in REASONED with why').toEqual([])
  })

  it('keeps no reason for a pow that is gone', () => {
    const stale = REASONED.filter((r) => !sites.some((s) => s.file === r.file && s.base === r.base))
    expect(stale).toEqual([])
  })
})
