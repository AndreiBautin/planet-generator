import * as THREE from 'three'

/** The post pass's own frame: half float so bloom has highlights to find, multisampled so edges stay clean. */
export function postTarget(): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    type: THREE.HalfFloatType,
    samples: 4,
  })
}

/**
 * The grade: a gentle curve, a little saturation and a vignette. There was
 * a film grain too, a fixed hash per pixel; over a moving picture it stood
 * still like dust on the screen, and was reported as grainy twice, at
 * 0.035 and again at 0.016. It is gone.
 */
export const GRADE_SHADER = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.32 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // After AgX, which is neutral and flat on its own: a gentle S-curve
      // through the mid-grey and a little more saturation, the filmic
      // contrast ACES had without its burnt highlights and orange skin.
      c.rgb = mix(c.rgb, c.rgb * c.rgb * (3.0 - 2.0 * c.rgb), 0.22);
      float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(luma), c.rgb, 1.15);
      vec2 d = vUv - 0.5;
      float edge = 1.0 - smoothstep(0.35, 1.1, dot(d, d) * 2.4);
      c.rgb *= mix(1.0 - vignette, 1.0, edge);
      gl_FragColor = c;
    }
  `,
}
