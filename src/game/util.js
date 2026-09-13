
/* util.js — hashing, PRNG, noise, math helpers, safe localStorage, seed helpers and URL hash. */


  /** Shared gameplay constants (see CONTRACT §2). */
  const CONST = {
    CHUNK: 24,
    CELL: 0.5,
    CELLS: 48,
    LEVEL_H: 3,
    MARGIN: 5,
    DOOR_H: 3,
    PLAYER_RADIUS: 0.35,
    PLAYER_HEIGHT: 1.75,
    EYE_HEIGHT: 1.62,
    STEP_HEIGHT: 0.55,
    WATER_STEP_HEIGHT: 1.7,
    SWIM_DEPTH: 1.15,
    GRAVITY: 18,
    JUMP_SPEED: 6,
    WALK_SPEED: 3.4,
    SPRINT_SPEED: 5.8,
    FIXED_DT: 1 / 60,
    MAX_STEPS: 5,
  };

  /** Allowed characters for a seed string (also enforced by the seed input). */
  const SEED_CHARS = /[^a-z0-9_-]/g;
  const SEED_MAX_LENGTH = 32;
  const SEED_STRING_LENGTH = 8;
  const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

  /**
   * FNV-1a 32-bit hash over the UTF-16 code units of a string.
   * @param {string} str
   * @returns {number} unsigned 32-bit hash
   */
  function hashString(str) {
    const s = String(str);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /**
   * MurmurHash3 finalizer: scrambles a 32-bit integer so that every input bit affects every output bit.
   * @param {number} h
   * @returns {number} unsigned 32-bit
   */
  function fmix(h) {
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  /**
   * Mixes three 32-bit integers (negative ints allowed) into one well-distributed uint32.
   * Each input is multiplied by a distinct odd constant (a bijection on uint32) before finalizing,
   * so swapping arguments or changing a single input yields an unrelated result.
   * @param {number} a
   * @param {number} b
   * @param {number} c
   * @returns {number} unsigned 32-bit
   */
  function mix(a, b, c) {
    let h = ((a | 0) ^ 0x9e3779b9) >>> 0;
    h = fmix((h + Math.imul(b | 0, 0x85ebca6b)) | 0);
    h = fmix((h + Math.imul(c | 0, 0xc2b2ae35)) | 0);
    return h;
  }

  /**
   * Hash of a seed and two integer coordinates (chunk coords, lattice points, ...).
   * @param {number} seed
   * @param {number} a
   * @param {number} b
   * @returns {number} unsigned 32-bit
   */
  function hash2(seed, a, b) {
    return mix(seed, a | 0, b | 0);
  }

  /**
   * Mulberry32 PRNG. Returns a function producing floats in [0, 1).
   * @param {number} seedU32
   * @returns {function(): number}
   */
  function mulberry32(seedU32) {
    let a = seedU32 >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Deterministic PRNG built from a seed and any number of integers, folded with `mix`.
   * `rng(seed, cx, cz, tag)` gives an independent stream per (chunk, purpose).
   * @param {number} seed
   * @param {...number} ints
   * @returns {function(): number}
   */
  function rng(seed) {
    let h = seed >>> 0;
    for (let i = 1; i < arguments.length; i++) {
      // The position index goes into the mix so that (a, b) and (b, a) fold differently.
      h = mix(h, arguments[i] | 0, i);
    }
    return mulberry32(h);
  }

  /** @returns {number} v clamped to [lo, hi] */
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /** @returns {number} linear interpolation between a and b by t */
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /** @returns {number} Hermite smoothstep of x between edges e0 and e1 */
  function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /** Lattice value in [0, 1) for integer coordinates. */
  function latticeValue(seed, xi, yi) {
    return hash2(seed, xi, yi) / 4294967296;
  }

  /**
   * Smooth 2D value noise on the integer lattice, smoothstep-interpolated.
   * @param {number} seedU32
   * @param {number} x
   * @param {number} y
   * @returns {number} in [0, 1)
   */
  function valueNoise2(seedU32, x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smoothstep(0, 1, x - x0);
    const ty = smoothstep(0, 1, y - y0);
    const v00 = latticeValue(seedU32, x0, y0);
    const v10 = latticeValue(seedU32, x0 + 1, y0);
    const v01 = latticeValue(seedU32, x0, y0 + 1);
    const v11 = latticeValue(seedU32, x0 + 1, y0 + 1);
    return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
  }

  /**
   * Random 8-character lowercase base36 seed. Uses crypto.getRandomValues when available.
   * @returns {string}
   */
  function randomSeedString() {
    const values = new Uint32Array(SEED_STRING_LENGTH);
    const cryptoObj = window.crypto;
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      cryptoObj.getRandomValues(values);
    } else {
      for (let i = 0; i < values.length; i++) values[i] = Math.floor(Math.random() * 4294967296);
    }
    let out = '';
    for (let i = 0; i < values.length; i++) out += BASE36[values[i] % 36];
    return out;
  }

  /**
   * Derives the uint32 seed of a world at a given depth from the user-facing base seed.
   * @param {string} baseSeed
   * @param {number} depth
   * @returns {number} unsigned 32-bit
   */
  function worldSeed(baseSeed, depth) {
    return hashString(String(baseSeed) + '#' + depth);
  }

  /**
   * Reads and JSON-parses a localStorage entry; returns `fallback` on any failure or when absent.
   * @param {string} key
   * @param {*} fallback
   * @returns {*}
   */
  function storageGet(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }

  /**
   * JSON-stringifies and stores a value in localStorage.
   * @param {string} key
   * @param {*} value
   * @returns {boolean} true when the write succeeded
   */
  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Normalises a user-provided seed: lowercase, restricted charset, max length. Empty => null.
   * @param {string} raw
   * @returns {string|null}
   */
  function sanitizeSeed(raw) {
    const s = String(raw).toLowerCase().replace(SEED_CHARS, '').slice(0, SEED_MAX_LENGTH);
    return s.length ? s : null;
  }

  /**
   * Parses `location.hash` of the form "#seed=abc123&depth=2&mode=drains".
   * Missing or invalid parts yield seed null, depth 0, mode null.
   * @returns {{ seed: string|null, depth: number, mode: ('drains'|'wander'|null) }}
   */
  function readHash() {
    const result = { seed: null, depth: 0, mode: null };
    let hash = '';
    try {
      hash = String(window.location.hash || '');
    } catch (err) {
      return result;
    }
    if (hash.charAt(0) === '#') hash = hash.slice(1);
    const parts = hash.split('&');
    for (let i = 0; i < parts.length; i++) {
      const eq = parts[i].indexOf('=');
      if (eq <= 0) continue;
      let key = parts[i].slice(0, eq);
      let value = parts[i].slice(eq + 1);
      try {
        key = decodeURIComponent(key);
        value = decodeURIComponent(value);
      } catch (err) {
        continue;
      }
      if (key === 'seed') {
        result.seed = sanitizeSeed(value);
      } else if (key === 'depth') {
        const d = parseInt(value, 10);
        result.depth = Number.isFinite(d) && d > 0 ? d : 0;
      } else if (key === 'mode') {
        result.mode = value === 'drains' || value === 'wander' ? value : null;
      }
    }
    return result;
  }

  /**
   * Replaces the URL hash with the given world parameters without adding a history entry.
   * Silently ignores failures (history.replaceState can throw on file://).
   * @param {{ seed?: string, depth?: number, mode?: string }} params
   */
  function writeHash(params) {
    const p = params || {};
    const fields = [];
    const seed = p.seed !== undefined && p.seed !== null ? sanitizeSeed(p.seed) : null;
    if (seed) fields.push('seed=' + encodeURIComponent(seed));
    if (Number.isFinite(p.depth) && p.depth > 0) fields.push('depth=' + Math.floor(p.depth));
    if (p.mode === 'drains' || p.mode === 'wander') fields.push('mode=' + p.mode);
    const hash = fields.length ? '#' + fields.join('&') : '';
    try {
      const loc = window.location;
      window.history.replaceState(null, '', loc.pathname + loc.search + hash);
    } catch (err) {
      // file:// pages in some browsers refuse replaceState; the hash is purely a convenience there.
    }
  }

  /**
   * Detects a touch-first device by pointer capability (never by user agent).
   * @returns {boolean}
   */
  function isTouchDevice() {
    try {
      if (typeof window.matchMedia === 'function') {
        const coarse = window.matchMedia('(pointer: coarse)').matches;
        const hover = window.matchMedia('(hover: hover)').matches;
        if (coarse && !hover) return true;
        const fine = window.matchMedia('(pointer: fine)').matches;
        const nav = window.navigator;
        return !!(nav && nav.maxTouchPoints > 0) && !fine;
      }
      const nav = window.navigator;
      return !!(nav && nav.maxTouchPoints > 0);
    } catch (err) {
      return false;
    }
  }

  export { CONST };
  export const util = {
    hashString,
    mix,
    hash2,
    mulberry32,
    rng,
    clamp,
    lerp,
    smoothstep,
    valueNoise2,
    randomSeedString,
    worldSeed,
    storageGet,
    storageSet,
    readHash,
    writeHash,
    isTouchDevice,
  };

