import * as THREE from 'three'

/**
 * Shader warm-up: compile, while the planet is still in orbit, the
 * programs a dive would otherwise compile on first use. Measured, the
 * descent compiled some eighteen programs in four frames two seconds in
 * — the trees and their depth pass, the ground's depth pass, every
 * `weathered` model, the cloud shells turned double-sided under them,
 * birds, herds, rain — 0.65 s of stall, the worst frame over 300 ms.
 *
 * `renderer.compileAsync` makes the programs without blocking (the
 * driver links them in parallel) for every material of every object in
 * the scene, hidden or not, **as the renderer stands when it is called**:
 * called with no render target bound it compiled a whole second set of
 * programs for the screen's colour space and tone mapping, and the
 * frame — drawn into the post pipeline's target — compiled its own set
 * again. So the target is bound first. Materials that flip their `side`
 * under the eye (the clouds, the sea) are compiled both ways; and
 * `warmers` are throwaway meshes that stand in for things not yet in the
 * scene — a tree, the depth passes — added for the call and taken out.
 */
export async function warmPrograms(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget | null,
  sided: readonly THREE.Material[],
  warmers: readonly THREE.Object3D[],
): Promise<number> {
  const before = renderer.info.programs?.length ?? 0
  const held = renderer.getRenderTarget()
  renderer.setRenderTarget(target)
  for (const w of warmers) scene.add(w)
  const sides = sided.map((m) => m.side)
  // The synchronous part of compileAsync — making the programs — runs
  // before its promise is handed back; the wait for them is what is async.
  const first = renderer.compileAsync(scene, camera)
  sided.forEach((m, i) => {
    m.side = sides[i] === THREE.DoubleSide ? THREE.FrontSide : THREE.DoubleSide
    m.needsUpdate = true
  })
  const second = renderer.compileAsync(scene, camera)
  sided.forEach((m, i) => {
    m.side = sides[i] ?? THREE.FrontSide
    m.needsUpdate = true
  })
  for (const w of warmers) scene.remove(w)
  renderer.setRenderTarget(held)
  await Promise.all([first, second])
  return (renderer.info.programs?.length ?? 0) - before
}
