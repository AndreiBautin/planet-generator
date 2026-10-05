/**
 * The cube-sphere geometry moved to `generation/cube.ts` so the voxel
 * sampler can use it without reaching into the renderer; everything in
 * render/ still imports it from here.
 */
export * from '@/generation/cube'
