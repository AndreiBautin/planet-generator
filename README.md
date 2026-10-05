# Planet Generator

> **Status: idea.** Nothing is built yet. This README captures the concept so
> the project starts from a clear brief.

Click and a unique world is born — terrain, oceans, clouds and atmosphere —
that you can fly around in the browser and share with a link. Every planet
comes from a seed, so the same link always opens the same world.

## The wow

A fresh, believable planet in under a second, lit by its star, with an
atmosphere glowing at the edge, and a camera that can sweep from orbit down to
the surface. Pure graphics, no install.

## First version

- **Procedural terrain** on a sphere from layered noise, with continents,
  mountains and ocean basins.
- **Oceans, clouds and an atmosphere** with scattering at the limb.
- **Biomes** coloured by height, latitude and moisture.
- **Orbit and fly controls**, smooth on a phone as well as a desktop.
- **Seeds and sharing**: a short seed in the URL reproduces the planet.
- **A few dials**: water level, temperature, roughness, planet size.

## Later

- Planet types: ice, desert, lava, gas giant, ringed.
- Moons and a small solar system.
- Day and night with city lights on the dark side.
- Export a still or a short flyover video.

## The hard parts

- **Performance**: detail where the camera is, little elsewhere (level of
  detail), at a steady frame rate on modest hardware.
- **Shaders**: atmosphere scattering and water that look right, not just
  colourful.
- **Determinism**: a seed must produce the identical planet on every device.
- **Seams** at the poles and between terrain patches.

## Open questions

- Three.js, Babylon.js or raw WebGPU?
- How far down to the surface should the camera go?
- Realistic or stylised look?
