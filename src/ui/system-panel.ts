import { KINDS } from '@/generation/kinds'
import type { Rgb } from '@/generation/kinds'
import type { Seed } from '@/generation/seed'
import type { StarSystem, SystemWorld } from '@/generation/system'

/**
 * The system sheet: the star, the worlds' orbits seen at a slant, and each
 * world as a small lit globe in its own colours, the one on screen ringed.
 * A press on a world — in the picture or in the list under it — flies
 * there. While the journey runs the sheet stays up, the destination ringed,
 * and takes no presses.
 */
export interface SystemPanel {
  readonly show: (system: StarSystem, current: Seed) => void
  /** The journey's first half: the sheet up, the destination marked, nothing to press. */
  readonly travelling: (system: StarSystem, current: Seed, to: Seed) => void
  readonly hide: () => void
  readonly isOpen: () => boolean
}

const element = <T extends HTMLElement>(id: string, type: new () => T): T => {
  const found = document.getElementById(id)
  if (!(found instanceof type)) throw new Error(`index.html is missing #${id}`)
  return found
}

const SVG = 'http://www.w3.org/2000/svg'
const css = (c: Rgb, k = 1): string =>
  `rgb(${String(Math.round(Math.min(1, c[0] * k) ** (1 / 2.2) * 255))}, ${String(Math.round(Math.min(1, c[1] * k) ** (1 / 2.2) * 255))}, ${String(Math.round(Math.min(1, c[2] * k) ** (1 / 2.2) * 255))})`

/** How flat the orbits are drawn: a disc seen from a little above. */
const SLANT = 0.38

export function attachSystem(onTravel: (world: SystemWorld) => void): SystemPanel {
  const sheet = element('system', HTMLElement)
  const title = element('system-title', HTMLElement)
  const map = document.getElementById('system-map')
  const list = element('system-list', HTMLElement)
  if (!(map instanceof SVGSVGElement)) throw new Error('index.html is missing #system-map')
  let open = false

  const draw = (system: StarSystem, current: Seed, to: Seed | undefined): void => {
    title.textContent = `The ${system.star.name} system`
    const outer = system.worlds[system.worlds.length - 1]?.orbit ?? 1
    const scale = 88 / outer
    const nodes: Element[] = []
    const defs = document.createElementNS(SVG, 'defs')
    const glow = document.createElementNS(SVG, 'radialGradient')
    glow.id = 'system-glow'
    for (const [offset, alpha] of [
      ['0', '1'],
      ['0.35', '0.5'],
      ['1', '0'],
    ] as const) {
      const stop = document.createElementNS(SVG, 'stop')
      stop.setAttribute('offset', offset)
      stop.setAttribute('stop-color', css(system.star.colour))
      stop.setAttribute('stop-opacity', alpha)
      glow.append(stop)
    }
    defs.append(glow)
    nodes.push(defs)
    for (const world of system.worlds) {
      const r = world.orbit * scale
      const ring = document.createElementNS(SVG, 'ellipse')
      ring.setAttribute('rx', String(r))
      ring.setAttribute('ry', String(r * SLANT))
      ring.setAttribute('class', 'system-orbit')
      nodes.push(ring)
    }
    const star = document.createElementNS(SVG, 'circle')
    star.setAttribute('r', '16')
    star.setAttribute('fill', 'url(#system-glow)')
    const core = document.createElementNS(SVG, 'circle')
    core.setAttribute('r', '4.5')
    core.setAttribute('fill', css(system.star.colour, 1.2))
    nodes.push(star, core)
    // Nearer the eye (lower on the page) drawn over further.
    const order = [...system.worlds].sort((a, b) => Math.sin(a.angle) - Math.sin(b.angle))
    for (const world of order) {
      const r = world.orbit * scale
      const x = Math.cos(world.angle) * r
      const y = Math.sin(world.angle) * r * SLANT
      const size = 2.6 + world.size * 2.4
      const group = document.createElementNS(SVG, 'g')
      group.setAttribute('class', 'system-world')
      group.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`)
      const gradient = document.createElementNS(SVG, 'radialGradient')
      gradient.id = `system-${world.seed}`
      gradient.setAttribute('cx', String(0.5 - (x / Math.max(1, Math.hypot(x, y))) * 0.25))
      gradient.setAttribute('cy', String(0.5 - (y / Math.max(1, Math.hypot(x, y))) * 0.25))
      for (const [offset, colour] of [
        ['0', css(world.land, 1.4)],
        ['0.55', css(world.sea, 1.6)],
        ['1', css(world.sea, 0.35)],
      ] as const) {
        const stop = document.createElementNS(SVG, 'stop')
        stop.setAttribute('offset', offset)
        stop.setAttribute('stop-color', colour)
        gradient.append(stop)
      }
      defs.append(gradient)
      const globe = document.createElementNS(SVG, 'circle')
      globe.setAttribute('r', size.toFixed(2))
      globe.setAttribute('fill', `url(#system-${world.seed})`)
      group.append(globe)
      if (world.seed === current || world.seed === to) {
        const mark = document.createElementNS(SVG, 'circle')
        mark.setAttribute('r', (size + 2.2).toFixed(2))
        mark.setAttribute('class', world.seed === to ? 'system-to' : 'system-here')
        group.append(mark)
      }
      const label = document.createElementNS(SVG, 'text')
      label.setAttribute('y', (size + 6.5).toFixed(2))
      label.textContent = world.name
      group.append(label)
      if (to === undefined && world.seed !== current) {
        group.addEventListener('click', () => {
          onTravel(world)
        })
      }
      nodes.push(group)
    }
    map.replaceChildren(...nodes)

    list.replaceChildren(
      ...system.worlds.map((world) => {
        const item = document.createElement('li')
        const button = document.createElement('button')
        button.type = 'button'
        const here = world.seed === current
        button.disabled = here || to !== undefined
        button.textContent = here
          ? `${world.name} · here`
          : `${world.name} · ${KINDS[world.kind].label.toLowerCase()}`
        button.addEventListener('click', () => {
          onTravel(world)
        })
        item.append(button)
        return item
      }),
    )
    sheet.classList.toggle('travelling', to !== undefined)
  }

  // The view's own controls step aside while the system is up.
  const setOpen = (on: boolean): void => {
    sheet.hidden = !on
    open = on
    document.body.classList.toggle('systeming', on)
  }
  element('system-close', HTMLButtonElement).addEventListener('click', () => {
    setOpen(false)
  })

  return {
    show: (system, current) => {
      draw(system, current, undefined)
      setOpen(true)
    },
    travelling: (system, current, to) => {
      draw(system, current, to)
      setOpen(true)
    },
    hide: () => {
      setOpen(false)
    },
    isOpen: () => open,
  }
}
