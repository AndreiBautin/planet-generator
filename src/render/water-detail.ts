import * as THREE from 'three'

import { withValleyFog } from './valley-fog'
import { SWELL_FAR, SWELL_NEAR, SWELL_TRAINS, SWELL_TRAINS_GLSL } from './swell'
import {
  DETAIL_SKY,
  DETAIL_ZENITH,
  ICE_HEIGHT,
  MORPH_DECLARE,
  TERRAIN_MORPH,
  passThrough,
} from './detail'

/**
 * The sea: waves that lift and push the surface itself near the camera —
 * four trains of Gerstner waves crossing, their crests sharpened and
 * leaning, taller as they run into the shallows — with their own normals,
 * foam where a crest is steep enough to break and along the coast, fine
 * ripples over it all, and lighter water over the shallows.
 */
export function withWaterDetail(material: THREE.Material): THREE.Material {
  material.onBeforeCompile = (shader) => {
    passThrough(shader, { attribute: 'depth', type: 'float' })
    // The depth under the sea slides between levels as the ground does, so
    // the shallows and the foam do not jump when a finer patch comes in.
    shader.uniforms.terrainMorphLod = TERRAIN_MORPH
    shader.vertexShader = (
      MORPH_DECLARE +
      'attribute float coarseDepth;\nattribute float dry;\nvarying float v_dry;\nattribute vec2 ice;\nattribute float inland;\nattribute float rapids;\nattribute vec3 current;\nvarying float v_ice;\nvarying float v_inland;\nvarying float v_rapids;\nvarying vec3 v_current;\nvarying vec3 v_up;\n' +
      shader.vertexShader
    )
      .replace(
        'void main() {',
        'void main() {\n  float seaMorph = terrainMorphAt(position);\n  float seaDepth = mix(depth, coarseDepth, seaMorph);\n  v_ice = mix(ice.x, ice.y, seaMorph);\n  v_inland = inland;\n  v_dry = dry;\n  v_rapids = rapids;\n  v_current = current;\n  v_up = normalize(normalMatrix * normalize(position));',
      )
      .replace('v_depth = depth;', 'v_depth = seaDepth;')
      .replace('smoothstep(0.0, 0.0004, depth)', 'smoothstep(0.0, 0.0004, seaDepth)')
      .replace('smoothstep(0.0, 0.004, depth)', 'smoothstep(0.0, 0.004, seaDepth)')
    shader.vertexShader =
      'varying float v_jac;\nvarying float v_heave;\n' +
      shader.vertexShader
        .replace(
          '#include <beginnormal_vertex>',
          /* glsl */ `#include <beginnormal_vertex>
        vec3 waveOffset = vec3(0.0);
        {
          vec3 up = normalize(position);
          vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), up) + vec3(1e-5, 0.0, 0.0));
          vec3 north = cross(up, east);
          // Faded with distance so coarse far patches, which could not follow
          // a wave, are not torn from fine near ones; held still right at the
          // shore, where the land's edge is; taller running into the shallows.
          float seaView = length((modelViewMatrix * vec4(position, 1.0)).xyz);
          // And calm under ice, which damps the sea: waves lifted the water
          // over the floes as the eye came down, and the ice drowned.
          // And none on a lake or river: a swell needs a sea's fetch.
          float lift = (1.0 - smoothstep(${String(SWELL_NEAR)}, ${String(SWELL_FAR)}, seaView)) * smoothstep(0.0, 0.0004, seaDepth) * (1.0 - smoothstep(0.05, 0.4, v_ice)) * (1.0 - inland);
          float shoal = 1.0 + 0.7 * (1.0 - smoothstep(0.0, 0.004, depth));
          // (direction, wavelength, steepness, period) for each train, from
          // the table the ships ride (swell.ts).
          ${SWELL_TRAINS_GLSL}
          float nx = 0.0;
          float nz = 0.0;
          float ny = 1.0;
          float heave = 0.0;
          float span = 0.0;
          for (int i = 0; i < ${String(SWELL_TRAINS.length)}; i++) {
            vec4 w = trains[i];
            vec3 d = cos(w.x) * east + sin(w.x) * north;
            float k = 6.2831853 / w.y;
            float A = (w.z / k) * shoal * lift;
            float phi = k * dot(position, d) - (6.2831853 / w.w) * detailTime;
            float c = cos(phi);
            float s = sin(phi);
            waveOffset += d * (0.8 * A * c) + up * (A * s);
            nx -= cos(w.x) * k * A * c;
            nz -= sin(w.x) * k * A * c;
            ny -= 0.8 * k * A * s;
            heave += A * s;
            span += A;
          }
          objectNormal = normalize(east * nx + up * ny + north * nz);
          // Where the surface is squeezed the crest is breaking.
          v_jac = ny;
          v_heave = span > 0.0 ? heave / span : 0.0;
        }`,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
        // Past the shores the sheet is held just under the dry ground
        // (patch-data.ts). There it slides to the parent patch with the
        // ground, keeping the same depth under it: left where it was, the
        // ground sinking towards its parent's shape uncovered it, and from
        // orbit every rough slope was speckled with water and ice.
        if (depth <= 0.0) {
          float coarseLength = max(length(coarsePosition.xyz), 1e-6);
          vec3 coarseSheet = coarsePosition.xyz * ((coarseLength + depth) / coarseLength);
          transformed = mix(transformed, coarseSheet, seaMorph);
        }
        // Pack ice stands as floes over the leads (iceRelief), about a
        // ship's height proud of the water.
        float packIceV = smoothstep(0.9, 1.0, v_ice);
        if (packIceV > 0.0) waveOffset += normalize(position) * iceRelief(position) * ${ICE_HEIGHT.toFixed(5)} * packIceV;
        transformed += waveOffset;`,
        )
    shader.uniforms.seaSky = DETAIL_SKY
    shader.uniforms.seaZenith = DETAIL_ZENITH
    const seaIce: unknown = material.userData.seaIce
    shader.uniforms.seaIce = {
      value: seaIce instanceof THREE.Color ? seaIce : new THREE.Color(0.9, 0.94, 0.97),
    }
    shader.fragmentShader =
      'uniform vec3 seaSky;\nuniform vec3 seaZenith;\nuniform vec3 seaIce;\nvarying float v_dry;\nvarying vec3 v_up;\nvarying float v_ice;\nvarying float v_inland;\nvarying float v_rapids;\nvarying vec3 v_current;\nvarying float v_jac;\nvarying float v_heave;\n' +
      shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        // Among dry vertices the sheet is only held for the shore to meet
        // (patch-data.ts): not drawn, and faded out towards one.
        if (v_dry > 0.97) discard;
        float seaDistance = length(vViewPosition);
        float seaNear = 1.0 - smoothstep(0.015, 0.12, seaDistance);
        vec3 drift = vec3(detailTime * 0.9, detailTime * 0.6, -detailTime * 0.7) * 0.001;
        // Lighter over the shallows, where the floor shows through, and
        // lighter on a crest than in a trough.
        float shallows = 1.0 - smoothstep(0.0, 0.004, v_depth);
        // A river is a few ten-thousandths deep everywhere, which by the
        // sea's measure is all shallows and all surf: inland water is read
        // by its own depth, greener and darker, and its edge is not foam.
        float inlandShallows = 1.0 - smoothstep(0.0, 0.0003, v_depth);
        shallows = mix(shallows, inlandShallows * 0.5, v_inland);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.75, 0.7), v_inland * 0.6);
        // Turquoise where the floor shows through, the sea's own colour
        // over the shelf, darkening to ink over the deep: read by the true
        // depth, so a reef or a sandbank shows as a paler patch out at sea.
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.15, 2.0, 1.75), shallows * 0.5);
        // And a band of clear turquoise along the beach itself, where the
        // sand shows through a few hand-spans of water.
        float lagoon = (1.0 - smoothstep(0.0, 0.0016, v_depth)) * (1.0 - v_inland) * (1.0 - smoothstep(0.4, 0.9, v_ice));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.62, 0.58), lagoon * 0.55);
        float abyss = smoothstep(0.004, 0.025, v_depth) * (1.0 - v_inland);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.5, 0.62, 0.85), abyss);
        diffuseColor.rgb *= 1.0 + v_heave * 0.18;
        // The wash at the water's edge: a band of foam that runs up the
        // beach and draws back, its edge broken by the churn.
        float calm = (1.0 - v_inland) * (1.0 - smoothstep(0.4, 0.9, v_ice));
        float churn = detailNoise(vDetailPosition * 1500.0 + drift * 1500.0);
        float reach = 0.00035 + 0.00022 * sin(detailTime * 0.7 + churn * 1.5);
        float wash = 1.0 - smoothstep(reach * 0.5, reach, v_depth);
        float foam = wash * smoothstep(0.3, 0.65, churn + wash * 0.3) * calm * (1.0 - smoothstep(0.3, 1.2, seaDistance));
        // Lines of surf a little way out, parallel to the shore and running
        // in to it: the same depth everywhere along a line, so they follow
        // the coast's shape. Each a sharp breaking front with foam trailing
        // behind it on the seaward side, broken by the churn so no line is
        // unbroken, and seen from a glide rather than only from the beach.
        float surfZone = smoothstep(0.0002, 0.0006, v_depth) * (1.0 - smoothstep(0.0012, 0.0034, v_depth)) * calm;
        float set = fract(v_depth * 1250.0 + detailTime * 0.22);
        float front = smoothstep(0.86, 0.97, set) * (1.0 - smoothstep(0.97, 1.0, set));
        float trail = smoothstep(0.55, 0.97, set) * 0.45;
        float broken = smoothstep(0.25, 0.6, churn);
        foam = max(foam, surfZone * max(front, trail * broken) * broken * (1.0 - smoothstep(0.35, 1.4, seaDistance)));
        // Breaking crests: where the wave has squeezed the surface most,
        // streaked by a noise so the foam is ragged, and the odd cap at sea.
        float breaking = smoothstep(0.62, 0.42, v_jac);
        float streak = smoothstep(0.35, 0.75, detailNoise(vDetailPosition * 1800.0 + drift * 1200.0));
        float caps = (1.0 - v_inland) * max(breaking * (0.4 + streak * 0.6), smoothstep(0.9, 0.98, detailNoise(vDetailPosition * 1100.0 - drift * 1100.0)) * 0.4) * seaNear;
        // White water where a river falls steeply (patch-data.ts, rapids):
        // churned foam tearing past, broken near to, and solid white where
        // the drop is a waterfall. Kept from afar, as a thread of white down
        // a cliff, because that is what tells a fall from a glide.
        // The current (patch-data.ts, current): ripples and foam carried
        // downstream, streaked along the flow. Read twice, half a cycle
        // apart, each carried for a cycle and then begun again elsewhere,
        // and blended so neither is seen to jump: carried for ever, a bend
        // would stretch the pattern without end (a flow map).
        float run = length(v_current);
        vec3 runDir = run > 1e-4 ? v_current / run : vec3(0.0);
        vec3 flowP = (vDetailPosition - runDir * dot(vDetailPosition, runDir) * 0.7) * 2600.0;
        float cycle = detailTime * 0.3;
        float phaseA = fract(cycle);
        float phaseB = fract(cycle + 0.5);
        float toB = abs(2.0 * phaseA - 1.0);
        vec3 carry = v_current * 2.6;
        float rippleA = detailNoise(flowP - carry * phaseA + 3.1 * floor(cycle));
        float rippleB = detailNoise(flowP - carry * phaseB + 7.3 * floor(cycle + 0.5));
        float ripple = mix(rippleA, rippleB, toB);
        // Bright streaks running down a river, near to.
        diffuseColor.rgb += vec3(0.07, 0.08, 0.08) * smoothstep(0.55, 0.85, ripple) * min(run, 1.0) * v_inland * seaNear;
        float tumble = run > 1e-4 ? ripple : detailNoise(vDetailPosition * 2600.0 + drift * 9000.0);
        float tear = detailNoise(vDetailPosition * 900.0 - drift * 5000.0);
        float rapid = v_rapids * (1.0 - smoothstep(0.4, 0.9, v_ice));
        // Aerated water between the streaks, paler and greener than a pool.
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.72, 0.72), rapid * 0.35);
        float whitewater = rapid * 0.9 * smoothstep(0.78 - rapid * 0.3, 0.98 - rapid * 0.2, tumble * 0.6 + tear * 0.6);
        foam = max(foam, mix(whitewater, rapid * 0.6, 1.0 - seaNear));
        float white = clamp(foam + caps, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.97), white);
        diffuseColor.a = mix(diffuseColor.a, 0.95, white);
        // Deep water keeps its own colour: clear only over the shallows,
        // where the floor is worth seeing. Clear everywhere, the floor under
        // it — and how much of it the angle let through — set the colour of
        // the open sea, which shifted as the glide pitched.
        diffuseColor.a = mix(diffuseColor.a, 0.9, max(smoothstep(0.0, 0.012, v_depth), v_inland * smoothstep(0.0, 0.0004, v_depth)));
        // Pack ice floats on the water, slabs split by dark leads, and does
        // not mirror the sky.
        float packIce = smoothstep(0.9, 1.0, v_ice);
        float iceRel = 0.0;
        if (packIce > 0.0) {
          // The floes the vertices were raised by, faded to their average
          // from orbit where a pixel spans a lead; their tops snow-bright,
          // their rims and the ridges between them the blue of old ice,
          // and the leads the dark water they are.
          float iceSpan = length(fwidth(vDetailPosition)) * 600.0;
          float seen = 1.0 - smoothstep(0.3, 1.0, iceSpan);
          iceRel = mix(0.62, iceRelief(vDetailPosition), seen);
          float floe = smoothstep(0.1, 0.4, iceRel);
          float rim = smoothstep(0.1, 0.4, iceRel) * (1.0 - smoothstep(0.4, 0.7, iceRel));
          vec3 iceColour = mix(seaIce * (0.8 + 0.3 * iceRel), seaIce * vec3(0.72, 0.86, 1.0), rim * 0.7);
          float onIce = packIce * mix(0.15, floe, seen) + packIce * (1.0 - seen) * 0.6;
          onIce = min(onIce, packIce);
          diffuseColor.rgb = mix(diffuseColor.rgb, iceColour, onIce);
          diffuseColor.a = mix(diffuseColor.a, 1.0, onIce);
          white = max(white, onIce);
        }
        diffuseColor.rgb *= 1.0 - cloudShadow(vDetailPosition) * 0.5;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          // The sky in the water: Schlick's Fresnel on the rippled normal,
          // so the sea mirrors the air at a grazing angle and shows its own
          // colour looking down. Opaque where it mirrors, as water is.
          float facing = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
          float mirror = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
          // What it mirrors is the sky the reflected ray meets: the haze at
          // the horizon at a grazing angle, the deeper sky overhead looking
          // down — so the sea is not one flat sheet of the horizon's colour.
          vec3 bounced = reflect(normalize(-vViewPosition), normal);
          float rise = clamp(dot(bounced, normalize(v_up)), 0.0, 1.0);
          vec3 mirrored = mix(seaSky, seaZenith, smoothstep(0.0, 0.45, rise));
          totalEmissiveRadiance += mirrored * mirror * (1.0 - white);
          diffuseColor.a = mix(diffuseColor.a, 1.0, mirror * 0.85);
          // Light through the crests: a wave between the eye and the sun
          // glows green-turquoise along its top, which is what makes the
          // sea read as a body of water and not a blue skin.
          #if NUM_DIR_LIGHTS > 0
          {
            vec3 toSun = directionalLights[0].direction;
            float through = pow(max(dot(-normalize(vViewPosition), toSun), 0.0), 4.0);
            float crest = smoothstep(0.1, 0.8, v_heave) * (1.0 - v_inland) * (1.0 - smoothstep(0.9, 1.0, v_ice));
            float sunUp = smoothstep(-0.05, 0.15, dot(normalize(v_up), toSun));
            totalEmissiveRadiance += vec3(0.12, 0.5, 0.42) * crest * through * sunUp * seaNear * (1.0 - white) * 1.4;
          }
          #endif
          // Clear towards the dry land, so the shore is wet sand going under
          // rather than an edge of water standing on it.
          float shoreClear = smoothstep(0.35, 0.97, v_dry);
          totalEmissiveRadiance *= 1.0 - shoreClear;
          diffuseColor.a *= 1.0 - shoreClear;
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          vec3 swell = vec3(detailTime * 0.9, detailTime * 0.6, -detailTime * 0.7);
          // Ripples at three scales, the finest stretched along one wind
          // so they streak as wind-blown water does rather than pebbling.
          vec3 along = normalize(cross(normalize(vDetailPosition), vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
          vec3 streaked = vDetailPosition + along * dot(vDetailPosition, along) * 2.5;
          float ripple =
            (detailNoise(vDetailPosition * 900.0 + swell) +
              detailNoise(vDetailPosition * 2200.0 - swell * 1.7) * 0.6 +
              detailNoise(streaked * 5200.0 + swell * 3.0) * 0.35 * (1.0 - smoothstep(0.004, 0.03, seaDistance))) * seaNear;
          // The floes' relief is lit as relief: their rims, ridges and
          // hummocks take the sun and throw shade, from screen derivatives
          // of the same height the vertices were raised by.
          float iceBump = packIce > 0.0 ? iceRel * 6.0 * packIce : 0.0;
          normal = detailBump(
            -vViewPosition,
            normal,
            vec2(dFdx(ripple), dFdy(ripple)) * 0.6 + vec2(dFdx(iceBump), dFdy(iceBump)),
            faceDirection);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        {
          // Glassier near the eye, so the sun's glints are sharp, and a
          // mottle of roughness across it so they sparkle rather than lie
          // as one sheet of highlight; rougher where foam or ice lies.
          float sparkle = detailNoise(vDetailPosition * 3000.0 + vec3(detailTime * 1.1, -detailTime * 0.8, detailTime * 0.5) * 0.004);
          float glassy = seaNear * (1.0 - smoothstep(0.9, 1.0, v_ice));
          roughnessFactor = mix(roughnessFactor, 0.11 + 0.2 * sparkle, glassy * 0.85);
          // From afar a pixel spans many waves facing every way, so the sea
          // is rougher there: the sun's glint is a broad soft sheen, as it
          // is on a real ocean from orbit, not a hard white spot.
          roughnessFactor = max(roughnessFactor, 0.36 * smoothstep(0.4, 1.8, length(vViewPosition)));
        }`,
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
        // The rings' shadow falls on the water as on the ground: on the
        // sun's light only, so the sky it mirrors is untouched.
        {
          float ringDim = (1.0 - ringShadowFrom(vDetailPosition, detailCloudSun)) * (1.0 - moonShadowFrom(vDetailPosition, detailCloudSun));
          reflectedLight.directDiffuse *= ringDim;
          reflectedLight.directSpecular *= ringDim;
          // From afar the night side's sea is dark too, as the ground is:
          // the sky's one fill and its mirror both dimmed where the sun is down.
          #if NUM_DIR_LIGHTS > 0
          {
            vec3 seaUp = normalize(detailNormalMatrix * normalize(vDetailPosition));
            float nightSide = 1.0 - smoothstep(-0.25, 0.05, dot(seaUp, directionalLights[0].direction));
            float dim = 1.0 - 0.8 * nightSide * smoothstep(0.15, 0.6, length(vViewPosition));
            reflectedLight.indirectDiffuse *= dim;
            reflectedLight.indirectSpecular *= dim;
          }
          #endif
          // From under the sea the surface is a bright, moving ceiling: the
          // sky let through, rippled. Its underside faces away from the sun
          // and would otherwise be drawn dark.
          if (!gl_FrontFacing) {
            float ripple = detailNoise(vDetailPosition * 2200.0 + vec3(detailTime * 0.5, 0.0, -detailTime * 0.4));
            reflectedLight.indirectDiffuse += vec3(0.35, 0.75, 0.8) * (0.6 + ripple * 0.8) * detailUnder;
          }
        }`,
      )
    withValleyFog(shader, 'mistTop')
  }
  material.customProgramCacheKey = () => 'planet-water-detail'
  return material
}
