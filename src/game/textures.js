import * as THREE from 'three';
import { util } from './util.js';
/* textures.js — runtime canvas textures: bevelled tiles, plaster, tileable water normal map, radial glow. */


  const TWO_PI = Math.PI * 2;

  /** Fractional part of a uint32 hash, in [0, 1). */
  function hashUnit(seed, x, y) {
    return util.hash2(seed, x, y) / 4294967296;
  }

  /**
   * Value noise whose lattice repeats every `period` cells, so sampling x in [0, period) tiles seamlessly.
   * @param {number} seed
   * @param {number} x
   * @param {number} y
   * @param {number} period integer lattice period
   * @returns {number} in [0, 1)
   */
  function periodicNoise(seed, x, y, period) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = util.smoothstep(0, 1, x - x0);
    const ty = util.smoothstep(0, 1, y - y0);
    const xa = ((x0 % period) + period) % period;
    const ya = ((y0 % period) + period) % period;
    const xb = (xa + 1) % period;
    const yb = (ya + 1) % period;
    const v00 = hashUnit(seed, xa, ya);
    const v10 = hashUnit(seed, xb, ya);
    const v01 = hashUnit(seed, xa, yb);
    const v11 = hashUnit(seed, xb, yb);
    return util.lerp(util.lerp(v00, v10, tx), util.lerp(v01, v11, tx), ty);
  }

  /**
   * Parses a CSS colour into sRGB components 0..255. Six-digit hex is parsed directly; anything else goes through
   * THREE.Color (whose getHex() returns sRGB regardless of the working colour space).
   * @param {string} css
   * @returns {{ r: number, g: number, b: number }}
   */
  function parseColor(css) {
    const s = String(css).trim();
    const m = /^#?([0-9a-f]{6})$/i.exec(s);
    let hex;
    if (m) {
      hex = parseInt(m[1], 16);
    } else {
      hex = new THREE.Color(s).getHex();
    }
    return { r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 };
  }

  /**
   * RGB (0..1) to HSL (all 0..1).
   * @returns {{ h: number, s: number, l: number }}
   */
  function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h / 6, s, l };
  }

  /** Helper for hslToRgb: one channel from the hue position. */
  function hueChannel(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  /**
   * HSL (0..1) to RGB (0..1).
   * @returns {{ r: number, g: number, b: number }}
   */
  function hslToRgb(h, s, l) {
    if (s <= 0) return { r: l, g: l, b: l };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return { r: hueChannel(p, q, h + 1 / 3), g: hueChannel(p, q, h), b: hueChannel(p, q, h - 1 / 3) };
  }

  /** Creates a square canvas plus its 2D context and an ImageData buffer to fill. */
  function makeCanvas(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);
    return { canvas, ctx, image };
  }

  /**
   * Wraps a filled canvas in a CanvasTexture with the shared settings from CONTRACT §4.
   * @param {HTMLCanvasElement} canvas
   * @param {{ colorSpace: string, repeat: boolean }} opts
   * @returns {THREE.CanvasTexture}
   */
  function finishTexture(canvas, opts) {
    
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = opts.colorSpace;
    const wrap = opts.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.wrapS = wrap;
    tex.wrapT = wrap;
    tex.needsUpdate = true;
    return tex;
  }

  /** Clamps a 0..255 float and writes an opaque pixel. */
  function putPixel(data, idx, r, g, b) {
    data[idx] = r < 0 ? 0 : r > 255 ? 255 : r;
    data[idx + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    data[idx + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    data[idx + 3] = 255;
  }

  /**
   * Bevelled ceramic tile texture. The texture spans `unitsPerTexture` world units with `tilesPerUnit` tiles per
   * unit, so world-space UVs (u = x / unitsPerTexture) tile it seamlessly. Each tile gets its own slight
   * lightness / hue / saturation shift, a highlight on its top-left edges and a shadow on its bottom-right edges,
   * a faint glaze blotch and per-pixel grain; grout lines are dark and slightly noisy.
   * @param {{ size?: number, unitsPerTexture?: number, tilesPerUnit?: number, baseColor?: string, variation?: number,
   *           groutColor?: string, seed?: number, groutPx?: number }} [opts]
   * @returns {THREE.CanvasTexture}
   */
  function createTileTexture(opts) {
    const o = opts || {};
    const size = o.size || 1024;
    const unitsPerTexture = o.unitsPerTexture || 4;
    const tilesPerUnit = o.tilesPerUnit || 2;
    const variation = o.variation !== undefined ? o.variation : 0.05;
    const seed = (o.seed !== undefined ? o.seed : 1) >>> 0;
    const base = parseColor(o.baseColor || '#f3f1ea');
    const grout = parseColor(o.groutColor || '#7c8791');

    const tilesAcross = Math.max(1, Math.round(unitsPerTexture * tilesPerUnit));
    const tilePx = size / tilesAcross;
    const groutPx = o.groutPx !== undefined ? o.groutPx : Math.max(2, Math.round(tilePx * 0.055));
    const bevelPx = Math.max(2, tilePx * 0.07);

    // Per-tile colours: HSL jitter around the base colour, deterministic per (seed, tile).
    const baseHsl = rgbToHsl(base.r / 255, base.g / 255, base.b / 255);
    const tileColors = new Float32Array(tilesAcross * tilesAcross * 3);
    for (let tj = 0; tj < tilesAcross; tj++) {
      for (let ti = 0; ti < tilesAcross; ti++) {
        const r = util.rng(seed, ti, tj, 0x71);
        const h = (baseHsl.h + (r() * 2 - 1) * 0.012 + 1) % 1;
        const s = util.clamp(baseHsl.s * (1 + (r() * 2 - 1) * 0.2), 0, 1);
        const l = util.clamp(baseHsl.l + (r() * 2 - 1) * variation, 0, 1);
        const c = hslToRgb(h, s, l);
        const k = (tj * tilesAcross + ti) * 3;
        tileColors[k] = c.r * 255;
        tileColors[k + 1] = c.g * 255;
        tileColors[k + 2] = c.b * 255;
      }
    }

    const { canvas, ctx, image } = makeCanvas(size);
    const data = image.data;
    const grainSeed = seed ^ 0x5bd1e995;
    const blotchSeed = seed ^ 0x27d4eb2f;
    const blotchCells = tilesAcross * 3; // blotch lattice period; integer multiple keeps it tileable
    const blotchScale = blotchCells / size;

    for (let y = 0; y < size; y++) {
      const tj = Math.min(tilesAcross - 1, Math.floor(y / tilePx));
      const py = y - tj * tilePx;
      for (let x = 0; x < size; x++) {
        const ti = Math.min(tilesAcross - 1, Math.floor(x / tilePx));
        const px = x - ti * tilePx;
        const idx = (y * size + x) * 4;
        const grain = hashUnit(grainSeed, x, y) - 0.5;

        if (px < groutPx || py < groutPx) {
          // Grout: dark, slightly grainy, a touch darker right against the tile edge (shadow in the seam).
          const seamShade = px < 1 || py < 1 ? 0.88 : 1;
          const f = seamShade * (1 + grain * 0.16);
          putPixel(data, idx, grout.r * f, grout.g * f, grout.b * f);
          continue;
        }

        // Distances to the tile's inner edges: top/left catch light, bottom/right fall into shadow.
        const dTop = (py - groutPx) / bevelPx;
        const dLeft = (px - groutPx) / bevelPx;
        const dBottom = (tilePx - py) / bevelPx;
        const dRight = (tilePx - px) / bevelPx;
        const highlight = Math.min(1, Math.max(0, 1 - dTop) + Math.max(0, 1 - dLeft));
        const shadow = Math.min(1, Math.max(0, 1 - dBottom) + Math.max(0, 1 - dRight));
        // Squaring gives the bevel a rounded falloff instead of a hard linear ramp.
        const bevel = highlight * highlight * 0.08 - shadow * shadow * 0.14;

        // Faint glaze blotches across the tile plus a gentle diagonal sheen from top-left to bottom-right.
        const blotch = (periodicNoise(blotchSeed, x * blotchScale, y * blotchScale, blotchCells) - 0.5) * 0.045;
        const sheen = (1 - (px + py) / (2 * tilePx)) * 0.03 - 0.015;

        const f = 1 + bevel + blotch + sheen + grain * 0.05;
        const k = (tj * tilesAcross + ti) * 3;
        putPixel(data, idx, tileColors[k] * f, tileColors[k + 1] * f, tileColors[k + 2] * f);
      }
    }

    ctx.putImageData(image, 0, 0);
    return finishTexture(canvas, { colorSpace: THREE.SRGBColorSpace, repeat: true });
  }

  /**
   * Plain plaster texture: two octaves of tileable low-frequency mottling plus fine grain, all very subtle.
   * @param {{ size?: number, baseColor?: string, noise?: number, seed?: number }} [opts]
   * @returns {THREE.CanvasTexture}
   */
  function createPlasterTexture(opts) {
    const o = opts || {};
    const size = o.size || 512;
    const noise = o.noise !== undefined ? o.noise : 0.03;
    const seed = (o.seed !== undefined ? o.seed : 1) >>> 0;
    const base = parseColor(o.baseColor || '#f7f7f4');

    const { canvas, ctx, image } = makeCanvas(size);
    const data = image.data;
    const coarseCells = 6;
    const fineCells = 24;
    const coarseScale = coarseCells / size;
    const fineScale = fineCells / size;
    const grainSeed = seed ^ 0x165667b1;
    const coarseSeed = seed ^ 0x2545f491;
    const fineSeed = seed ^ 0x7f4a7c15;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const coarse = periodicNoise(coarseSeed, x * coarseScale, y * coarseScale, coarseCells) - 0.5;
        const fine = periodicNoise(fineSeed, x * fineScale, y * fineScale, fineCells) - 0.5;
        const grain = hashUnit(grainSeed, x, y) - 0.5;
        const f = 1 + (coarse * 1.2 + fine * 0.7 + grain * 0.8) * noise;
        putPixel(data, idx, base.r * f, base.g * f, base.b * f);
      }
    }

    ctx.putImageData(image, 0, 0);
    return finishTexture(canvas, { colorSpace: THREE.SRGBColorSpace, repeat: true });
  }

  /**
   * Tileable tangent-space normal map for water. The height field is a sum of sine waves whose periods divide the
   * texture (integer wave numbers in u and v) plus two octaves of periodic noise, so it wraps seamlessly. Normals are
   * derived by central differences and encoded as RGB = N * 0.5 + 0.5 (flat = (0.5, 0.5, 1)), OpenGL convention
   * (green = +v). Linear colour space.
   * @param {{ size?: number, seed?: number, strength?: number }} [opts]
   * @returns {THREE.CanvasTexture}
   */
  function createWaterNormalTexture(opts) {
    const o = opts || {};
    const size = o.size || 256;
    const seed = (o.seed !== undefined ? o.seed : 1) >>> 0;
    const strength = o.strength !== undefined ? o.strength : 1.0;

    // Wave set: integer wave numbers keep every component periodic over the texture.
    const r = util.rng(seed, 0x77a7);
    const waveCount = 7;
    const waves = [];
    for (let i = 0; i < waveCount; i++) {
      const ku = (2 + Math.floor(r() * 8)) * (r() < 0.5 ? -1 : 1);
      const kv = 2 + Math.floor(r() * 8);
      waves.push({ ku, kv, amp: 1 / (1 + i * 0.45), phase: r() * TWO_PI });
    }
    const noiseSeedA = seed ^ 0x3c6ef372;
    const noiseSeedB = seed ^ 0xa54ff53a;

    // Height field in texture space (u, v in [0, 1)).
    const heights = new Float32Array(size * size);
    let maxAbs = 1e-6;
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        let h = 0;
        for (let i = 0; i < waveCount; i++) {
          const w = waves[i];
          h += w.amp * Math.sin(TWO_PI * (w.ku * u + w.kv * v) + w.phase);
        }
        h += (periodicNoise(noiseSeedA, u * 6, v * 6, 6) - 0.5) * 1.4;
        h += (periodicNoise(noiseSeedB, u * 14, v * 14, 14) - 0.5) * 0.7;
        heights[y * size + x] = h;
        const a = Math.abs(h);
        if (a > maxAbs) maxAbs = a;
      }
    }

    // Gradient scale: per-pixel differences shrink with resolution, so scale by size to keep slopes resolution-independent.
    const slope = (strength * size) / (40 * maxAbs);
    const { canvas, ctx, image } = makeCanvas(size);
    const data = image.data;
    for (let y = 0; y < size; y++) {
      const yUp = (y - 1 + size) % size;
      const yDown = (y + 1) % size;
      for (let x = 0; x < size; x++) {
        const xLeft = (x - 1 + size) % size;
        const xRight = (x + 1) % size;
        const dhdx = (heights[y * size + xRight] - heights[y * size + xLeft]) * 0.5 * slope;
        const dhdy = (heights[yDown * size + x] - heights[yUp * size + x]) * 0.5 * slope;
        // Canvas rows run top-down while v runs bottom-up (flipY), so +v is -y in canvas space.
        let nx = -dhdx;
        let ny = dhdy;
        let nz = 1;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx *= inv;
        ny *= inv;
        nz *= inv;
        const idx = (y * size + x) * 4;
        data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
        data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(image, 0, 0);
    return finishTexture(canvas, { colorSpace: THREE.NoColorSpace, repeat: true });
  }

  /**
   * Soft radial glow: white with alpha falling from 1 at the centre to 0 at the edge (bright core, long tail).
   * Clamped wrapping, sRGB.
   * @param {{ size?: number }} [opts]
   * @returns {THREE.CanvasTexture}
   */
  function createGlowTexture(opts) {
    const o = opts || {};
    const size = o.size || 128;
    const { canvas, ctx, image } = makeCanvas(size);
    const data = image.data;
    const half = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5 - half) / half;
        const dy = (y + 0.5 - half) / half;
        const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
        // Blend of a tight core and a wide tail so the disc reads as a light source rather than a flat blob.
        const core = Math.pow(Math.max(0, 1 - d * 2.2), 2);
        const tail = Math.pow(1 - d, 2.4);
        const alpha = Math.min(1, core * 0.6 + tail);
        const idx = (y * size + x) * 4;
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
    return finishTexture(canvas, { colorSpace: THREE.SRGBColorSpace, repeat: false });
  }

  export const textures = {
    createTileTexture,
    createPlasterTexture,
    createWaterNormalTexture,
    createGlowTexture,
  };

