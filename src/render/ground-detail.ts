import * as THREE from 'three'

import type { GroundKind } from './ground-atlas'
import type { GroundTextures } from './textures'
import { withValleyFog } from './valley-fog'
import { DETAIL_SEASON, LEAF_SEASON_GLSL } from './leaves'
import { SEA_RADIUS } from './water'
import { passThrough, withTerrainMorph } from './detail'

/**
 * The ground: grain and bumps, and the pattern of whatever the ground is.
 * On a molten world the lowland runs with channels of lava that glow.
 */
export function withGroundDetail(
  material: THREE.MeshStandardMaterial,
  textures: GroundTextures,
  molten = false,
): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    passThrough(shader, { attribute: 'pattern', type: 'vec4' })
    withTerrainMorph(shader, true)
    // The colour, the pattern and the detail's own frame slide with the
    // shape: a vertex drawn where the parent puts it, painted as the parent
    // paints it.
    shader.vertexShader =
      'attribute vec3 coarseColour;\nattribute vec4 coarsePattern;\nattribute vec4 ground;\nattribute vec4 coarseGround;\nattribute float reef;\nattribute float farm;\nvarying vec4 v_ground;\nvarying float v_reef;\nvarying float v_farm;\n' +
      shader.vertexShader
        .replace(
          '#include <color_vertex>',
          /* glsl */ `#include <color_vertex>
  #ifdef USE_COLOR
  vColor.rgb = mix(vColor.rgb, coarseColour, terrainMorph);
  #endif`,
        )
        .replace(
          '#include <project_vertex>',
          /* glsl */ `vDetailPosition = transformed;
  vDetailNormal = objectNormal;
  v_pattern = mix(pattern, coarsePattern, terrainMorph);
  v_ground = mix(ground, coarseGround, terrainMorph);
  v_reef = reef;
  v_farm = farm;
#include <project_vertex>`,
        )
    // Only the photographs this kind of world uses: a phone allows about
    // sixteen textures to a shader, and every kind at once is twenty-two.
    // The biome grounds on land bring colour and grain; the relief comes
    // from the main photographs' normal maps.
    const layers: readonly GroundKind[] = molten
      ? ['basalt', 'ash']
      : ['grass', 'sand', 'stone', 'snow', 'needles', 'savanna', 'tundra', 'salt']
    const flat: ReadonlySet<GroundKind> = new Set(['needles', 'savanna', 'tundra', 'salt'])
    let declare = 'varying vec4 v_ground;\nvarying float v_reef;\nvarying float v_farm;\n'
    for (const kind of layers) {
      const name = kind.charAt(0).toUpperCase() + kind.slice(1)
      // The same uniform objects for every material, so a photograph that
      // arrives later reaches every planet's ground at once.
      shader.uniforms[`ground${name}`] = textures[kind].color
      shader.uniforms[`ground${name}Mean`] = textures[kind].mean
      declare += `uniform sampler2D ground${name};\nuniform float ground${name}Mean;\n`
      if (!flat.has(kind)) {
        shader.uniforms[`ground${name}Normal`] = textures[kind].normal
        declare += `uniform sampler2D ground${name}Normal;\n`
      }
    }
    shader.uniforms.detailSeason = DETAIL_SEASON
    shader.fragmentShader =
      declare +
      LEAF_SEASON_GLSL +
      /* glsl */ `
      // A texture laid on from three sides and blended by which way the
      // ground faces, so a sphere carries it with no stretching anywhere.
      #define GRAIN 1.8
      vec4 groundTri(sampler2D tex, vec3 p, vec3 w) {
        vec4 c = vec4(0.0);
        if (w.x > 0.02) c += texture2D(tex, p.yz) * w.x;
        if (w.y > 0.02) c += texture2D(tex, p.xz) * w.y;
        if (w.z > 0.02) c += texture2D(tex, p.xy) * w.z;
        return c;
      }
      // A normal map laid on the same way: each side's tangent-space tilt
      // turned into a tilt along that side's own axes in the planet's frame.
      vec3 groundTriNormal(sampler2D tex, vec3 p, vec3 w) {
        vec3 d = vec3(0.0);
        if (w.x > 0.02) { vec2 s = texture2D(tex, p.yz).xy * 2.0 - 1.0; d += vec3(0.0, s.x, s.y) * w.x; }
        if (w.y > 0.02) { vec2 s = texture2D(tex, p.xz).xy * 2.0 - 1.0; d += vec3(s.x, 0.0, s.y) * w.y; }
        if (w.z > 0.02) { vec2 s = texture2D(tex, p.xy).xy * 2.0 - 1.0; d += vec3(s.x, s.y, 0.0) * w.z; }
        return d;
      }
      // One kind of ground's share: its colour levelled to the brightness
      // it was cut at and part-desaturated, so the biome's own colour is
      // what the eye reads and the photograph gives it grain and shadow.
      // The grain is pushed out from the level (GRAIN): sampled at a
      // glide's height the photographs sit two mip levels down and their
      // blades and pebbles average towards one tone. The relief is the
      // levelled luminance — a blade of grass lit stands up, a shadow lies
      // low — since a JPEG's alpha is 1 everywhere and the baked tile's
      // height went with it when the photograph arrived.
      vec3 groundGrain(vec4 near, vec4 broad, float mean) {
        vec3 c = (near.rgb * 0.65 + broad.rgb * 0.35) / (mean * 2.0);
        return 0.5 + (c - 0.5) * GRAIN;
      }
      void groundLayer(
        sampler2D colorMap, sampler2D normalMap, float mean, float share,
        vec3 p, vec3 q, vec3 w, inout vec3 albedo, inout float relief, inout vec3 tilt
      ) {
        if (share < 0.02) return;
        vec4 near = groundTri(colorMap, p, w);
        vec4 broad = groundTri(colorMap, q, w);
        vec3 c = groundGrain(near, broad, mean);
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        albedo += mix(vec3(lum), c, 0.35) * share;
        relief += clamp(lum, 0.0, 1.0) * share;
        if (share > 0.2) tilt += (groundTriNormal(normalMap, p, w) * 0.7 + groundTriNormal(normalMap, q, w) * 0.3) * share;
      }
      // A ground with no normal map of its own: colour and grain only.
      void groundFlat(
        sampler2D colorMap, float mean, float share,
        vec3 p, vec3 q, vec3 w, inout vec3 albedo, inout float relief
      ) {
        if (share < 0.02) return;
        vec4 near = groundTri(colorMap, p, w);
        vec4 broad = groundTri(colorMap, q, w);
        vec3 c = groundGrain(near, broad, mean);
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        albedo += mix(vec3(lum), c, 0.35) * share;
        relief += clamp(lum, 0.0, 1.0) * share;
      }
      ` +
      shader.fragmentShader
    if (molten) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          // Rivers of lava threading the low ground: the zero line of a
          // noise, which is a network of winding channels, lit from within
          // and pulsing slowly; and pools where it has spread.
          // The molten sea lights the ground beside it from below: shores
          // and low ground glow, more the nearer the lava, which is what
          // keeps a coast a shape on a night side lit by nothing else.
          float overLava = max(length(vDetailPosition) - 1.0015, 0.0);
          float spill = exp(-overLava / 0.0009);
          totalEmissiveRadiance += (diffuseColor.rgb * 0.35 + 0.012) * vec3(1.0, 0.33, 0.07) * spill;
          float lava = v_pattern.y;
          if (lava > 0.02) {
            float lavaFar = 1.0 - smoothstep(0.2, 1.2, length(vViewPosition));
            vec3 p = vDetailPosition * 160.0;
            float n = detailNoise(p) + detailNoise(p * 2.7) * 0.35 - 0.675;
            float channel = 1.0 - smoothstep(0.0, 0.035 + 0.03 * (1.0 - lavaFar), abs(n));
            // A pool crusts over, as the sea does: dark plates and the
            // glow showing in the cracks between them. One flat glowing
            // sheet across a low slope read as a pale lit hillside at night.
            float crack = 1.0 - smoothstep(0.0, 0.05 + 0.08 * (1.0 - lavaFar), abs(detailNoise(vDetailPosition * 420.0) - 0.5));
            float pool = smoothstep(0.58, 0.75, detailNoise(vDetailPosition * 45.0)) * lava * (0.18 + 0.82 * crack);
            // Lava running down the channel: a fine noise carried along it.
            float run = detailNoise(vDetailPosition * 700.0 - vec3(detailTime * 2.5, detailTime * 1.7, -detailTime * 2.1) * 0.0012 * 700.0);
            float glow = max(channel * lava * (0.7 + run * 0.6), pool) * (0.8 + 0.2 * sin(detailTime * 0.9 + n * 20.0));
            totalEmissiveRadiance += vec3(1.0, 0.32, 0.04) * glow * 1.6;
            diffuseColor.rgb *= 1.0 - glow * 0.6;
          }
        }`,
      )
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float detailDistance = length(vViewPosition);
        // Two scales of grain: one seen from a low glide, one only right
        // above the ground.
        float detailNear = 1.0 - smoothstep(0.03, 0.4, detailDistance);
        float detailClose = 1.0 - smoothstep(0.008, 0.07, detailDistance);
        float patternFar = 1.0 - smoothstep(0.12, 0.7, detailDistance);
        float bumpSpan = length(fwidth(vDetailPosition));
        // Relief comes from the photographs' own normal maps; a procedural
        // bump that came in only near the eye was one more thing appearing.
        float detailHeight = 0.0;
        float detailShade = 1.0;
        float detailRough = 1.0;
        float detailCrease = 1.0;
        vec3 detailTilt = vec3(0.0);
        float stand = 1.0 - smoothstep(detailRange * 0.55, detailRange, detailDistance);

        // The ground's texture: which kinds of ground are here, blended,
        // laid on triplanar at two scales so neither the repeat nor the
        // texel shows, and faded where it would only shimmer.
        // How sheer the face drawn here is, from its own slope on screen. A
        // vertex's steepness is averaged with the flat ground round it, so
        // a gorge one grid step wide read as a gentle bank at both ends and
        // its wall between was painted grass, the texture projected straight
        // down the face in green streaks. Scaled before crossing: a pixel's
        // step is tiny, and its square underflowed.
        vec3 cliffDx = dFdx(vDetailPosition);
        vec3 cliffDy = dFdy(vDetailPosition);
        float cliffSpan = max(max(length(cliffDx), length(cliffDy)), 1e-20);
        vec3 cliffCross = cross(cliffDx / cliffSpan, cliffDy / cliffSpan);
        float cliffLength = length(cliffCross);
        // A pixel whose neighbours are not its face has no slope to read:
        // normalised, the nothing came back as NaN, and the bloom spread
        // one bad pixel over the whole frame.
        vec3 cliffFace = cliffLength > 1e-6 ? cliffCross / cliffLength : normalize(vDetailPosition);
        float cliff = ${molten ? '0.0' : 'smoothstep(0.4, 0.65, 1.0 - abs(dot(cliffFace, normalize(vDetailPosition))))'};
        // And bare rock's colour, whatever the vertices either side were painted.
        diffuseColor.rgb = mix(
          diffuseColor.rgb,
          vec3(dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15))) * vec3(1.04, 0.97, 0.88),
          cliff * 0.85);
        {
          float texFade = 1.0 - smoothstep(0.12, 0.8, detailDistance);
          if (texFade > 0.01) {
            // Laid along the face where it is sheer, not down it.
            vec3 n = normalize(mix(normalize(vDetailPosition), cliffFace, cliff));
            vec3 w = pow(abs(n), vec3(6.0));
            w /= w.x + w.y + w.z;
            vec3 p = vDetailPosition * 1500.0;
            vec3 q = vDetailPosition * 260.0 + 17.3;
            vec3 albedo = vec3(0.0);
            float relief = 0.0;
            ${
              molten
                ? /* glsl */ `
            float wAsh = v_ground.w;
            float total = 1.0;
            groundLayer(groundBasalt, groundBasaltNormal, groundBasaltMean, 1.0 - wAsh, p, q, w, albedo, relief, detailTilt);
            groundLayer(groundAsh, groundAshNormal, groundAshMean, wAsh, p, q, w, albedo, relief, detailTilt);`
                : /* glsl */ `
            float wSand = v_pattern.y;
            float wSnow = v_pattern.z;
            float wStone = max(v_pattern.w, cliff);
            // The biome grounds take their share from the grass and sand
            // they stand in for: savanna and tundra are grassland of a kind,
            // a salt flat is a desert floor, needles lie under conifers.
            float wNeedles = v_ground.x;
            float wSavanna = v_ground.y;
            float wTundra = v_ground.z;
            float wSalt = v_ground.w * (1.0 - wSnow);
            // A cliff holds no grass, needles, sand or snow.
            wSand *= 1.0 - cliff;
            wSnow *= 1.0 - cliff;
            wNeedles *= 1.0 - cliff;
            wSavanna *= 1.0 - cliff;
            wTundra *= 1.0 - cliff;
            wSalt *= 1.0 - cliff;
            float wGrass = max(0.0, 1.0 - (wSand + wSnow + wStone + wNeedles + wSavanna + wTundra));
            wSand *= 1.0 - wSalt;
            float total = max(0.001, wSand + wSnow + wStone + wGrass + wNeedles + wSavanna + wTundra + wSalt);
            groundLayer(groundGrass, groundGrassNormal, groundGrassMean, wGrass, p, q, w, albedo, relief, detailTilt);
            groundFlat(groundNeedles, groundNeedlesMean, wNeedles, p, q, w, albedo, relief);
            groundFlat(groundSavanna, groundSavannaMean, wSavanna, p, q, w, albedo, relief);
            groundFlat(groundTundra, groundTundraMean, wTundra, p, q, w, albedo, relief);
            groundFlat(groundSalt, groundSaltMean, wSalt, p, q, w, albedo, relief);
            groundLayer(groundSand, groundSandNormal, groundSandMean, wSand, p, q, w, albedo, relief, detailTilt);
            groundLayer(groundSnow, groundSnowNormal, groundSnowMean, wSnow, p, q, w, albedo, relief, detailTilt);
            groundLayer(groundStone, groundStoneNormal, groundStoneMean, wStone, p, q, w, albedo, relief, detailTilt);
            // A third, finer scale within a glide's reach of the ground:
            // the near scale is four texels to a pixel from a low glide
            // and its blades and pebbles are averaged away; this one is a
            // texel a pixel there, blended in as the eye nears.
            if (detailClose > 0.01) {
              vec3 r = vDetailPosition * 6000.0 + 41.0;
              vec3 fineAlbedo = vec3(0.0);
              float fineRelief = 0.0;
              vec3 fineTilt = vec3(0.0);
              groundLayer(groundGrass, groundGrassNormal, groundGrassMean, wGrass, r, p, w, fineAlbedo, fineRelief, fineTilt);
              groundLayer(groundSand, groundSandNormal, groundSandMean, wSand, r, p, w, fineAlbedo, fineRelief, fineTilt);
              groundLayer(groundSnow, groundSnowNormal, groundSnowMean, wSnow, r, p, w, fineAlbedo, fineRelief, fineTilt);
              groundLayer(groundStone, groundStoneNormal, groundStoneMean, wStone, r, p, w, fineAlbedo, fineRelief, fineTilt);
              float fineShare = wGrass + wSand + wSnow + wStone;
              if (fineShare > 0.02) {
                float fineMix = 0.5 * detailClose * fineShare / total;
                albedo = mix(albedo, fineAlbedo * total / fineShare, fineMix);
                relief = mix(relief, fineRelief * total / fineShare, fineMix);
                detailTilt = mix(detailTilt, fineTilt * total / fineShare, fineMix);
              }
            }`
            }
            albedo /= total;
            relief /= total;
            detailTilt *= texFade / total;
            diffuseColor.rgb *= mix(vec3(1.0), albedo * 2.0, texFade);
            detailHeight += (relief - 0.5) * 1.2 * texFade;
            // The high points of a surface are worn smoother than its
            // hollows, and snow has a sheen stone has not.
            float sheen = ${molten ? '0.0' : 'v_pattern.z'};
            detailRough = mix(1.0, (1.12 - relief * 0.3) * (1.0 - sheen * 0.35), texFade);
          }
        }

        // Meadow: open grass is never one green. Drier, yellower stretches
        // and lusher, darker hollows drift across it at two scales, so a
        // hillside reads as ground rather than as paint. Only green ground
        // takes it, and it fades out from orbit where it would be mottle.
        ${
          molten
            ? ''
            : /* glsl */ `{
          vec3 base = diffuseColor.rgb;
          float greenness = clamp((base.g - base.b) * 3.0, 0.0, 1.0) * (1.0 - smoothstep(1.0, 1.15, base.r / max(base.g, 0.001)));
          float grassy = max(0.0, 1.0 - (v_pattern.x + v_pattern.y + v_pattern.z + v_pattern.w));
          float meadow = greenness * grassy * (1.0 - smoothstep(0.6, 2.0, detailDistance));
          if (meadow > 0.02) {
            float fineFilter = 1.0 - smoothstep(0.2, 0.5, length(fwidth(vDetailPosition)) * 240.0);
            float drift = detailNoise(vDetailPosition * 55.0) * 0.7 + (detailNoise(vDetailPosition * 240.0 + 5.1) - 0.5) * 0.3 * fineFilter + 0.15;
            float dry = smoothstep(0.48, 0.72, drift);
            float lush = 1.0 - smoothstep(0.28, 0.5, drift);
            vec3 tint = mix(vec3(1.0), vec3(1.22, 1.02, 0.5), dry * 0.75);
            tint = mix(tint, vec3(0.55, 0.78, 0.62), lush * 0.75);
            diffuseColor.rgb *= mix(vec3(1.0), tint, meadow);
          }
        }`
        }

        // Canopy: a forest from above is crowns with dark gaps, no two
        // crowns the same shade, in groves of lighter and darker wood —
        // beyond where the trees themselves stand. Within that range the
        // ground is the forest floor: dark, leaf-littered, mottled.
        // A pattern finer than a pixel aliases into crawling static as the
        // eye moves: each fades out once its cells shrink below a few
        // pixels, by the screen-space rate the position changes.
        float pixelSpan = length(fwidth(vDetailPosition));
        // Where trees stand, the floor between them is dark at every
        // distance. It used to share the crowns' filter and went bright past
        // a short range, so a forest became dark trees on pale ground — the
        // most contrast there is, and in motion it broke into speckle.
        // The canopy weight runs about a third to a half across a wood (it
        // is the grove field, soft-edged), so it is sharpened here: any real
        // wood takes the full floor.
        float woods = smoothstep(0.05, 0.3, v_pattern.x) * patternFar;
        if (woods * stand > 0.02) {
          float litterFilter = 1.0 - smoothstep(0.15, 0.45, pixelSpan * 1800.0);
          float litter = mix(0.5, detailNoise(vDetailPosition * 1800.0), litterFilter) * 0.5 + 0.5;
          float floorTone = 0.38 + litter * 0.22;
          detailShade *= mix(1.0, floorTone, woods * stand);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.1, 0.84, 0.6), stand * woods * 0.6);
        }
        // Past where the trees stand, a wood is painted as what a wood looks
        // like from there: a dark, cool mass, mottled softly, with no cells.
        // It was drawn as crowns — pale cells with dark gaps — which read as
        // a honeycomb on the ground until the trees appeared on top of it.
        // Its tone matches the floor and the trees, so they arrive into a
        // wood already there rather than onto a pattern.
        // The tone holds at every distance, so a wood is on the globe from
        // orbit and the same wood up close; only its texture — crowns at
        // two scales, each filtered away before it could shimmer — comes in
        // as the eye nears, and the crowns' relief lights it as a surface.
        // Clumps of crowns at two scales, each filtered away before it could
        // shimmer: rounded by taking the upper part of a noise, so a wood is
        // a mass of lit tops over shadowed gaps and never a tiling.
        float clumpA = mix(0.5, detailNoise(vDetailPosition * 1100.0), 1.0 - smoothstep(0.15, 0.5, pixelSpan * 1100.0));
        float clumpB = mix(0.5, detailNoise(vDetailPosition * 2600.0), 1.0 - smoothstep(0.15, 0.5, pixelSpan * 2600.0));
        float crown = smoothstep(0.3, 0.8, clumpA * 0.65 + clumpB * 0.35);
        float broad = detailNoise(vDetailPosition * 220.0);
        // The edge of a wood is ragged at clump scale, not the smooth line
        // of the grove field it grows from.
        float edge = v_pattern.x + (clumpA - 0.5) * 0.2 + (broad - 0.5) * 0.1;
        // From high up a patch's vertices are far apart, and each one's wood
        // weight spreads over the fan of triangles round it as a hexagon: a
        // threshold on that drew every wood as a tile, and the land from
        // orbit as a patchwork of them. Far off the weight darkens the land
        // by itself, no threshold, so a wood is a soft shading that follows
        // the ground rather than a mosaic laid over it.
        float far = smoothstep(0.0006, 0.004, pixelSpan);
        float canopy = mix(smoothstep(0.08, 0.26, edge), clamp(v_pattern.x * 1.6, 0.0, 0.85), far) * (1.0 - stand);
        if (canopy > 0.02) {
          float tone = (0.34 + broad * 0.2) * (0.7 + crown * 0.55);
          detailShade *= mix(1.0, tone, canopy);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.7, 0.95, 0.78), canopy);
          // The broadleaf part of a wood through the year (leaves.ts), as
          // the trees standing on it are: the conifers keep their green.
          vec3 leafAt = leafSeason(normalize(vDetailPosition), broad);
          float broadleaves = (1.0 - v_ground.x * 0.75) * canopy;
          diffuseColor.rgb = mix(diffuseColor.rgb, leafColour(diffuseColor.rgb, leafAt, broad) * 0.55, broadleaves * (leafAt.x + leafAt.y + leafAt.z));
          detailHeight += (crown - 0.5) * 2.0 * canopy;
          detailRough = mix(detailRough, 0.95, canopy);
        }

        // Dunes on open sand: long crests laid across one wind, wandering
        // a little, each a gentle slope up and a steep, shadowed lee face
        // down. Faded out by how much ground a pixel spans, never by
        // distance — the hand-drawn ripples below were cut off at a range
        // and appeared ahead of the eye — so from orbit a sand sea is plain.
        {
          float sandy = v_pattern.y * (1.0 - v_pattern.z) * (1.0 - v_pattern.x);
          float duneSeen = 1.0 - smoothstep(0.15, 0.5, pixelSpan * 1000.0);
          if (sandy * duneSeen > 0.03) {
            float warp = detailNoise(vDetailPosition * 90.0) * 2.2;
            float crest = dot(vDetailPosition * 650.0, vec3(0.8, 0.15, 0.58)) + warp;
            float phase = fract(crest);
            float profile = phase < 0.78 ? phase / 0.78 : (1.0 - phase) / 0.22;
            float lee = smoothstep(0.74, 0.82, phase) * (1.0 - smoothstep(0.97, 1.0, phase));
            float weight = sandy * duneSeen;
            detailHeight += (profile - 0.5) * 1.4 * weight;
            detailShade *= mix(1.0, mix(1.05, 0.7, lee), weight);
          }
        }

        // No sand ripples, snow ridges or stone cracks drawn by hand here.
        // Each was drawn only within a certain distance, so each appeared
        // ahead of the eye as it flew — and the cracks, on a world that is
        // mostly stone, read as a honeycomb over the whole ground. The
        // photographs above carry the grain, and the GPU filters them
        // smoothly at every distance, so nothing of theirs pops.

        // A town's fields (patch-data.ts, farm): plots on a grid laid along
        // the ground, each its own crop — ripe wheat, green, ploughed earth —
        // with a darker hedge round it. Faded to the crops' average colour
        // once a pixel spans a plot, so from orbit a town sits in a soft
        // ring of farmland rather than a sparkle.
        if (v_farm > 0.01) {
          // Laid on the two axes the ground faces least along, as a cube's
          // face would be: a frame of the point's own is square to the
          // point, and every point read the same plot.
          vec3 fieldFacing = abs(normalize(vDetailPosition));
          vec2 fieldAt = (fieldFacing.x > fieldFacing.y && fieldFacing.x > fieldFacing.z
            ? vDetailPosition.yz
            : (fieldFacing.y > fieldFacing.z ? vDetailPosition.xz : vDetailPosition.xy)) * 650.0;
          // Not turned by a noise: turning varied across a single plot and
          // drew the hedges as wavy streaks.
          vec2 plot = floor(fieldAt * vec2(1.0, 1.6));
          vec2 inPlot = fract(fieldAt * vec2(1.0, 1.6));
          float pick = fract(sin(dot(plot, vec2(12.9898, 78.233))) * 43758.5453);
          vec3 crop = pick < 0.35 ? vec3(0.78, 0.66, 0.3) : (pick < 0.7 ? vec3(0.42, 0.58, 0.22) : vec3(0.42, 0.31, 0.2));
          float hedge = smoothstep(0.0, 0.07, min(min(inPlot.x, 1.0 - inPlot.x), min(inPlot.y, 1.0 - inPlot.y)));
          vec3 fields = crop * (0.62 + 0.38 * hedge);
          float plotSeen = 1.0 - smoothstep(0.15, 0.5, pixelSpan * 1040.0);
          fields = mix(vec3(0.5, 0.5, 0.25), fields, plotSeen);
          diffuseColor.rgb = mix(diffuseColor.rgb, fields, v_farm * 0.85);
        }

        // Coral on a warm, shallow sea bed (patch-data.ts, reef): clumps
        // of it in a few colours, lumpy, with the plain bed between —
        // seen through the shallows from above, and close to on a dive.
        if (v_reef > 0.01) {
          vec3 rp = vDetailPosition * 1800.0;
          float clump = detailNoise(rp * 0.35);
          float lumps = detailNoise(rp * 1.6);
          float hue = detailNoise(rp * 0.12 + 17.0);
          vec3 coral = mix(
            mix(vec3(0.9, 0.32, 0.3), vec3(0.95, 0.6, 0.22), smoothstep(0.3, 0.6, hue)),
            vec3(0.55, 0.3, 0.8),
            smoothstep(0.62, 0.85, hue));
          // From above, only the shallows' coral: reefs run deeper now so a
          // dive can find them, and seen down through that much water they
          // blotched the warm seas pink. From below, all of it.
          float reefDepth = ${SEA_RADIUS.toFixed(5)} - length(vDetailPosition);
          float reefSeen = v_reef * mix(1.0 - smoothstep(0.0018, 0.006, reefDepth), 1.0, detailUnder);
          float body = smoothstep(0.5, 0.66, clump) * reefSeen;
          // Each noise faded to its average once a pixel spans its grain, as
          // the canopy's are: read raw from orbit the clumps and lumps were
          // finer than a pixel, and every warm coast sparkled as it turned.
          float clumpSeen = 1.0 - smoothstep(0.15, 0.5, pixelSpan * 630.0);
          float lumpSeen = 1.0 - smoothstep(0.15, 0.5, pixelSpan * 2880.0);
          float hueSeen = 1.0 - smoothstep(0.15, 0.5, pixelSpan * 216.0);
          coral = mix(vec3(0.8, 0.42, 0.38), coral, hueSeen);
          body = mix(reefSeen * 0.3, body, clumpSeen);
          lumps = mix(0.5, lumps, lumpSeen);
          diffuseColor.rgb = mix(diffuseColor.rgb, coral * (0.7 + 0.5 * lumps), body);
          detailHeight += (lumps - 0.5) * 2.0 * body;
        }

        diffuseColor.rgb *= detailShade * (1.0 + detailHeight * 0.3);
        diffuseColor.rgb *= 1.0 - cloudShadow(vDetailPosition) * 0.55;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * detailRough, 0.3, 1.0);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        // The photographs' own relief first, tilted in the planet's frame
        // and brought into view space; the procedural bumps on top.
        if (dot(detailTilt, detailTilt) > 0.0) {
          vec3 tilted = normalize(normalize(vDetailNormal) + detailTilt * 0.55);
          normal = normalize(detailNormalMatrix * tilted) * faceDirection;
        }
        normal = detailBump(
          -vViewPosition,
          normal,
          vec2(dFdx(detailHeight), dFdy(detailHeight)) * 0.9,
          faceDirection);
        // Creases are darker: the ground's own curvature from the screen
        // derivatives of its smooth normal against its position — normals
        // that converge as the position runs is a hollow, which the sky
        // lights less — near the eye, where a gully is otherwise lit the
        // same as the open slope either side.
        {
          vec3 creaseN = normalize(vDetailNormal);
          vec3 cpx = dFdx(vDetailPosition);
          vec3 cpy = dFdy(vDetailPosition);
          float creaseSpan = dot(cpx, cpx) + dot(cpy, cpy);
          float curvature = (dot(dFdx(creaseN), cpx) + dot(dFdy(creaseN), cpy)) / max(creaseSpan, 1e-14);
          float creaseNear = 1.0 - smoothstep(0.03, 0.25, detailDistance);
          detailCrease = 1.0 - clamp(-curvature * 0.0012, 0.0, 0.4) * creaseNear;
        }`,
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse *= detailCrease;
        reflectedLight.directDiffuse *= 0.6 + 0.4 * detailCrease;
        // The planet shadows its own ground: once the sun is under the
        // horizon it lights nothing there, however a slope faces. Without
        // it, every hillside turned towards a sun already set glowed red
        // across the dark, the evening's light on the wrong side of night.
        #if NUM_DIR_LIGHTS > 0
        {
          vec3 groundUp = normalize(detailNormalMatrix * normalize(vDetailPosition));
          float groundDay = smoothstep(-0.05, 0.08, dot(groundUp, directionalLights[0].direction));
          // And the rings, if any, cast their bands across it.
          groundDay *= 1.0 - ringShadowFrom(vDetailPosition, detailCloudSun);
          // And a moon, passing before the sun, its shadow (eclipse.ts).
          groundDay *= 1.0 - moonShadowFrom(vDetailPosition, detailCloudSun);
          reflectedLight.directDiffuse *= groundDay;
          reflectedLight.directSpecular *= groundDay;
          // Seen from afar, the line where day turns to night burns warm:
          // the ground there is lit by a sun on its horizon, through the most
          // air. The light at the eye is reddened already from a glide, so
          // only from far off — at a glide it would redden twice.
          {
            float dawnLine = (dot(groundUp, directionalLights[0].direction) - 0.03) / 0.07;
            float farSeen = smoothstep(0.15, 0.6, length(vViewPosition));
            vec3 warm = mix(vec3(1.0), vec3(1.25, 0.62, 0.34), exp(-dawnLine * dawnLine) * farSeen);
            reflectedLight.directDiffuse *= warm;
            // From afar the sky's light is one fill over the whole planet,
            // and it lit the night side blue-grey: dimmed where the sun is
            // down, so the night is dark and the towns' lights carry it.
            float nightSide = 1.0 - smoothstep(-0.25, 0.05, dot(groundUp, directionalLights[0].direction));
            reflectedLight.indirectDiffuse *= 1.0 - 0.8 * nightSide * farSeen;
          }
          // Seen from under the sea, the sun through the moving surface
          // draws a net of light on the sea bed: two drifting fields, bright
          // where they agree, and fainter the deeper the floor.
          if (detailUnder > 0.0) {
            float seaFloor = ${SEA_RADIUS.toFixed(5)} - length(vDetailPosition);
            if (seaFloor > 0.0) {
              vec3 cp = vDetailPosition * 1400.0;
              float ca = detailNoise(cp + vec3(detailTime * 0.35, 0.0, detailTime * 0.2));
              float cb = detailNoise(cp * 1.31 - vec3(detailTime * 0.25, detailTime * 0.3, 0.0));
              float net = pow(1.0 - abs(ca - cb), 14.0);
              float reach = exp(-seaFloor / 0.012);
              reflectedLight.directDiffuse *= 1.0 + net * 2.4 * reach * detailUnder;
            }
          }
          // Under the aurora's band, on the night side, the ground takes a
          // little of its green: snow most, being brightest.
          // The towns' glow on the ground round them, at night: what makes
          // a town a place from a glide, where its lights alone are a few
          // sparks. Off by day, on through the dusk.
          if (detailCityLight > 0.0) {
            vec3 cityUp = normalize(vDetailPosition);
            vec2 cityUv = vec2(atan(cityUp.z, -cityUp.x) / 6.2831853 + 0.5, 1.0 - acos(clamp(cityUp.y, -1.0, 1.0)) / 3.1415927);
            float cityDark = 1.0 - smoothstep(-0.12, 0.04, dot(cityUp, detailCloudSun));
            float town = texture2D(detailCities, cityUv).r;
            // Light on the ground's own colour, as it falls on the houses and
            // trees (town-glow.ts): emitted as a flat orange of its own, the
            // sand round a village shone beige while the village stood black.
            totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.62, 0.3) * town * town * town * cityDark * detailCityLight * 0.7;
          }
          if (detailAurora > 0.0) {
            vec3 up = normalize(vDetailPosition);
            // Squared by hand: pow of a negative base is NaN (sea-light.ts).
            float bandAt = (acos(abs(up.y)) - 0.37) / 0.13;
            float band = exp(-bandAt * bandAt);
            float dark = 1.0 - smoothstep(-0.25, 0.02, dot(up, detailCloudSun));
            totalEmissiveRadiance += diffuseColor.rgb * vec3(0.12, 0.85, 0.42) * band * dark * detailAurora;
          }
        }
        #endif`,
      )
    withValleyFog(shader, 'mistTop')
  }
  material.customProgramCacheKey = () =>
    molten ? 'planet-lava-ground-detail' : 'planet-ground-detail'
  return material
}
