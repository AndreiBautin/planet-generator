import * as THREE from 'three'

/**
 * Sunbeams: shafts of light fanning from the sun through the gaps in the
 * clouds and over the ridges, strongest when it is low.
 *
 * Done on the finished frame, before the bloom: every pixel looks back
 * along the line to the sun, gathering how bright the frame is there,
 * each step counting a little less. The bright sky round the sun is the
 * light; a cloud or a hill between is dark, and leaves a dark ray behind
 * it. So the beams fall exactly where the frame shows a gap, and nothing
 * but the frame is read.
 *
 * Only the sky's brightest part feeds them (`threshold`), or every lit
 * meadow would throw rays. When the sun is off the screen the beams still
 * fan in from the edge it is past, fading as it goes further.
 */
export const SUNBEAM_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    /** Where the sun is on the screen, 0 to 1 each way; may lie off it. */
    sunAt: { value: new THREE.Vector2(0.5, 0.5) },
    /** 0 for none. */
    strength: { value: 0 },
    tint: { value: new THREE.Color(1, 0.85, 0.6) },
    threshold: { value: 0.9 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 sunAt;
    uniform float strength;
    uniform vec3 tint;
    uniform float threshold;
    varying vec2 vUv;
    const int STEPS = 36;
    void main() {
      vec4 here = texture2D(tDiffuse, vUv);
      if (strength <= 0.0) {
        gl_FragColor = here;
        return;
      }
      vec2 toSun = sunAt - vUv;
      // Reach no further than the frame's own width: a ray's source must be in the picture.
      vec2 stride = toSun / float(STEPS) * min(1.0, 0.9 / max(length(toSun), 1e-4));
      // Each pixel jittered along its line, so the steps do not show as
      // bands — by an ordered dither (interleaved gradient noise), not a
      // hash: the hash was per-pixel random and read as grain across
      // every sunlit haze.
      float jitter = fract(52.9829189 * fract(0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y));
      vec2 at = vUv + stride * jitter;
      float gathered = 0.0;
      float weight = 1.0;
      for (int k = 0; k < STEPS; k++) {
        at += stride;
        vec2 inside = step(vec2(0.0), at) * step(at, vec2(1.0));
        vec3 c = texture2D(tDiffuse, at).rgb;
        float light = max(dot(c, vec3(0.299, 0.587, 0.114)) - threshold, 0.0);
        gathered += light * weight * inside.x * inside.y;
        weight *= 0.95;
      }
      gathered /= float(STEPS);
      // Strongest near the sun, fading across the frame — but held back
      // right round the sun, where every step lands on bright sky and the
      // gather whited out twenty degrees of it; the sun's own disc and
      // glare (atmosphere.ts) are what belong there.
      float near = 1.0 - smoothstep(0.0, 0.9, length(toSun));
      float clear = smoothstep(0.04, 0.22, length(toSun));
      gl_FragColor = vec4(here.rgb + tint * gathered * strength * (0.25 + 0.6 * near) * clear, here.a);
    }
  `,
}

/**
 * How strong the beams are: from how high the sun stands over the eye
 * (`elevation`, the sine of its height; strongest low, gone below the
 * horizon and much less overhead), how low the eye is (`low`, 1 in the
 * air near the ground, 0 from orbit), and how far the sun is from the
 * middle of the view (`off`, in screen widths, past the edge counting
 * against it). Nought under the sea.
 */
export function sunbeamStrength(elevation: number, low: number, off: number): number {
  const smooth = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  const risen = smooth(-0.04, 0.03, elevation)
  const lowSun = 1 - 0.7 * smooth(0.25, 0.7, elevation)
  const inView = 1 - smooth(0.6, 1.1, off)
  return risen * lowSun * low * inView
}
