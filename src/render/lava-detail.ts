import * as THREE from 'three'

import { LAVA_PLATE_HEIGHT, passThrough } from './detail'

/**
 * Lava: a crust of plates carried on a slow current, split by glowing
 * seams with brighter lava streaming along them. The current is a noise
 * field, and the crust is read twice along it with the two reads
 * cross-faded (flow mapping), which is what lets a pattern move without
 * stretching forever.
 */
export function withLavaDetail(material: THREE.Material): THREE.Material {
  material.onBeforeCompile = (shader) => {
    passThrough(shader, undefined)
    // The sea of lava heaves: two slow, long swells along the vertical,
    // faded with distance as the water's are, so near the eye the crust
    // rises and falls rather than lying as a flat sheet. Reported as the
    // lava being "a flat entity".
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
      {
        vec3 lavaUp = normalize(position);
        float lavaView = length((modelViewMatrix * vec4(position, 1.0)).xyz);
        float lavaLift = 1.0 - smoothstep(0.02, 0.2, lavaView);
        float ph1 = dot(position, vec3(0.6, 0.0, 0.8)) * 314.0 - detailTime * 0.35;
        float ph2 = dot(position, vec3(-0.5, 0.3, 0.8)) * 790.0 + detailTime * 0.6;
        transformed += lavaUp * lavaLift * (sin(ph1) * 0.00035 + sin(ph2) * 0.00012);
        // And the crust's plates stand proud of the melt in the seams
        // (lavaPlates): rafts of rock riding the current, not a paint.
        transformed += lavaUp * lavaLift * lavaPlates(position, detailTime).z * ${LAVA_PLATE_HEIGHT.toFixed(5)};
      }`,
    )
    shader.fragmentShader =
      'float lavaSeam = 0.0;\nfloat lavaId = 0.0;\nfloat lavaGlowing = 0.0;\n' +
      shader.fragmentShader
    // The crust takes little of the sky's orange fill and half the sun:
    // under a molten world's light a dark rock still read as rust.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      /* glsl */ `#include <lights_fragment_end>
      reflectedLight.indirectDiffuse *= mix(0.25, 1.0, lavaGlowing);
      reflectedLight.directDiffuse *= mix(0.5, 1.0, lavaGlowing);`,
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      /* glsl */ `#include <normal_fragment_maps>
      {
        // The plates as a surface: their proud tops, sagging rims and ropy
        // wrinkles lit from screen derivatives of the height the vertices
        // were raised by, so a raft has a lit edge and a shadowed one.
        vec3 plates = lavaPlates(vDetailPosition, detailTime);
        lavaSeam = plates.x;
        lavaId = plates.y;
        float lavaBump = plates.z * 5.0 * (1.0 - smoothstep(0.3, 1.5, length(vViewPosition)));
        normal = detailBump(-vViewPosition, normal, vec2(dFdx(lavaBump), dFdy(lavaBump)), faceDirection);
        // Cooled crust is dull rock; only the melt in the seams is glossy.
        roughnessFactor = mix(0.92, roughnessFactor, lavaSeam);
      }`,
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
      {
        float lavaDistance = length(vViewPosition);
        float far = smoothstep(0.3, 1.5, lavaDistance);
        vec3 up = normalize(vDetailPosition);
        vec3 current = vec3(
          detailNoise(vDetailPosition * 9.0 + 3.1),
          detailNoise(vDetailPosition * 9.0 + 7.7),
          detailNoise(vDetailPosition * 9.0 + 1.3)) - 0.5;
        current -= up * dot(current, up);
        current = normalize(current + 1e-5) * 0.006;
        // The plates and seams the normal was bent by (lavaPlates, above);
        // the finer chips between them only near the eye.
        float cycle = 0.1;
        float t1 = fract(detailTime * cycle);
        float t2 = fract(detailTime * cycle + 0.5);
        vec3 p1 = vDetailPosition - current * ((t1 - 0.5) / cycle);
        vec3 p2 = vDetailPosition - current * ((t2 - 0.5) / cycle);
        float blend = abs(t1 - 0.5) * 2.0;
        float seam = lavaSeam;
        float id = lavaId;
        if (far < 0.99) {
          vec3 chipsA = detailCells(p1 * 700.0);
          vec3 chipsB = detailCells(p2 * 700.0);
          // Hairline cracks between the chips of crust, not a second
          // network of glowing seams: at a tenth of a chip wide they lit
          // half the sea and the crust read as pink coral.
          float fine = mix(
            1.0 - smoothstep(0.0, 0.03, chipsA.y - chipsA.x),
            1.0 - smoothstep(0.0, 0.03, chipsB.y - chipsB.x),
            blend);
          seam = max(seam, fine * 0.45 * (1.0 - far));
        }
        // Lava streaming along the seams, quicker than the crust, with
        // surges running down the current.
        float stream = detailNoise((vDetailPosition - current * detailTime * 4.0) * 260.0);
        float surge = 0.7 + 0.6 * smoothstep(0.3, 0.9, fract(dot(vDetailPosition, normalize(current + 1e-5)) * 60.0 - detailTime * 0.25 + id));
        float pulse = 0.85 + 0.15 * sin(detailTime * 1.3 + id * 6.28);
        // And the crust itself breaks open now and then: a plate flares
        // from within, its skin thinning to the glow, and darkens again.
        float boil = smoothstep(0.88, 0.99, detailNoise(vec3(id * 37.0, detailTime * 0.09, id * 11.0)));
        float skin = detailNoise(vDetailPosition * 220.0 + detailTime * 0.02);
        float cracked = boil * smoothstep(0.35, 0.7, skin) * (1.0 - far);
        float glowing = max(seam, cracked * 0.6);
        // From orbit a seam is a pixel wide and the sea sparkled as red
        // static: faded to the sea's average glow once a pixel spans a
        // good share of a plate, as every noise in these shaders is.
        float seamSeen = 1.0 - smoothstep(0.08, 0.3, length(fwidth(vDetailPosition)) * 70.0);
        // In their place, the sea's own large pattern: broad rafts of dark
        // crust with glowing rivers between, ridged noise at two scales
        // drifting on the current. A flat average read from orbit as
        // orange paint. Each scale fades by its own span, so none sparkles.
        float span = length(fwidth(vDetailPosition));
        vec3 drift = vDetailPosition + vec3(detailTime * 0.0012, 0.0, -detailTime * 0.0008);
        float riverA = 1.0 - smoothstep(0.0, 0.07, abs(detailNoise(drift * 7.0) - 0.5));
        float riverB = 1.0 - smoothstep(0.0, 0.09, abs(detailNoise(drift * 19.0 + 5.0) - 0.5));
        riverA = mix(0.25, riverA, 1.0 - smoothstep(0.1, 0.4, span * 7.0 * 8.0));
        riverB = mix(0.25, riverB, 1.0 - smoothstep(0.1, 0.4, span * 19.0 * 8.0));
        float rafts = smoothstep(0.35, 0.7, detailNoise(drift * 3.0 + 11.0));
        float fromAfar = clamp(riverA * 0.75 + riverB * 0.4 * (1.0 - rafts * 0.6), 0.0, 0.9);
        // Squared, so the crust between the rivers is truly dark.
        fromAfar = 0.015 + fromAfar * fromAfar;
        glowing = mix(fromAfar, glowing, seamSeen);
        // The crust is black basalt, its glow only in the seams and where
        // a plate has boiled open; lit as a pale rock with a glow of its
        // own everywhere, the sea read as pink coral.
        totalEmissiveRadiance *= mix(0.02 + id * 0.05, (1.6 + stream * 1.4) * pulse * surge, glowing);
        diffuseColor.rgb = mix(vec3(0.022, 0.019, 0.018) * (0.8 + 0.4 * id), diffuseColor.rgb, glowing);
        lavaGlowing = glowing;
      }`,
    )
  }
  material.customProgramCacheKey = () => 'planet-lava-detail'
  return material
}
