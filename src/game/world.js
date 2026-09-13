import { tileFinish, setSurfaceQuality } from './surfaces.js';
import { createSoundscape } from './acoustics.js';
import { OCEAN_WAVES } from './ocean.js';
import { RAIN_PATTERN } from './water-effects.js';
import * as THREE from 'three';
import { createLandmark, inLandmark, landmarkTerrain, PAVILION } from './landmark.js';
import { createJourney } from './journey.js';
import { util } from './util.js';
import { CONST } from './util.js';
/* world.js — chunked procedural poolrooms world: layout, geometry, collision data, water, drains, chunk lifecycle. */


  
  
  const C = CONST;

  const CHUNK = C.CHUNK;
  const CELL = C.CELL;
  const CELLS = C.CELLS;
  const LEVEL_H = C.LEVEL_H;
  const MARGIN = C.MARGIN;
  const DOOR_H = C.DOOR_H;
  const HALF = CHUNK / 2;          // doorways and arms are centred on local 12
  const U = 4;                     // textures.unitsPerTexture: world units covered by one texture repeat
  const WALL_T = 0.25;             // each chunk's half of an edge wall
  const SOLID = 1e6;               // floorY marker for unreachable (solid) cells
  const WATER_DROP = 0.12;         // pool water surface sits this far below the rim
  const STAIR_W = 8;               // stairwell staircase width (centred on the doorway)
  const MAX_RISER = 0.3;           // stair riser limit (STEP_HEIGHT is 0.55)
  const RAIL_H = 1.0;              // railing height above the tread
  const RAIL_BLOCK_H = 2.2;        // railing collision AABBs reach this high so a jump cannot land on them
  const PANEL_DROP = 0.03;         // ceiling panels hang this far below the ceiling
  const FLICKER_PERIOD = 40;       // mean seconds between panel flickers per chunk
  const DRAIN_LIGHT = 6;           // drain point light base intensity
  const DRAIN_LIGHTS = 0;          // Exploration uses no drain point lights.

  /** Level thresholds: the wide middle band is level 0, the tails are raised plateaus (levels 1 and 2). */
  const LEVEL_LO = 0.15;
  const LEVEL_HI = 0.85;

  /** Ceiling height (relative to baseY) per room type. */
  const CEILING = { pavilion: PAVILION.height, dry: 4.2, shallow: 4.6, deep: 5.2, corridor: 3.0, stairwell: 5.0, atrium: 9.0 };

  /** Door directions: the neighbour offset and the axis of the shared edge. */
  const DIRS = {
    n: { dx: 0, dz: -1, axis: 'z' },
    e: { dx: 1, dz: 0, axis: 'x' },
    s: { dx: 0, dz: 1, axis: 'z' },
    w: { dx: -1, dz: 0, axis: 'x' },
  };
  const DIR_KEYS = ['n', 'e', 's', 'w'];

  /** Map key for a chunk coordinate pair. */
  function keyOf(cx, cz) {
    return cx + ',' + cz;
  }

  /**
   * Creates the world. See CONTRACT §7 for the full API.
   * @param {{ scene: THREE.Scene, seed: number, ring: number, textures: object, maxAnisotropy: number, mode: string }} opts
   */
  function createWorld(opts) {
    const scene = opts.scene;
    const seed = opts.seed >>> 0;
    const textures = opts.textures;
    let ring = Math.max(1, opts.ring | 0);

    const group = new THREE.Group();
    group.name = 'world';
    scene.add(group);

    // ------------------------------------------------------------------------------------------
    // 7.1 Deterministic chunk description (pure functions of seed + coords)
    // ------------------------------------------------------------------------------------------

    const noiseSeed = (seed ^ 0x9e3779b9) >>> 0;
    const infoCache = new Map();

    /** Floor level {0,1,2} of a chunk; the 5x5 block around the pavilion has base level 0. */
    function levelOf(cx, cz) {
      if (Math.abs(cx) <= 2 && Math.abs(cz) <= 2) return 0;
      const n = util.valueNoise2(noiseSeed, cx / 6.5, cz / 6.5);
      return n < LEVEL_LO ? 1 : n < LEVEL_HI ? 0 : 2;
    }

    function baseYOf(cx, cz) {
      return levelOf(cx, cz) * LEVEL_H;
    }

    /** Room type; stairwells are forced wherever a neighbour sits on a different level. */
    function typeOf(cx, cz) {
      if (inLandmark(cx, cz)) return 'pavilion';
      const level = levelOf(cx, cz);
      if (levelOf(cx + 1, cz) !== level || levelOf(cx - 1, cz) !== level ||
          levelOf(cx, cz + 1) !== level || levelOf(cx, cz - 1) !== level) return 'stairwell';
      const r = util.rng(seed, cx, cz, 0x7e)();
      if (r < 0.26) return 'dry';
      if (r < 0.50) return 'shallow';
      if (r < 0.70) return 'deep';
      if (r < 0.88) return 'corridor';
      if (r < 0.94) return 'atrium';
      return 'dry';
    }

    /** Doorway floor height of the edge between two chunks (symmetric average of both base heights). */
    function doorYBetween(ax, az, bx, bz) {
      return (baseYOf(ax, az) + baseYOf(bx, bz)) / 2;
    }

    /**
     * Absolute ceiling height. Stairwells raise their ceiling when a doorway sits high enough that
     * the door plus lintel would not fit under the nominal one (levels may differ by two).
     */
    function ceilYOf(cx, cz) {
      const type = typeOf(cx, cz);
      const base = baseYOf(cx, cz);
      let ceil = base + CEILING[type];
      if (type === 'stairwell') {
        for (let k = 0; k < DIR_KEYS.length; k++) {
          const d = DIRS[DIR_KEYS[k]];
          const dy = doorYBetween(cx, cz, cx + d.dx, cz + d.dz);
          ceil = Math.max(ceil, dy + DOOR_H + 0.6);
        }
      }
      return ceil;
    }

    /**
     * Description of the edge on the +axis side of chunk (cx, cz). Every x-edge is open (global
     * connectivity); z-edges open with probability 0.65. Width and height are symmetric by construction.
     */
    function edgeInfo(cx, cz, axis) {
      const bx = axis === 'x' ? cx + 1 : cx;
      const bz = axis === 'x' ? cz : cz + 1;
      const r = util.rng(seed, cx, cz, axis === 'x' ? 0x58 : 0x51);
      const landmarkEdge = inLandmark(cx, cz) || inLandmark(bx, bz);
      const open = landmarkEdge || axis === 'x' ? true : r() < 0.65;
      const wr = r();
      const width = landmarkEdge ? 8 : wr < 0.4 ? 2 : wr < 0.8 ? 4 : 8;
      const y = doorYBetween(cx, cz, bx, bz);
      let height = DOOR_H;
      if (width === 8) height = Math.max(DOOR_H, Math.min(ceilYOf(cx, cz), ceilYOf(bx, bz)) - 0.8 - y);
      return { open, width, y, height };
    }

    /**
     * Full deterministic description of a chunk (cached). doors.n is the z-edge of (cx, cz-1),
     * doors.w the x-edge of (cx-1, cz), doors.s/doors.e this chunk's own z/x edges.
     * @returns {{ cx:number, cz:number, type:string, level:number, baseY:number, ceilY:number, doors:object }}
     */
    function chunkInfo(cx, cz) {
      const key = keyOf(cx, cz);
      let info = infoCache.get(key);
      if (info) return info;
      const type = typeOf(cx, cz);
      info = {
        cx, cz, type,
        level: levelOf(cx, cz),
        baseY: baseYOf(cx, cz),
        ceilY: ceilYOf(cx, cz),
        doors: {
          n: edgeInfo(cx, cz - 1, 'z'),
          e: edgeInfo(cx, cz, 'x'),
          s: edgeInfo(cx, cz, 'z'),
          w: edgeInfo(cx - 1, cz, 'x'),
        },
        hasDrain: type === 'deep' && util.rng(seed, cx, cz, 0xd7)() < 0.6,
      };
      infoCache.set(key, info);
      return info;
    }

    // ------------------------------------------------------------------------------------------
    // 7.4 Geometry builder: typed-array accumulation per material key
    // ------------------------------------------------------------------------------------------

    const MAT_KEYS = ['floor', 'pool', 'wall', 'ceiling'];
    const ALL_FACES = { px: true, nx: true, py: true, ny: true, pz: true, nz: true };

    function createBuffer() {
      return { pos: [], nrm: [], uv: [], idx: [], count: 0 };
    }

    /**
     * Collects quads per material key and turns them into one BufferGeometry each.
     * UVs are world-space planar (u = x/U, v = z/U for horizontal faces; the two in-plane axes / U for
     * vertical faces), so texture tiling is continuous across chunk borders.
     */
    function createBuilder() {
      const buffers = {};
      for (let k = 0; k < MAT_KEYS.length; k++) buffers[MAT_KEYS[k]] = createBuffer();

      /** Emits one quad; corner order is fixed up so the triangles face along (nx, ny, nz). */
      function quad(mat, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz) {
        // Winding check: flip the order when the geometric normal opposes the requested one.
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        const gx = e1y * e2z - e1z * e2y;
        const gy = e1z * e2x - e1x * e2z;
        const gz = e1x * e2y - e1y * e2x;
        if (gx * nx + gy * ny + gz * nz < 0) {
          let t;
          t = bx; bx = dx; dx = t; t = by; by = dy; dy = t; t = bz; bz = dz; dz = t;
        }
        const b = buffers[mat];
        const base = b.count;
        b.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
        b.nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
        if (ny !== 0) {
          b.uv.push(ax / U, az / U, bx / U, bz / U, cx / U, cz / U, dx / U, dz / U);
        } else if (nx !== 0) {
          b.uv.push(az / U, ay / U, bz / U, by / U, cz / U, cy / U, dz / U, dy / U);
        } else {
          b.uv.push(ax / U, ay / U, bx / U, by / U, cx / U, cy / U, dx / U, dy / U);
        }
        b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        b.count += 4;
      }

      /** Horizontal quad at height y over [x0,x1]x[z0,z1]; `up` selects which side is visible. */
      function addQuadY(x0, z0, x1, z1, y, mat, up) {
        quad(mat, x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0, 0, up === false ? -1 : 1, 0);
      }

      /** Vertical quad in the plane x = const, facing +x when `positive`. */
      function addQuadX(x, z0, z1, y0, y1, mat, positive) {
        quad(mat, x, y0, z0, x, y0, z1, x, y1, z1, x, y1, z0, positive ? 1 : -1, 0, 0);
      }

      /** Vertical quad in the plane z = const, facing +z when `positive`. */
      function addQuadZ(z, x0, x1, y0, y1, mat, positive) {
        quad(mat, x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z, 0, 0, positive ? 1 : -1);
      }

      /**
       * Axis-aligned box; `faces` selects which of px/nx/py/ny/pz/nz to emit (default all).
       */
      function addBox(x0, y0, z0, x1, y1, z1, mat, faces) {
        const f = faces || ALL_FACES;
        if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
        if (f.px) addQuadX(x1, z0, z1, y0, y1, mat, true);
        if (f.nx) addQuadX(x0, z0, z1, y0, y1, mat, false);
        if (f.py) addQuadY(x0, z0, x1, z1, y1, mat, true);
        if (f.ny) addQuadY(x0, z0, x1, z1, y0, mat, false);
        if (f.pz) addQuadZ(z1, x0, x1, y0, y1, mat, true);
        if (f.nz) addQuadZ(z0, x0, x1, y0, y1, mat, false);
      }

      /**
       * Sloped bar of square cross-section `t` from (x0,y0,z0) to (x1,y1,z1), used for hand rails.
       * The bar's local frame is: along = p1 - p0, side = horizontal perpendicular, up = along x side.
       */
      function addBar(x0, y0, z0, x1, y1, z1, t, mat) {
        let ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
        const len = Math.sqrt(ax * ax + ay * ay + az * az);
        if (len < 1e-4) return;
        ax /= len; ay /= len; az /= len;
        // Horizontal side vector (perpendicular to the bar's horizontal projection).
        let sx = -az, sz = ax;
        const sl = Math.sqrt(sx * sx + sz * sz) || 1;
        sx /= sl; sz /= sl;
        // Up vector = along x side (perpendicular to both).
        const ux = ay * sz, uy = az * sx - ax * sz, uz = -ay * sx;
        const h = t / 2;
        const corner = (ex, ey, ez, ss, uu) => [ex + sx * ss * h + ux * uu * h, ey + uy * uu * h, ez + sz * ss * h + uz * uu * h];
        const p = [
          corner(x0, y0, z0, -1, -1), corner(x0, y0, z0, 1, -1), corner(x0, y0, z0, 1, 1), corner(x0, y0, z0, -1, 1),
          corner(x1, y1, z1, -1, -1), corner(x1, y1, z1, 1, -1), corner(x1, y1, z1, 1, 1), corner(x1, y1, z1, -1, 1),
        ];
        const face = (a, b, c, d, nx, ny, nz) => quad(mat, p[a][0], p[a][1], p[a][2], p[b][0], p[b][1], p[b][2],
          p[c][0], p[c][1], p[c][2], p[d][0], p[d][1], p[d][2], nx, ny, nz);
        face(0, 1, 5, 4, -ux, -uy, -uz);   // bottom
        face(3, 2, 6, 7, ux, uy, uz);      // top
        face(1, 2, 6, 5, sx, 0, sz);       // +side
        face(0, 3, 7, 4, -sx, 0, -sz);     // -side
        face(0, 1, 2, 3, -ax, -ay, -az);   // start cap
        face(4, 5, 6, 7, ax, ay, az);      // end cap
      }

      /** Converts the accumulated arrays into BufferGeometries (null for empty keys). */
      function build() {
        const out = {};
        for (let k = 0; k < MAT_KEYS.length; k++) {
          const key = MAT_KEYS[k];
          const b = buffers[key];
          if (b.count === 0) {
            out[key] = null;
            continue;
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
          geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
          geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
          geo.setIndex(b.idx);
          geo.computeBoundingSphere();
          out[key] = geo;
        }
        return out;
      }

      return { addQuadY, addQuadX, addQuadZ, addBox, addBar, build };
    }

    // ------------------------------------------------------------------------------------------
    // Cell grid (collision data, §7.3) and the heightfield mesher that renders it
    // ------------------------------------------------------------------------------------------

    /** Material index per cell for the floor heightfield. */
    const M_FLOOR = 0;
    const M_POOL = 1;
    const FLOOR_MATS = ['floor', 'pool'];
    const CEIL_MATS = ['ceiling', 'ceiling'];

    function createGrid(baseY, ceilY) {
      const n = CELLS * CELLS;
      const grid = {
        floorY: new Float32Array(n),
        ceilY: new Float32Array(n),
        waterY: new Float32Array(n),
        mat: new Uint8Array(n),
      };
      grid.floorY.fill(baseY);
      grid.ceilY.fill(ceilY);
      grid.waterY.fill(NaN);
      return grid;
    }

    /** First cell index whose centre is >= v (local units), clamped to [0, CELLS]. */
    function cellFrom(v) {
      return util.clamp(Math.ceil(v / CELL - 0.5 - 1e-9), 0, CELLS);
    }

    /**
     * Writes `value` into every cell of `arr` whose centre lies in [lx0, lx1) x [lz0, lz1) (local coords).
     * Optionally writes `matValue` into `matArr` for the same cells.
     */
    function fillRect(arr, lx0, lz0, lx1, lz1, value, matArr, matValue) {
      const i0 = cellFrom(lx0), i1 = cellFrom(lx1);
      const j0 = cellFrom(lz0), j1 = cellFrom(lz1);
      for (let j = j0; j < j1; j++) {
        const row = j * CELLS;
        for (let i = i0; i < i1; i++) {
          arr[row + i] = value;
          if (matArr) matArr[row + i] = matValue;
        }
      }
    }

    /**
     * Emits a cell heightfield as geometry: greedy-merged horizontal quads for cells of equal height and
     * material, plus vertical "riser" quads wherever two neighbouring cells differ in height. Solid
     * cells (height >= SOLID/2) are skipped entirely; the walls enclosing them are added separately.
     * For floors (`up`) risers face the lower cell and use its material; for ceilings they face the
     * higher cell. No faces are emitted on the chunk border: the edge walls cover the seam.
     * @param {object} b builder
     * @param {Float32Array} heights
     * @param {Uint8Array|null} mats
     * @param {number} ox world x of local 0
     * @param {number} oz world z of local 0
     * @param {boolean} up
     */
    function meshHeightfield(b, heights, mats, ox, oz, up) {
      const names = up ? FLOOR_MATS : CEIL_MATS;
      const solidLimit = SOLID / 2;
      const visited = new Uint8Array(CELLS * CELLS);
      const matOf = (idx) => (mats ? mats[idx] : 0);

      // Top/bottom faces: greedy rectangles.
      for (let j = 0; j < CELLS; j++) {
        for (let i = 0; i < CELLS; i++) {
          const idx = j * CELLS + i;
          if (visited[idx]) continue;
          const h = heights[idx];
          if (h >= solidLimit) {
            visited[idx] = 1;
            continue;
          }
          const m = matOf(idx);
          let w = 1;
          while (i + w < CELLS && !visited[idx + w] && heights[idx + w] === h && matOf(idx + w) === m) w++;
          let d = 1;
          outer:
          while (j + d < CELLS) {
            const row = (j + d) * CELLS + i;
            for (let k = 0; k < w; k++) {
              if (visited[row + k] || heights[row + k] !== h || matOf(row + k) !== m) break outer;
            }
            d++;
          }
          for (let dj = 0; dj < d; dj++) {
            const row = (j + dj) * CELLS + i;
            for (let k = 0; k < w; k++) visited[row + k] = 1;
          }
          b.addQuadY(ox + i * CELL, oz + j * CELL, ox + (i + w) * CELL, oz + (j + d) * CELL, h, names[m], up);
        }
      }

      // Risers between x-neighbours (faces in planes x = const), merged along z.
      for (let i = 0; i < CELLS - 1; i++) {
        let runStart = -1, runLo = 0, runHi = 0, runMat = 0, runPos = false;
        const flush = (jEnd) => {
          if (runStart < 0) return;
          b.addQuadX(ox + (i + 1) * CELL, oz + runStart * CELL, oz + jEnd * CELL, runLo, runHi, names[runMat], runPos);
          runStart = -1;
        };
        for (let j = 0; j < CELLS; j++) {
          const ia = j * CELLS + i;
          const ha = heights[ia], hb = heights[ia + 1];
          let lo = 0, hi = 0, mat = 0, pos = false, has = false;
          if (ha < solidLimit && hb < solidLimit && ha !== hb) {
            has = true;
            lo = Math.min(ha, hb);
            hi = Math.max(ha, hb);
            const lowerIsA = ha < hb;
            // Floors: face toward the lower cell. Ceilings: face toward the higher cell.
            pos = up ? !lowerIsA : lowerIsA;
            mat = up ? matOf(lowerIsA ? ia : ia + 1) : 0;
          }
          if (!has || (runStart >= 0 && (lo !== runLo || hi !== runHi || mat !== runMat || pos !== runPos))) flush(j);
          if (has && runStart < 0) {
            runStart = j; runLo = lo; runHi = hi; runMat = mat; runPos = pos;
          }
        }
        flush(CELLS);
      }

      // Risers between z-neighbours (faces in planes z = const), merged along x.
      for (let j = 0; j < CELLS - 1; j++) {
        let runStart = -1, runLo = 0, runHi = 0, runMat = 0, runPos = false;
        const flush = (iEnd) => {
          if (runStart < 0) return;
          b.addQuadZ(oz + (j + 1) * CELL, ox + runStart * CELL, ox + iEnd * CELL, runLo, runHi, names[runMat], runPos);
          runStart = -1;
        };
        for (let i = 0; i < CELLS; i++) {
          const ia = j * CELLS + i;
          const ib = ia + CELLS;
          const ha = heights[ia], hb = heights[ib];
          let lo = 0, hi = 0, mat = 0, pos = false, has = false;
          if (ha < solidLimit && hb < solidLimit && ha !== hb) {
            has = true;
            lo = Math.min(ha, hb);
            hi = Math.max(ha, hb);
            const lowerIsA = ha < hb;
            pos = up ? !lowerIsA : lowerIsA;
            mat = up ? matOf(lowerIsA ? ia : ib) : 0;
          }
          if (!has || (runStart >= 0 && (lo !== runLo || hi !== runHi || mat !== runMat || pos !== runPos))) flush(i);
          if (has && runStart < 0) {
            runStart = i; runLo = lo; runHi = hi; runMat = mat; runPos = pos;
          }
        }
        flush(CELLS);
      }
    }

    // ------------------------------------------------------------------------------------------
    // Shared materials and geometries (created once, disposed in world.dispose())
    // ------------------------------------------------------------------------------------------

    function surfaceMaterial(map) {
      return new THREE.MeshStandardMaterial({ map, ...tileFinish(map, textures), roughness: 0.6, metalness: 0 });
    }

    const materials = {
      floor: surfaceMaterial(textures.floor),
      pool: surfaceMaterial(textures.pool),
      wall: surfaceMaterial(textures.wall),
      ceiling: surfaceMaterial(textures.ceiling),
    };

    const causticTime = { value: 0 };
    materials.pool.userData.causticTime = causticTime;
    materials.pool.onBeforeCompile = (shader) => {
      shader.uniforms.uCausticTime = causticTime;
      shader.vertexShader = 'varying vec3 vCausticWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCausticWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = 'uniform float uCausticTime;\nvarying vec3 vCausticWorld;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        vec2 q = vCausticWorld.xz * 2.2;
        float a = sin(q.x + sin(q.y * 1.3 + uCausticTime * 0.5));
        float b = cos(q.y + sin(q.x * 0.8 - uCausticTime * 0.4));
        float light = pow(1.0 - abs(a * b), 18.0);
        totalEmissiveRadiance += vec3(0.12, 0.25, 0.20) * light;
      `);
    };

    const panelGeo = new THREE.PlaneGeometry(1, 1);
    // Emissive-looking panels: colour above 1 so the bloom pass picks them up; unlit so they read as light sources.
    const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.35, 1.33, 1.28), side: THREE.DoubleSide });
    const postGeo = new THREE.BoxGeometry(1, 1, 1);
    const pillarGeo = new THREE.CylinderGeometry(0.55, 0.55, 1, 8, 1);
    {
      // Atrium pillars are always 9 units tall and radius 0.55: scale the UVs so the wall tiles keep their size.
      const uvAttr = pillarGeo.getAttribute('uv');
      const uScale = (2 * Math.PI * 0.55) / U;
      const vScale = CEILING.atrium / U;
      for (let i = 0; i < uvAttr.count; i++) uvAttr.setXY(i, uvAttr.getX(i) * uScale, uvAttr.getY(i) * vScale);
      uvAttr.needsUpdate = true;
    }
    const drainRingGeo = new THREE.TorusGeometry(0.55, 0.09, 8, 24);
    const drainDiscGeo = new THREE.CircleGeometry(0.9, 24);
    const drainRingMat = new THREE.MeshStandardMaterial({ color: 0x1b2b33, roughness: 0.55, metalness: 0.15 });
    const drainGlowMat = new THREE.MeshBasicMaterial({
      map: textures.glow,
      color: new THREE.Color(0.6, 1.4, 1.6),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false, // additive: fogging would brighten distant drains instead of fading them
    });

    // Drain lighting: a fixed pool of point lights that setTime() moves onto the nearest drains. Adding or
    // removing lights would change the scene's light count and force every lit material to recompile.
    const lightPool = [];
    for (let i = 0; i < DRAIN_LIGHTS; i++) {
      const light = new THREE.PointLight(0x9fe8ff, 0, 9, 2);
      light.name = 'drain light';
      light.position.set(0, -1000, 0);
      group.add(light);
      lightPool.push(light);
    }
    const litDrains = new Array(DRAIN_LIGHTS).fill(null);   // nearest drains, closest first (rebuilt each frame)
    const litDist = new Float64Array(DRAIN_LIGHTS);          // their squared distances to the camera

    const panelWhite = new THREE.Color(1, 1, 1);
    const tmpColor = new THREE.Color();
    const tmpMatrix = new THREE.Matrix4();
    const tmpPos = new THREE.Vector3();
    const tmpScale = new THREE.Vector3();
    const panelQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)); // plane faces down
    const identityQuat = new THREE.Quaternion();

    // ------------------------------------------------------------------------------------------
    // Water shader (§7.4)
    // ------------------------------------------------------------------------------------------

    // Fog uses Three's own chunks (fog_*): the renderer fills fogColor/fogNear/fogFar from scene.fog every
    // frame and applies it after tone mapping, exactly like the lit materials, so water matches the room.
    // Shared by ocean displacement and shading so visible crests and their normals agree.
    const WATER_VERT = [
      'uniform float uTime;',
      'varying vec3 vWorld;',
      '#include <fog_pars_vertex>',
      '#ifdef OCEAN',
      OCEAN_WAVES,
      '#endif',
      'void main() {',
      '  vec4 wp = modelMatrix * vec4(position, 1.0);',
      '#ifdef OCEAN',
      '  wp.y += oceanSurface(wp.xz, uTime).x;',
      '#else',
      // Subtle vertex ripple in world space (the plane is rotated flat, so displace world y).
      '  wp.y += 0.018 * (0.6 * sin(wp.x * 1.9 + uTime * 1.4) + 0.4 * sin(wp.z * 2.3 - uTime * 1.1));',
      '#endif',
      '  vWorld = wp.xyz;',
      '  vec4 mvPosition = viewMatrix * wp;',   // fog_vertex reads the view-space depth from mvPosition
      '  #include <fog_vertex>',
      '  gl_Position = projectionMatrix * mvPosition;',
      '}',
    ].join('\n');

    const OCEAN_FRAG = `
      uniform float uTime;
      uniform sampler2D uNormalMap;
      uniform vec3 uCameraPos;
      uniform vec3 uWaterLight;
      #if LAND_BOUNDS_COUNT > 0
      uniform vec4 uLandBounds[LAND_BOUNDS_COUNT];
      #endif
      #if LAND_ARC_COUNT > 0
      uniform vec4 uLandArcs[LAND_ARC_COUNT];
      uniform vec2 uLandArcAngles[LAND_ARC_COUNT];
      #endif
      varying vec3 vWorld;
      ${OCEAN_WAVES}
      void main() {
        #if LAND_BOUNDS_COUNT > 0
        for (int i = 0; i < LAND_BOUNDS_COUNT; i++) {
          vec4 bounds = uLandBounds[i];
          if (vWorld.x > bounds.x && vWorld.x < bounds.z && vWorld.z > bounds.y && vWorld.z < bounds.w) discard;
        }
        #endif
        #if LAND_ARC_COUNT > 0
        for (int i = 0; i < LAND_ARC_COUNT; i++) {
          vec4 arc = uLandArcs[i];
          vec2 delta = vWorld.xz - arc.xy;
          float radius = length(delta);
          if (radius >= arc.z && radius <= arc.w) {
            float angle = atan(delta.y, delta.x);
            if (angle >= uLandArcAngles[i].x && angle <= uLandArcAngles[i].y) discard;
          }
        }
        #endif
        float distanceToEye = length(uCameraPos.xz - vWorld.xz);
        vec3 waves = oceanSurface(vWorld.xz, uTime);
        vec2 drift = vec2(sin(vWorld.x * 0.12 + vWorld.z * 0.07), cos(vWorld.z * 0.1 - vWorld.x * 0.06)) * 0.35;
        vec3 t1 = texture2D(uNormalMap, vWorld.xz * 0.16 + drift + vec2(0.019, 0.011) * uTime).xyz * 2.0 - 1.0;
        mat2 crossWind = mat2(0.8, -0.6, 0.6, 0.8);
        vec3 t2 = texture2D(uNormalMap, crossWind * vWorld.xz * 0.31 - drift - vec2(0.013, 0.017) * uTime).xyz * 2.0 - 1.0;
        // Fine wind ripples fade with distance to keep the horizon from shimmering.
        float detail = 1.0 - smoothstep(35.0, 180.0, distanceToEye);
        vec2 slope = waves.yz + (t1.xy + crossWind * t2.xy * 0.65) * 0.1 * detail;
        vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
        vec3 v = normalize(uCameraPos - vWorld);
        float facing = max(dot(n, v), 0.0);
        float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
        vec3 reflected = reflect(-v, n);
        float skyHeight = max(0.0, reflected.y);
        vec3 horizon = vec3(0.87, 0.91, 0.86);
        vec3 sky = mix(horizon, vec3(0.29, 0.61, 0.76), smoothstep(0.0, 0.7, skyHeight));
        float cloudBands = sin(reflected.x * 13.0 + sin(reflected.z * 11.0)) * sin(reflected.z * 19.0 + reflected.x * 5.0);
        float clouds = smoothstep(0.24, 0.68, cloudBands) * smoothstep(0.03, 0.16, skyHeight) * (1.0-smoothstep(0.25, 0.5, skyHeight));
        sky = mix(sky, vec3(0.97, 0.97, 0.9), clouds * 0.65);
        // Deep water absorbs light; gentle crests pick up a little more turquoise.
        vec3 body = mix(vec3(0.016, 0.10, 0.145), vec3(0.035, 0.235, 0.255), facing);
        body += vec3(0.006, 0.024, 0.023) * smoothstep(-0.15, 0.35, waves.x);
        vec3 halfLight = normalize(normalize(vec3(0.3, 1.0, 0.2)) + v);
        float sun = pow(max(dot(n, halfLight), 0.0), 64.0) * 0.35
          + pow(max(dot(n, halfLight), 0.0), 240.0) * 0.8 * detail;
        vec3 color = mix(body * uWaterLight, sky, fresnel) + vec3(1.0, 0.91, 0.72) * sun;
        // Sea haze reaches a distant horizon, independently of the indoor architecture fog.
        color = mix(color, horizon, smoothstep(120.0, 850.0, distanceToEye));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `;

    const WATER_FRAG = [
      'uniform float uTime;',
      'uniform sampler2D uNormalMap;',
      'uniform vec3 uShallow;',
      'uniform vec3 uDeep;',
      'uniform float uDepth;',
      'uniform vec3 uCameraPos;',
      'uniform float uOpacity;',
      'uniform sampler2D uReflection;',
      'uniform mat4 uReflectionMatrix;',
      'uniform float uReflect;',
      'uniform vec4 uRipples[8];',
      'uniform float uRippleHeights[8];',
      'uniform float uRain;',
      '#ifdef RAIN',
      RAIN_PATTERN,
      '#endif',
      'uniform vec3 uWaterLight;',
      'varying vec3 vWorld;',
      '#include <fog_pars_fragment>',
      // Return the radial slope and crest of an expanding, fading ring.
      'vec2 ripple(vec2 delta, float age, float strength) {',
      '  float d = length(delta);',
      '  float front = d - age * 1.65;',
      '  float envelope = exp(-front * front * 3.0) * max(0.0, 1.0 - age / 3.2);',
      '  envelope *= step(0.0, age) * smoothstep(0.0, 0.15, age) * strength;',
      '  return vec2(cos(front * 13.0), sin(front * 13.0)) * envelope;',
      '}',
      'void main() {',
      // Two scrolling normal samples in world XZ; tangent z (blue) is the up axis of the flat surface.
      '  vec2 uv1 = vWorld.xz * 0.28 + vec2(0.021, 0.013) * uTime;',
      '  vec2 uv2 = vWorld.xz * 0.17 - vec2(0.015, 0.019) * uTime;',
      '  vec3 t1 = texture2D(uNormalMap, uv1).xyz * 2.0 - 1.0;',
      '  vec3 t2 = texture2D(uNormalMap, uv2).xyz * 2.0 - 1.0;',
      '  vec3 n = normalize(vec3(t1.x + t2.x, (t1.z + t2.z) * 3.0, t1.y + t2.y));',
      '  float crest = 0.0;',
      '  for (int i = 0; i < 8; i++) {',
      '    float age = uTime - uRipples[i].z;',
      '    if (age < 0.0 || age > 3.2 || uRipples[i].w <= 0.0) continue;',
      '    vec2 delta = vWorld.xz - uRipples[i].xy;',
      '    float sameSurface = 1.0 - smoothstep(0.06, 0.15, abs(vWorld.y - uRippleHeights[i]));',
      '    vec2 wave = ripple(delta, age, uRipples[i].w * sameSurface);',
      '    n.xz += delta / max(length(delta), 0.01) * wave.x * 0.22;',
      '    crest += max(0.0, wave.y) * 0.06;',
      '  }',
      '#ifdef RAIN',
      '  float rainDistance = 1000.0;',
      '  if (uRain > 0.5) for (int i=0;i<6;i++) rainDistance=min(rainDistance,abs(length(vWorld.xz-uRainSources[i])-2.55));',
      '  if (rainDistance < 1.4) {',
      '    vec2 cell = floor(vWorld.xz / 0.65);',
      '    for (int x=-1;x<=1;x++) for (int z=-1;z<=1;z++) {',
      '      vec3 impact = rainEvent(cell+vec2(float(x),float(z)),uTime);',
      '      float age = impact.z;',
      '      if (age < 0.0 || age > 0.8) continue;',
      '      vec2 delta = vWorld.xz-impact.xy;',
      '      float d = length(delta), front = d-age*1.15;',
      '      float strength = rainCoverage(impact.xy)*exp(-age*3.8)*smoothstep(0.0,0.035,age);',
      '      float ring = exp(-front*front*140.0);',
      '      float inner = d-age*0.75;',
      '      float wake = exp(-inner*inner*180.0)*0.35;',
      '      n.xz += delta/max(d,0.01)*(ring-wake)*strength*0.32;',
      '      crest += (ring*0.07+exp(-d*d*140.0-age*18.0)*0.15)*strength;',
      '    }',
      '  }',
      '#endif',
      '  n = normalize(n);',
      '  if (!gl_FrontFacing) n = -n;',
      '  vec3 v = normalize(uCameraPos - vWorld);',
      '  float cosT = clamp(dot(n, v), 0.0, 1.0);',
      // Schlick fresnel against a pale sky-like reflection colour.
      '  float f = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);',
      '  vec3 base = mix(uShallow, uDeep, clamp(uDepth / 3.5, 0.0, 1.0));',
      '  vec3 reflected = reflect(-v, n);',
      '  float horizon = smoothstep(-0.1, 0.8, reflected.y);',
      '  vec3 refl = mix(vec3(0.28, 0.48, 0.48), vec3(0.65, 0.81, 0.83), horizon) * uWaterLight;',
      '  if (uReflect > 0.5 && gl_FrontFacing) {',
      '    vec4 projected = uReflectionMatrix * vec4(vWorld, 1.0);',
      '    vec2 reflectionUV = projected.xy / projected.w + n.xz * 0.012;',
      '    refl = texture2D(uReflection, reflectionUV).rgb;',
      '  }',
      // Fixed-direction Blinn specular (matches the main directional light direction).
      '  vec3 l = normalize(vec3(0.3, 1.0, 0.2));',
      '  vec3 h = normalize(l + v);',
      '  float spec = pow(max(dot(n, h), 0.0), 120.0) * 0.55;',
      '  vec3 col = mix(base * uWaterLight, refl, f) + uWaterLight * (spec + crest);',
      '  float alpha = mix(0.32, 0.82, f) * uOpacity;',
      // Beneath the surface, the rippling normal bends the bright window overhead.
      '  if (!gl_FrontFacing) {',
      '    float window = smoothstep(0.57, 0.72, cosT);',
      '    float shimmer = sin(vWorld.x * 3.0 + n.x * 14.0 + uTime * 0.7) * sin(vWorld.z * 2.4 + n.z * 14.0);',
      '    col = mix(base * uWaterLight * 0.7, uWaterLight * vec3(0.65, 0.88, 0.86), window) + shimmer * 0.025;',
      '    alpha = mix(0.72, 0.18, window) * uOpacity;',
      '  }',
      '  gl_FragColor = vec4(col, alpha);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '  #include <fog_fragment>',   // after tone mapping + colour space, matching Three's built-in materials
      '}',
    ].join('\n');

    const SHALLOW_COLOR = new THREE.Color(0.14, 0.66, 0.63);
    const DEEP_COLOR = new THREE.Color(0.025, 0.34, 0.43);
    const waterMaterials = new Set();
    // A fixed-size wake buffer is shared by every pool: no meshes or textures per splash.
    const ripples = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -100, 0));
    const rippleHeights = new Float32Array(8);
    const waterLight = new THREE.Color(1, 1, 1);
    const waterWhite = new THREE.Color(1, 1, 1);
    let rippleIndex = 0, nextRipple = 0, wasInWater = false;
    let camera = null;

    /**
     * Creates a pool or open-ocean surface covering world rect [x0,x1]x[z0,z1] at height y.
     * @param {number} depth  water depth, drives the shallow/deep colour mix
     */
    function createWater(x0, z0, x1, z1, y, depth, { ocean = false, landBounds = [], landArcs = [] } = {}) {
      const w = x1 - x0;
      const d = z1 - z0;
      const geo = new THREE.PlaneGeometry(w, d, ocean ? 112 : util.clamp(Math.round(w), 1, 32), ocean ? 128 : util.clamp(Math.round(d), 1, 32));
      if (ocean) {
        // Spend vertices beside the terrace and pier; the distant sea needs much less detail.
        const position = geo.attributes.position;
        for (let i=0;i<position.count;i++) {
          const u = position.getX(i)/(w/2), v = position.getY(i)/(d/2);
          position.setXY(i, Math.sign(u)*Math.pow(Math.abs(u),1.7)*w/2, Math.sign(v)*Math.pow(Math.abs(v),1.7)*d/2);
        }
      }
      // merge() returns fresh clones, so every pool owns its fog uniforms (the renderer writes into them).
      const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 },
        uDepth: { value: depth },
        uCameraPos: { value: new THREE.Vector3() },
        uOpacity: { value: 1 },
        uReflection: { value: null },
        uReflectionMatrix: { value: new THREE.Matrix4() },
        uReflect: { value: 0 },
        uRain: { value: 0 },
      }]);
      // Assigned after the merge so the texture and colours stay shared instead of being cloned per pool.
      uniforms.uNormalMap = { value: textures.waterNormal };
      uniforms.uShallow = { value: SHALLOW_COLOR };
      uniforms.uDeep = { value: DEEP_COLOR };
      uniforms.uRipples = { value: ripples };
      uniforms.uRippleHeights = { value: rippleHeights };
      uniforms.uRainSources = { value: Array.from({length:6},()=>new THREE.Vector2()) };
      uniforms.uWaterLight = { value: waterLight };
      if (ocean) {
        uniforms.uLandBounds = { value: landBounds.map(bounds=>new THREE.Vector4(...bounds)) };
        uniforms.uLandArcs = { value: landArcs.map(arc=>new THREE.Vector4(...arc.center,...arc.radii)) };
        uniforms.uLandArcAngles = { value: landArcs.map(arc=>new THREE.Vector2(...arc.angles)) };
      }
      const mat = new THREE.ShaderMaterial({
        uniforms,
        defines: ocean ? { OCEAN: 1, LAND_BOUNDS_COUNT: landBounds.length, LAND_ARC_COUNT: landArcs.length } : {},
        vertexShader: WATER_VERT,
        fragmentShader: ocean ? OCEAN_FRAG : WATER_FRAG,
        transparent: !ocean,
        depthWrite: ocean,
        side: THREE.DoubleSide,
        fog: true,
      });
      if (camera) mat.uniforms.uCameraPos.value.copy(camera.position);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      mesh.renderOrder = ocean ? 0 : 10;
      mesh.name = 'water';
      waterMaterials.add(mat);
      return mesh;
    }

    // ------------------------------------------------------------------------------------------
    // Drains and instanced props
    // ------------------------------------------------------------------------------------------

    /**
     * Drain visual: dark ring + additive glow disc, flat on the pool floor at (x, y, z). Its light comes
     * from the shared pool (see setTime); `pulse` holds the current pulse value for the light assignment.
     * @returns {{ x:number, y:number, z:number, node:THREE.Group, disc:THREE.Mesh, phase:number, pulse:number }}
     */
    function createDrain(x, y, z, phase) {
      const node = new THREE.Group();
      node.name = 'drain';
      const ringMesh = new THREE.Mesh(drainRingGeo, drainRingMat);
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.position.set(x, y + 0.04, z);
      const disc = new THREE.Mesh(drainDiscGeo, drainGlowMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(x, y + 0.02, z);
      disc.renderOrder = 11;
      node.add(ringMesh, disc);
      return { x, y, z, node, disc, phase, pulse: 0 };
    }

    /**
     * Builds an InstancedMesh from a list of transforms ({x,y,z,sx,sy,sz,quat?}); null when empty.
     * @param {boolean} colored  when true an instanceColor attribute (all white) is created for flicker updates
     */
    function createInstanced(geo, mat, items, colored) {
      if (!items.length) return null;
      const mesh = new THREE.InstancedMesh(geo, mat, items.length);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        tmpPos.set(it.x, it.y, it.z);
        tmpScale.set(it.sx, it.sy, it.sz);
        tmpMatrix.compose(tmpPos, it.quat || identityQuat, tmpScale);
        mesh.setMatrixAt(i, tmpMatrix);
        if (colored) mesh.setColorAt(i, panelWhite);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere(); // instances never move, so a one-off bound is enough for culling
      return mesh;
    }

    // ------------------------------------------------------------------------------------------
    // 7.2 Layout: per-chunk build context and shared room pieces
    // ------------------------------------------------------------------------------------------

    /**
     * Build context for one chunk: cell grid, geometry builder, collision AABBs and prop lists.
     * Local coordinates are relative to (ox, oz) = (cx*CHUNK, cz*CHUNK).
     */
    function createContext(info) {
      return {
        info,
        ox: info.cx * CHUNK,
        oz: info.cz * CHUNK,
        baseY: info.baseY,
        ceilY: info.ceilY,
        grid: createGrid(info.baseY, info.ceilY),
        b: createBuilder(),
        walls: [],
        drains: [],
        panels: [],
        pillars: [],
        posts: [],
        waters: [],
        blockers: [],   // local XZ rects of tall obstacles (used to keep ceiling panels clear)
        rng: util.rng(seed, info.cx, info.cz, 0xb1),
      };
    }

    /** Records a world-space AABB obstacle from local XZ bounds. */
    function addAABB(ctx, lx0, y0, lz0, lx1, y1, lz1) {
      ctx.walls.push({ x0: ctx.ox + lx0, y0, z0: ctx.oz + lz0, x1: ctx.ox + lx1, y1, z1: ctx.oz + lz1 });
    }

    /** Solid wall box: geometry (selected faces) plus a matching collision AABB. */
    function wallBox(ctx, lx0, y0, lz0, lx1, y1, lz1, faces) {
      ctx.b.addBox(ctx.ox + lx0, y0, ctx.oz + lz0, ctx.ox + lx1, y1, ctx.oz + lz1, 'wall', faces);
      addAABB(ctx, lx0, y0, lz0, lx1, y1, lz1);
    }

    /** Effective doorway width on this chunk's side (corridors narrow every door to their arm width). */
    function doorWidth(info, door) {
      return info.type === 'corridor' ? Math.min(door.width, 4) : door.width;
    }

    /**
     * Maps a band rectangle expressed as distance-from-edge d in [d0,d1] and position-along-edge
     * s in [s0,s1] to a local XZ rect for the given edge direction.
     */
    function bandRect(dir, d0, s0, d1, s1) {
      if (dir === 'n') return { x0: s0, z0: d0, x1: s1, z1: d1 };
      if (dir === 's') return { x0: s0, z0: CHUNK - d1, x1: s1, z1: CHUNK - d0 };
      if (dir === 'w') return { x0: d0, z0: s0, x1: d1, z1: s1 };
      return { x0: CHUNK - d1, z0: s0, x1: CHUNK - d0, z1: s1 };
    }

    /** Local XZ point for band coordinates (d, s). */
    function bandPoint(dir, d, s) {
      if (dir === 'n') return { x: s, z: d };
      if (dir === 's') return { x: s, z: CHUNK - d };
      if (dir === 'w') return { x: d, z: s };
      return { x: CHUNK - d, z: s };
    }

    const EDGE_FACES = { px: true, nx: true, py: false, ny: false, pz: true, nz: true };
    const LINTEL_FACES = { px: true, nx: true, py: false, ny: true, pz: true, nz: true };
    const PROP_FACES = { px: true, nx: true, py: true, ny: false, pz: true, nz: true };

    /**
     * This chunk's half-thickness walls on all four edges, split around open doorways with a lintel above.
     * The wall bottom drops to the doorway floor on open stair edges so nothing shows under a descending
     * stair; closed edges keep a flat band at baseY, so their wall starts there.
     */
    function buildEdgeWalls(ctx) {
      const info = ctx.info;
      for (let k = 0; k < DIR_KEYS.length; k++) {
        const dir = DIR_KEYS[k];
        const door = info.doors[dir];
        const offset = DIRS[dir];
        if (inLandmark(info.cx, info.cz) && inLandmark(info.cx + offset.dx, info.cz + offset.dz)) continue;
        const bottom = (door.open ? Math.min(ctx.baseY, door.y) : ctx.baseY) - 0.1;
        const top = ctx.ceilY;
        const segments = [];
        if (door.open) {
          const w = doorWidth(info, door);
          segments.push([0, HALF - w / 2, bottom, top, EDGE_FACES]);
          segments.push([HALF + w / 2, CHUNK, bottom, top, EDGE_FACES]);
          const lintelY = door.y + door.height;
          if (top - lintelY > 0.02) segments.push([HALF - w / 2, HALF + w / 2, lintelY, top, LINTEL_FACES]);
        } else {
          segments.push([0, CHUNK, bottom, top, EDGE_FACES]);
        }
        for (let s = 0; s < segments.length; s++) {
          const seg = segments[s];
          const r = bandRect(dir, 0, seg[0], WALL_T, seg[1]);
          wallBox(ctx, r.x0, seg[2], r.z0, r.x1, seg[3], r.z1, seg[4]);
        }
      }
    }

    /**
     * Staircase across the margin band of one edge (stairwell chunks only): runs from baseY at the inner
     * end (d = MARGIN) to door.y at the edge (d = 0), 8 wide and centred on the doorway, risers <= 0.3,
     * treads >= 0.5, hand rails on both sides. When the stair descends toward the edge the band beside it
     * is higher, so a railing along the top of that drop is added as well.
     */
    function buildStair(ctx, dir, door) {
      const g = ctx.grid;
      const baseY = ctx.baseY;
      const rise = door.y - baseY;
      const n = Math.max(1, Math.ceil(Math.abs(rise) / MAX_RISER - 1e-9));
      const riser = rise / n;
      const tread = MARGIN / n;
      const s0 = HALF - STAIR_W / 2;
      const s1 = HALF + STAIR_W / 2;
      for (let k = 1; k <= n; k++) {
        const r = bandRect(dir, MARGIN - k * tread, s0, MARGIN - (k - 1) * tread, s1);
        fillRect(g.floorY, r.x0, r.z0, r.x1, r.z1, baseY + k * riser, g.mat, M_FLOOR);
      }
      const descending = rise < 0;
      const yLo = Math.min(baseY, door.y);
      const yHi = Math.max(baseY, door.y);
      /** Tread height at band distance d (the surface the rail follows). */
      const treadAt = (d) => {
        const k = util.clamp(Math.ceil((MARGIN - d) / tread - 1e-9), 1, n);
        return baseY + k * riser;
      };
      const sides = [s0 + 0.05, s1 - 0.05];
      for (let i = 0; i < 2; i++) {
        const s = sides[i];
        // Sloped hand rail along the stair (posts only when the stair is the high side).
        const pIn = bandPoint(dir, MARGIN - 0.02, s);
        const pOut = bandPoint(dir, WALL_T + 0.02, s);
        ctx.b.addBar(ctx.ox + pIn.x, baseY + riser + RAIL_H, ctx.oz + pIn.z,
          ctx.ox + pOut.x, door.y + RAIL_H, ctx.oz + pOut.z, 0.06, 'wall');
        const railY = (d) => util.lerp(door.y + RAIL_H, baseY + riser + RAIL_H, (d - WALL_T) / (MARGIN - WALL_T));
        if (!descending) {
          for (let d = MARGIN - 0.2; d > WALL_T + 0.1; d -= 1.2) {
            const p = bandPoint(dir, d, s);
            const foot = treadAt(d);
            const h = railY(d) - foot;
            ctx.posts.push({ x: ctx.ox + p.x, y: foot + h / 2, z: ctx.oz + p.z, sx: 0.08, sy: h, sz: 0.08 });
          }
        } else {
          // Railing on the band at the top of the drop, one step outside the stair.
          const sb = i === 0 ? s0 - 0.08 : s1 + 0.08;
          const q0 = bandPoint(dir, MARGIN, sb);
          const q1 = bandPoint(dir, WALL_T, sb);
          ctx.b.addBar(ctx.ox + q0.x, baseY + RAIL_H, ctx.oz + q0.z, ctx.ox + q1.x, baseY + RAIL_H, ctx.oz + q1.z, 0.06, 'wall');
          for (let d = MARGIN - 0.2; d > WALL_T + 0.1; d -= 1.2) {
            const p = bandPoint(dir, d, sb);
            ctx.posts.push({ x: ctx.ox + p.x, y: baseY + RAIL_H / 2, z: ctx.oz + p.z, sx: 0.08, sy: RAIL_H, sz: 0.08 });
          }
        }
        // One thin, tall AABB per side blocks both crossing the rail and falling off the stair. It reaches
        // well above the visible rail so a jump from higher up the stair cannot land on top of it.
        const sa = i === 0 ? s0 - 0.12 : s1 - 0.12;
        const ra = bandRect(dir, WALL_T, sa, MARGIN, sa + 0.24);
        addAABB(ctx, ra.x0, yLo - 0.2, ra.z0, ra.x1, yHi + RAIL_BLOCK_H, ra.z1);
      }
    }

    /**
     * Stairwell: flat hall whose margin bands carry a staircase toward every OPEN door with a different
     * height. A closed edge on another level keeps its band flat at baseY behind the full edge wall.
     */
    function buildStairwell(ctx) {
      const doors = ctx.info.doors;
      for (let k = 0; k < DIR_KEYS.length; k++) {
        const dir = DIR_KEYS[k];
        const door = doors[dir];
        if (door.open && Math.abs(door.y - ctx.baseY) > 1e-6) buildStair(ctx, dir, door);
      }
    }

    /** Local rect intersection test. */
    function rectsOverlap(a, b) {
      return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
    }

    /**
     * Dry hall: 2-5 benches (0.5 high) or square pillars (0.6 wide) in the corners of the inner area,
     * always clear of the door axis lines (local 10..14 plus a 1.5 margin) so paths stay open.
     */
    function buildDry(ctx) {
      const r = ctx.rng;
      const count = 2 + Math.floor(r() * 4);
      const placed = [];
      for (let k = 0; k < count; k++) {
        const pillar = r() < 0.35;
        const along = r() < 0.5;
        const w = pillar ? 0.6 : (along ? 2.2 : 0.9);
        const d = pillar ? 0.6 : (along ? 0.9 : 2.2);
        let rect = null;
        for (let attempt = 0; attempt < 8 && !rect; attempt++) {
          // Corner regions: local 5..8.5 or 15.5..19 on each axis (1.5 clear of the 10..14 axis lines).
          const xLow = r() < 0.5;
          const zLow = r() < 0.5;
          const x0 = (xLow ? MARGIN : CHUNK - MARGIN - 3.5) + r() * (3.5 - w);
          const z0 = (zLow ? MARGIN : CHUNK - MARGIN - 3.5) + r() * (3.5 - d);
          const cand = { x0, z0, x1: x0 + w, z1: z0 + d };
          let free = true;
          for (let p = 0; p < placed.length; p++) {
            if (rectsOverlap(cand, { x0: placed[p].x0 - 0.6, z0: placed[p].z0 - 0.6, x1: placed[p].x1 + 0.6, z1: placed[p].z1 + 0.6 })) {
              free = false;
              break;
            }
          }
          if (free) rect = cand;
        }
        if (!rect) continue;
        placed.push(rect);
        const top = pillar ? ctx.ceilY : ctx.baseY + 0.5;
        wallBox(ctx, rect.x0, ctx.baseY, rect.z0, rect.x1, top, rect.z1, pillar ? EDGE_FACES : PROP_FACES);
        if (pillar) ctx.blockers.push(rect);
      }
    }

    /**
     * Rectangular pool basin: sunken floor with pool tiles, a 0.5 rim strip, entry steps on one side and
     * one water plane. Basins never add wall AABBs; the floor-height difference is what contains the
     * player, and the step rule lets them climb out.
     * @param {number} side  0 = north (low z), 1 = east, 2 = south, 3 = west: where the steps are
     */
    function addPool(ctx, lx0, lz0, lx1, lz1, depth, side, nSteps) {
      const g = ctx.grid;
      const baseY = ctx.baseY;
      // Rim first (pool tiles at floor level), then the basin overwrites the inside.
      fillRect(g.floorY, lx0 - 0.5, lz0 - 0.5, lx1 + 0.5, lz1 + 0.5, baseY, g.mat, M_POOL);
      fillRect(g.floorY, lx0, lz0, lx1, lz1, baseY - depth, g.mat, M_POOL);
      fillRect(g.waterY, lx0, lz0, lx1, lz1, baseY - WATER_DROP);
      // Shallow basins get evenly spaced steps all the way down; deep ones three 0.25 steps then a drop.
      const stepH = depth <= 1.0 ? depth / (nSteps + 1) : 0.25;
      const cx = (lx0 + lx1) / 2;
      const cz = (lz0 + lz1) / 2;
      for (let k = 1; k <= nSteps; k++) {
        const y = baseY - k * stepH;
        const a = (k - 1) * CELL;
        const bnd = k * CELL;
        if (side === 0) fillRect(g.floorY, cx - 2, lz0 + a, cx + 2, lz0 + bnd, y);
        else if (side === 2) fillRect(g.floorY, cx - 2, lz1 - bnd, cx + 2, lz1 - a, y);
        else if (side === 3) fillRect(g.floorY, lx0 + a, cz - 2, lx0 + bnd, cz + 2, y);
        else fillRect(g.floorY, lx1 - bnd, cz - 2, lx1 - a, cz + 2, y);
      }
      ctx.waters.push(createWater(ctx.ox + lx0, ctx.oz + lz0, ctx.ox + lx1, ctx.oz + lz1, baseY - WATER_DROP, depth));
    }

    /** Shallow pool hall: 1.0 deep basin with slightly randomised extents inside the inner area. */
    function buildShallow(ctx) {
      const r = ctx.rng;
      const trim = () => Math.floor(r() * 3) * 0.5;
      const x0 = 5 + trim(), x1 = 19 - trim();
      const z0 = 6 + trim(), z1 = 18 - trim();
      addPool(ctx, x0, z0, x1, z1, 1.0, Math.floor(r() * 4), 3);
    }

    /** Deep pool with a tiled island in the centre and, sometimes, a glowing drain in one corner of the floor. */
    function buildDeep(ctx) {
      const r = ctx.rng;
      const depth = 3.2;
      addPool(ctx, 5, 5, 19, 19, depth, Math.floor(r() * 4), 3);
      const g = ctx.grid;
      // Island: floor tiles at baseY, no water over it; its sides pick up the pool material from the basin.
      fillRect(g.floorY, 10, 10, 14, 14, ctx.baseY, g.mat, M_FLOOR);
      fillRect(g.waterY, 10, 10, 14, 14, NaN);

    }

    /** Atrium: 9-high ceiling, eight instanced pillars on a 3x3 grid and a central 0.8-deep pool. */
    function buildAtrium(ctx) {
      addPool(ctx, 9, 9, 15, 15, 0.8, Math.floor(ctx.rng() * 4), 2);
      const spots = [6, 12, 18];
      const h = ctx.ceilY - ctx.baseY;
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          if (a === 1 && b === 1) continue;
          const px = spots[a], pz = spots[b];
          ctx.pillars.push({ x: ctx.ox + px, y: ctx.baseY + h / 2, z: ctx.oz + pz, sx: 1, sy: h, sz: 1 });
          addAABB(ctx, px - 0.55, ctx.baseY, pz - 0.55, px + 0.55, ctx.ceilY, pz + 0.55);
          ctx.blockers.push({ x0: px - 0.55, z0: pz - 0.55, x1: px + 0.55, z1: pz + 0.55 });
        }
      }
    }

    /**
     * Corridor: everything is solid except a 4x4 centre square and 4-wide arms to each open door; a
     * 1-wide, 0.4-deep water channel runs along every arm. Arm side walls are boxes; the outside is void.
     */
    function buildCorridor(ctx) {
      const g = ctx.grid;
      const baseY = ctx.baseY;
      const doors = ctx.info.doors;
      const a0 = HALF - 2, a1 = HALF + 2;         // arm extent across (10..14)
      const c0 = HALF - 0.5, c1 = HALF + 0.5;     // channel extent across (11.5..12.5)
      const chY = baseY - 0.4;
      const chW = baseY - 0.08;
      fillRect(g.floorY, 0, 0, CHUNK, CHUNK, SOLID);
      fillRect(g.floorY, a0, a0, a1, a1, baseY, g.mat, M_FLOOR);
      const openDir = (dir) => doors[dir].open;
      if (openDir('n')) fillRect(g.floorY, a0, 0, a1, a0, baseY, g.mat, M_FLOOR);
      if (openDir('s')) fillRect(g.floorY, a0, a1, a1, CHUNK, baseY, g.mat, M_FLOOR);
      fillRect(g.floorY, 0, a0, a0, a1, baseY, g.mat, M_FLOOR);       // west arm (x-edges are always open)
      fillRect(g.floorY, a1, a0, CHUNK, a1, baseY, g.mat, M_FLOOR);   // east arm
      // Channel: full east-west run plus north/south stubs that stop at the centre strip (no overlap).
      fillRect(g.floorY, 0.5, c0, CHUNK - 0.5, c1, chY, g.mat, M_POOL);
      fillRect(g.waterY, 0.5, c0, CHUNK - 0.5, c1, chW);
      ctx.waters.push(createWater(ctx.ox + 0.5, ctx.oz + c0, ctx.ox + CHUNK - 0.5, ctx.oz + c1, chW, 0.32));
      if (openDir('n')) {
        fillRect(g.floorY, c0, 0.5, c1, c0, chY, g.mat, M_POOL);
        fillRect(g.waterY, c0, 0.5, c1, c0, chW);
        ctx.waters.push(createWater(ctx.ox + c0, ctx.oz + 0.5, ctx.ox + c1, ctx.oz + c0, chW, 0.32));
      }
      if (openDir('s')) {
        fillRect(g.floorY, c0, c1, c1, CHUNK - 0.5, chY, g.mat, M_POOL);
        fillRect(g.waterY, c0, c1, c1, CHUNK - 0.5, chW);
        ctx.waters.push(createWater(ctx.ox + c0, ctx.oz + c1, ctx.ox + c1, ctx.oz + CHUNK - 0.5, chW, 0.32));
      }
      // Side walls of each arm (from the edge wall to the centre square) or a closing wall of the square.
      const wb = baseY - 0.1;
      const top = ctx.ceilY;
      const t = WALL_T;
      if (openDir('n')) {
        wallBox(ctx, a0 - t, wb, t, a0, top, a0, EDGE_FACES);
        wallBox(ctx, a1, wb, t, a1 + t, top, a0, EDGE_FACES);
      } else {
        wallBox(ctx, a0 - t, wb, a0 - t, a1 + t, top, a0, EDGE_FACES);
      }
      if (openDir('s')) {
        wallBox(ctx, a0 - t, wb, a1, a0, top, CHUNK - t, EDGE_FACES);
        wallBox(ctx, a1, wb, a1, a1 + t, top, CHUNK - t, EDGE_FACES);
      } else {
        wallBox(ctx, a0 - t, wb, a1, a1 + t, top, a1 + t, EDGE_FACES);
      }
      wallBox(ctx, t, wb, a0 - t, a0, top, a0, EDGE_FACES);            // west arm, north side
      wallBox(ctx, t, wb, a1, a0, top, a1 + t, EDGE_FACES);            // west arm, south side
      wallBox(ctx, a1, wb, a0 - t, CHUNK - t, top, a0, EDGE_FACES);    // east arm, north side
      wallBox(ctx, a1, wb, a1, CHUNK - t, top, a1 + t, EDGE_FACES);    // east arm, south side
    }

    /** Adds a downward-facing ceiling panel of the given size at local (lx, lz), unless a pillar is there. */
    function addPanel(ctx, lx, lz, size) {
      const rect = { x0: lx - size / 2, z0: lz - size / 2, x1: lx + size / 2, z1: lz + size / 2 };
      for (let k = 0; k < ctx.blockers.length; k++) {
        if (rectsOverlap(rect, ctx.blockers[k])) return;
      }
      ctx.panels.push({ x: ctx.ox + lx, y: ctx.ceilY - PANEL_DROP, z: ctx.oz + lz, sx: size, sy: size, sz: 1, quat: panelQuat });
    }

    /** Ceiling panel layout per room type (§7.2). */
    function buildPanels(ctx) {
      const type = ctx.info.type;
      if (type === 'corridor') {
        const doors = ctx.info.doors;
        addPanel(ctx, HALF, HALF, 1.6);
        for (let p = 2; p < HALF - 1; p += 3) {
          if (doors.n.open) addPanel(ctx, HALF, p, 1.6);
          if (doors.s.open) addPanel(ctx, HALF, CHUNK - p, 1.6);
          addPanel(ctx, p, HALF, 1.6);
          addPanel(ctx, CHUNK - p, HALF, 1.6);
        }
      } else if (type === 'atrium') {
        const spots = [4, HALF, CHUNK - 4];
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) addPanel(ctx, spots[a], spots[b], 2.4);
      } else {
        // 2x2 panels per 8 units: a 6x6 grid with 4-unit spacing.
        for (let a = 2; a < CHUNK; a += 4) for (let b = 2; b < CHUNK; b += 4) addPanel(ctx, a, b, 1.6);
      }
    }

    // ------------------------------------------------------------------------------------------
    // Chunk generation and disposal
    // ------------------------------------------------------------------------------------------

    function buildPavilion(ctx) {
      for (let j = 0; j < CELLS; j++) {
        for (let i = 0; i < CELLS; i++) {
          const x = ctx.ox + (i + 0.5) * CELL, z = ctx.oz + (j + 0.5) * CELL;
          const terrain = landmarkTerrain(x, z), idx = j * CELLS + i;
          ctx.grid.floorY[idx] = terrain.floor;
          ctx.grid.waterY[idx] = terrain.water ?? NaN;
          ctx.grid.mat[idx] = terrain.pool ? M_POOL : M_FLOOR;
        }
      }
    }

    const ROOM_BUILDERS = {
      pavilion: buildPavilion,
      dry: buildDry,
      shallow: buildShallow,
      deep: buildDeep,
      corridor: buildCorridor,
      atrium: buildAtrium,
      stairwell: buildStairwell,
    };

    /**
     * Generates one chunk: room contents, edge walls, panels, then floor/ceiling meshes from the cell
     * grid, one Mesh per material key, instanced props, water planes and drains, all in world space.
     */
    function generateChunk(cx, cz) {
      const info = chunkInfo(cx, cz);
      const ctx = createContext(info);
      ROOM_BUILDERS[info.type](ctx);
      buildEdgeWalls(ctx);
      if (info.type !== 'pavilion') buildPanels(ctx);

      const grid = ctx.grid;
      const visibleFloor = info.type === 'pavilion' ? new Float32Array(grid.floorY) : grid.floorY;
      if (info.type === 'pavilion') {
        for (let i = 0; i < visibleFloor.length; i++) if (grid.mat[i] === M_POOL) visibleFloor[i] = SOLID;
      }
      meshHeightfield(ctx.b, visibleFloor, grid.mat, ctx.ox, ctx.oz, true);
      if (info.type === 'pavilion') {
        for (let k = 0; k < CELLS; k++) {
          if (inLandmark(info.cx + 1, info.cz)) {
            const x = ctx.ox + CHUNK, z = ctx.oz + k * CELL;
            const a = grid.floorY[k * CELLS + CELLS - 1], b = landmarkTerrain(x + CELL / 2, z + CELL / 2).floor;
            if (a >= 0 && b >= 0 && Math.abs(a - b) > 1e-5) ctx.b.addQuadX(x, z, z + CELL, Math.min(a, b), Math.max(a, b), 'pool', a > b);
          }
          if (inLandmark(info.cx, info.cz + 1)) {
            const x = ctx.ox + k * CELL, z = ctx.oz + CHUNK;
            const a = grid.floorY[(CELLS - 1) * CELLS + k], b = landmarkTerrain(x + CELL / 2, z + CELL / 2).floor;
            if (a >= 0 && b >= 0 && Math.abs(a - b) > 1e-5) ctx.b.addQuadZ(z, x, x + CELL, Math.min(a, b), Math.max(a, b), 'pool', a > b);
          }
        }
      }
      // The ceiling only exists over reachable cells (corridors are solid outside their arms).
      const ceilHeights = new Float32Array(grid.ceilY);
      for (let i = 0; i < ceilHeights.length; i++) {
        if (grid.floorY[i] >= SOLID / 2) ceilHeights[i] = SOLID;
        if (info.type === 'pavilion') {
          const x = ctx.ox + ((i % CELLS) + 0.5) * CELL;
          const z = ctx.oz + (Math.floor(i / CELLS) + 0.5) * CELL;
          if (PAVILION.skylights.some(([sx, sz, radius]) => Math.hypot(x-sx, z-sz) < radius)) ceilHeights[i] = SOLID;
        }
      }
      meshHeightfield(ctx.b, ceilHeights, null, ctx.ox, ctx.oz, false);

      const chunkGroup = new THREE.Group();
      chunkGroup.name = 'chunk ' + cx + ',' + cz;
      chunkGroup.userData.cx = cx;
      chunkGroup.userData.cz = cz;
      const owned = [];      // geometries owned by this chunk
      const instanced = [];  // InstancedMeshes (their instance attributes are freed on dispose)

      const geos = ctx.b.build();
      for (let k = 0; k < MAT_KEYS.length; k++) {
        const key = MAT_KEYS[k];
        if (!geos[key]) continue;
        const mesh = new THREE.Mesh(geos[key], materials[key]);
        mesh.name = key;
        chunkGroup.add(mesh);
        owned.push(geos[key]);
      }
      const panels = createInstanced(panelGeo, panelMat, ctx.panels, true);
      const pillars = createInstanced(pillarGeo, materials.wall, ctx.pillars, false);
      const posts = createInstanced(postGeo, materials.wall, ctx.posts, false);
      const props = [panels, pillars, posts];
      for (let k = 0; k < props.length; k++) {
        if (!props[k]) continue;
        chunkGroup.add(props[k]);
        instanced.push(props[k]);
      }
      for (let k = 0; k < ctx.waters.length; k++) {
        chunkGroup.add(ctx.waters[k]);
        owned.push(ctx.waters[k].geometry);
      }
      const drainList = [];
      for (let k = 0; k < ctx.drains.length; k++) {
        chunkGroup.add(ctx.drains[k].node);
        drainList.push({ x: ctx.drains[k].x, y: ctx.drains[k].y, z: ctx.drains[k].z });
      }
      group.add(chunkGroup);

      return {
        cx, cz, info,
        key: keyOf(cx, cz),
        group: chunkGroup,
        floorY: grid.floorY,
        ceilY: grid.ceilY,
        waterY: grid.waterY,
        walls: ctx.walls,
        drains: drainList,
        drainObjs: ctx.drains,
        waters: ctx.waters,
        panels,
        owned,
        instanced,
        flicker: { index: -1, until: 0 },
      };
    }

    /** Frees everything a chunk owns (shared materials/geometries are left alone) and detaches its group. */
    function disposeChunk(chunk) {
      for (let k = 0; k < chunk.owned.length; k++) chunk.owned[k].dispose();
      for (let k = 0; k < chunk.instanced.length; k++) chunk.instanced[k].dispose();
      for (let k = 0; k < chunk.waters.length; k++) {
        const mat = chunk.waters[k].material;
        waterMaterials.delete(mat);
        mat.dispose();
      }
      group.remove(chunk.group);
      chunk.group.clear();
      if (lastChunk === chunk) lastChunk = null;
    }

    // ------------------------------------------------------------------------------------------
    // Chunk ring lifecycle and queries (public API)
    // ------------------------------------------------------------------------------------------

    const landmark = createLandmark({ group, textures, createWater, poolMaterial: materials.pool, ring });
    const journey = createJourney({ group, textures, createWater, poolMaterial: materials.pool });
    const soundscape = createSoundscape({ pools: [...landmark.pools, ...journey.pools], rain: journey.rainSources, walls: [...landmark.walls, ...journey.walls], pier: journey.pier, river: journey.river });
    const interactions = [...landmark.interactions, ...journey.interactions];
    const chunks = new Map();
    let chunkVersion = 0;            // bumped whenever the loaded set changes (invalidates wallsNear cache)
    const wallsCache = { key: null, version: -1, list: [] };
    const flickerRng = util.mulberry32((seed ^ 0x5f1c) >>> 0);
    let lastTime = null;
    let lastChunk = null;          // one-entry chunkAt() cache: collision queries rarely change chunk between calls

    /** @returns {{ cx:number, cz:number }} chunk containing world (x, z) */
    function chunkCoords(x, z) {
      return { cx: Math.floor(x / CHUNK), cz: Math.floor(z / CHUNK) };
    }

    /** Synchronously generates a chunk when missing; returns it. */
    function ensureChunk(cx, cz) {
      const key = keyOf(cx, cz);
      let chunk = chunks.get(key);
      if (!chunk) {
        chunk = generateChunk(cx, cz);
        chunks.set(key, chunk);
        chunkVersion++;
      }
      return chunk;
    }

    /** Keep the designed Pavilion available and cull distant journey sections. */
    function update(x) {
      const nearPavilion = x < 190;
      landmark.root.visible = nearPavilion;
      for (let dz = PAVILION.z0 / CHUNK; dz < PAVILION.z1 / CHUNK; dz++) for (let dx = PAVILION.x0 / CHUNK; dx < PAVILION.x1 / CHUNK; dx++) {
        const chunk = ensureChunk(dx, dz);
        chunk.group.visible = nearPavilion;
      }
      journey.update(x);
    }

    /** Retains the existing quality API for Pavilion reflections. */
    function setRing(r) {
      ring = Math.max(1, r | 0);
      landmark.setQuality(ring);
      const seen = new Set();
      group.traverse(object => {
        if (!object.material) return;
        for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!seen.has(mat)) { seen.add(mat); setSurfaceQuality(mat, ring > 1); }
        }
      });
    }

    /** Cell index of world (x, z) inside its chunk, clamped against floating-point edge cases. */
    function cellIndex(chunk, x, z) {
      const i = util.clamp(Math.floor((x - chunk.cx * CHUNK) / CELL), 0, CELLS - 1);
      const j = util.clamp(Math.floor((z - chunk.cz * CHUNK) / CELL), 0, CELLS - 1);
      return j * CELLS + i;
    }

    /**
     * Loaded chunk containing world (x, z), generated on demand. The last result is reused (after checking
     * it is still the live entry in the map) so the hot collision path allocates no key strings.
     */
    function chunkAt(x, z) {
      const cx = Math.floor(x / CHUNK);
      const cz = Math.floor(z / CHUNK);
      if (lastChunk && lastChunk.cx === cx && lastChunk.cz === cz && chunks.get(lastChunk.key) === lastChunk) return lastChunk;
      lastChunk = ensureChunk(cx, cz);
      return lastChunk;
    }

    /** Walkable floor height at (x, z); generates the chunk if needed. */
    function floorAt(x, z) {
      if (x >= 48) return journey.terrain(x, z).floor;
      if (!inLandmark(Math.floor(x / CHUNK), Math.floor(z / CHUNK))) return 0;
      const chunk = chunkAt(x, z);
      return chunk.floorY[cellIndex(chunk, x, z)];
    }

    /** Ceiling height at (x, z). */
    function ceilingAt(x, z) {
      if (x >= 48) return journey.roomAt(x, z)?.h ?? 80;
      if (!inLandmark(Math.floor(x / CHUNK), Math.floor(z / CHUNK))) return 16;
      const chunk = chunkAt(x, z);
      return chunk.ceilY[cellIndex(chunk, x, z)];
    }

    /** Water surface height at (x, z), or NaN when there is no water. */
    function waterAt(x, z) {
      if (x >= 48) return journey.terrain(x, z).water;
      if (!inLandmark(Math.floor(x / CHUNK), Math.floor(z / CHUNK))) return NaN;
      const chunk = chunkAt(x, z);
      return chunk.waterY[cellIndex(chunk, x, z)];
    }

    /**
     * Obstacle AABBs of the 3x3 chunks around (x, z). Only the centre chunk is generated on demand; the
     * neighbours are included once update()'s budgeted loading has produced them (the version check
     * rebuilds the list on that frame). The array is cached per centre chunk and rebuilt only when the
     * loaded chunk set changes, so callers may hold it for a frame but must not mutate it.
     */
    function wallsNear(x, z) {
      if (x >= 48) return journey.walls;
      const cx = Math.floor(x / CHUNK);
      const cz = Math.floor(z / CHUNK);
      const key = keyOf(cx, cz);
      if (wallsCache.key === key && wallsCache.version === chunkVersion) return wallsCache.list;
      ensureChunk(cx, cz);
      const list = journey.walls.concat(landmark.walls);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const chunk = chunks.get(keyOf(cx + dx, cz + dz));
          if (!chunk) continue;
          const walls = chunk.walls;
          for (let k = 0; k < walls.length; k++) list.push(walls[k]);
        }
      }
      wallsCache.key = key;
      wallsCache.version = chunkVersion; // after ensureChunk so a freshly generated centre counts
      wallsCache.list = list;
      return list;
    }

    /** Nearest drain among loaded chunks (XZ distance), or null. */
    function nearestDrain(x, z) {
      let best = null;
      for (const chunk of chunks.values()) {
        for (let k = 0; k < chunk.drains.length; k++) {
          const d = chunk.drains[k];
          const dist = Math.hypot(d.x - x, d.z - z);
          if (!best || dist < best.dist) best = { x: d.x, y: d.y, z: d.z, dist };
        }
      }
      return best;
    }

    /** Drain within `radius` (XZ) and one unit vertically of (x, y, z), or null. */
    function drainAt(x, y, z, radius) {
      for (const chunk of chunks.values()) {
        for (let k = 0; k < chunk.drains.length; k++) {
          const d = chunk.drains[k];
          if (Math.abs(y - d.y) <= 1.0 && Math.hypot(d.x - x, d.z - z) <= radius) return d;
        }
      }
      return null;
    }

    /** Spawn point: raised arrival terrace overlooking the lagoon and slide. */
    function spawn() {
      const [x, y, z, yaw] = PAVILION.spawn;
      return { x, y, z, yaw };
    }

    /** Restores a dimmed panel or, rarely, dims a random one for 0.1-0.4 s. */
    function updateFlicker(chunk, t, dt) {
      const mesh = chunk.panels;
      if (!mesh) return;
      const fl = chunk.flicker;
      if (fl.index >= 0) {
        if (t >= fl.until) {
          mesh.setColorAt(fl.index, panelWhite);
          mesh.instanceColor.needsUpdate = true;
          fl.index = -1;
        }
        return;
      }
      if (flickerRng() < dt / FLICKER_PERIOD) {
        fl.index = Math.floor(flickerRng() * mesh.count);
        fl.until = t + 0.1 + 0.3 * flickerRng();
        mesh.setColorAt(fl.index, tmpColor.setScalar(0.15 + 0.35 * flickerRng()));
        mesh.instanceColor.needsUpdate = true;
      }
    }

    /**
     * Per-frame animation: water uniforms, drain pulse, rare panel flicker, and the assignment of the
     * fixed light pool to the DRAIN_LIGHTS drains nearest the camera (origin until a camera is set).
     * Allocation-free: the nearest list is a small preallocated insertion sort.
     */
    function setTime(t, player) {
      if (player) {
        const { position, state } = player;
        const waterY = waterAt(position.x, position.z);
        if (state.inWater && Number.isFinite(waterY) &&
            (!wasInWater || (state.speed > 0.3 && t >= nextRipple))) {
          ripples[rippleIndex].set(position.x, position.z, t, wasInWater ? Math.min(0.9, 0.2 + state.speed * 0.08) : 1);
          rippleHeights[rippleIndex] = waterY;
          rippleIndex = (rippleIndex + 1) % ripples.length;
          nextRipple = t + 0.42;
        }
        wasInWater = state.inWater;
      }
      // Follow the current room lighting without another rendering pass.
      waterLight.copy(scene.fog.color).lerp(waterWhite, 0.65);
      const dt = lastTime === null ? 0 : util.clamp(t - lastTime, 0, 0.1);
      lastTime = t;
      causticTime.value = t;
      journey.setTime(t, dt, camera, opts.onBallContact);
      if (landmark.root.visible) landmark.update(t, dt, camera, opts.onBallContact);
      for (const mat of waterMaterials) {
        mat.uniforms.uTime.value = t;
        if (camera) mat.uniforms.uCameraPos.value.copy(camera.position);
      }
      const px = camera ? camera.position.x : 0;
      const py = camera ? camera.position.y : 0;
      const pz = camera ? camera.position.z : 0;
      litDist.fill(Infinity);
      for (let i = 0; i < DRAIN_LIGHTS; i++) litDrains[i] = null;
      for (const chunk of chunks.values()) {
        const drains = chunk.drainObjs;
        for (let k = 0; k < drains.length; k++) {
          const d = drains[k];
          d.pulse = Math.sin(t * 2.2 + d.phase);
          const s = 1 + 0.08 * d.pulse;
          d.disc.scale.set(s, s, 1);
          const dx = d.x - px, dy = d.y - py, dz = d.z - pz;
          const dist = dx * dx + dy * dy + dz * dz;
          let i = DRAIN_LIGHTS - 1;
          if (dist >= litDist[i]) continue;
          while (i > 0 && dist < litDist[i - 1]) {
            litDist[i] = litDist[i - 1];
            litDrains[i] = litDrains[i - 1];
            i--;
          }
          litDist[i] = dist;
          litDrains[i] = d;
        }
        updateFlicker(chunk, t, dt);
      }
      for (let i = 0; i < DRAIN_LIGHTS; i++) {
        const light = lightPool[i];
        const d = litDrains[i];
        if (!d) {
          light.intensity = 0;
          continue;
        }
        light.position.set(d.x, d.y + 0.6, d.z);
        light.intensity = DRAIN_LIGHT * (1 + 0.3 * d.pulse);
      }
    }

    /**
     * Kept for API compatibility: the water shader now uses Three's fog chunks, so the renderer copies
     * scene.fog into every water material each frame and nothing needs updating here.
     */
    function setFog() {}

    /** Camera whose position feeds the water shader. */
    function setCamera(cam) {
      camera = cam;
    }

    /** @returns {{ chunks:number, drains:number }} */
    function stats() {
      let drains = 0;
      chunks.forEach((chunk) => { drains += chunk.drains.length; });
      return { chunks: chunks.size, drains };
    }

    /** Frees every chunk, the shared materials/geometries, and removes the group from the scene. */
    function dispose() {
      chunks.forEach((chunk) => disposeChunk(chunk));
      chunks.clear();
      for (const water of landmark.waterMeshes) waterMaterials.delete(water.material);
      landmark.dispose();
      for (const water of journey.waterMeshes) waterMaterials.delete(water.material);
      journey.dispose();
      infoCache.clear();
      lastChunk = null;
      wallsCache.key = null;
      wallsCache.list = [];
      for (let i = 0; i < DRAIN_LIGHTS; i++) lightPool[i].dispose();
      for (let k = 0; k < MAT_KEYS.length; k++) materials[MAT_KEYS[k]].dispose();
      panelGeo.dispose();
      postGeo.dispose();
      pillarGeo.dispose();
      drainRingGeo.dispose();
      drainDiscGeo.dispose();
      panelMat.dispose();
      drainRingMat.dispose();
      drainGlowMat.dispose();
      group.clear();
      scene.remove(group);
    }

    return {
      group,
      journey,
      update,
      ensureChunk,
      setRing,
      soundscape,
      currentAt(x, z) { return journey.river.currentAt(x,z); },
      interactions,
      floorAt,
      ceilingAt,
      waterAt,
      wallsNear,
      nearestDrain,
      drainAt,
      spawn,
      stepRide(position, velocity, dt) {
        return landmark.stepRide(position, velocity, dt) || journey.stepRide(position, velocity, dt);
      },
      resetRide() { landmark.resetRide(); journey.resetRide(); },
      setTime,
      setFog,
      setCamera,
      chunkCoords,
      chunkInfo,
      stats,
      dispose,
    };
  }

  export { createWorld };
