import * as THREE from 'three';

const STRAIGHT = 40, RADIUS = 12, BEND = Math.PI * RADIUS / 2;
const LENGTH = STRAIGHT + BEND + 26;
const HALF_WIDTH = 10, WATER_WIDTH = 5, DEPTH = 1.75, END_DECK = 4;
const OPENINGS = [[9, 18], [34, 43], [66, 75]];
const clamp = THREE.MathUtils.clamp;

// Distance along one continuous channel drives its mesh, terrain, current and skylight acoustics.
function pointAt(s, offset = 0) {
  if (s <= STRAIGHT) return { x: 210 + offset, z: 40 + s, tx: 0, tz: 1 };
  if (s < STRAIGHT + BEND) {
    const angle = (s - STRAIGHT) / RADIUS;
    return { x: 222 - Math.cos(angle) * (RADIUS - offset), z: 80 + Math.sin(angle) * (RADIUS - offset), tx: Math.sin(angle), tz: Math.cos(angle) };
  }
  return { x: 222 + s - STRAIGHT - BEND, z: 92 - offset, tx: 1, tz: 0 };
}

// Ocean cutouts follow both straight banks and the actual quarter-circle bend.
const start = pointAt(0), corner = pointAt(STRAIGHT + BEND), end = pointAt(LENGTH);
export const RIVER_FOOTPRINT = {
  bounds: [
    [start.x - HALF_WIDTH, start.z, start.x + HALF_WIDTH, corner.z - RADIUS],
    [corner.x, corner.z - HALF_WIDTH, end.x, corner.z + HALF_WIDTH],
  ],
  arcs: [{
    center: [corner.x, corner.z - RADIUS],
    radii: [RADIUS - HALF_WIDTH, RADIUS + HALF_WIDTH],
    angles: [Math.PI / 2, Math.PI],
  }],
};

function project(x, z) {
  let s, offset;
  if (z <= 80) { s = z - 40; offset = x - 210; }
  else if (x < 222) {
    const angle = Math.atan2(z - 80, 222 - x);
    s = STRAIGHT + angle * RADIUS; offset = RADIUS - Math.hypot(x - 222, z - 80);
  } else { s = STRAIGHT + BEND + x - 222; offset = 92 - z; }
  return { s, offset, inside: s >= 0 && s <= LENGTH && Math.abs(offset) <= HALF_WIDTH };
}

function strip(a, ay, b, by, from = 0, to = LENGTH) {
  const positions = [], uvs = [], indices = [], count = Math.ceil((to - from) / 0.65);
  for (let i = 0; i <= count; i++) {
    const s = from + (to - from) * i / count;
    for (const [offset, y] of [[a, ay], [b, by]]) {
      const p = pointAt(s, offset);
      positions.push(p.x, y, p.z); uvs.push(s / 4, (a === b ? y : offset) / 4);
    }
    if (i < count) { const n = i * 2; indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices); geo.computeVertexNormals();
  return geo;
}

export function createLazyRiver({ geometry, box, material, sign, section, walls, owned, createWater, waterMeshes, textures, ivory, floor, poolMaterial, brass, glow, shade }) {
  const accent = material(0x76aaa3, { map: textures.wall, side: THREE.DoubleSide });
  const shell = material(0xede5cc, { map: textures.wall, side: THREE.DoubleSide });
  const addStrip = (a, ay, b, by, mat, from, to) => geometry(strip(a, ay, b, by, from, to), mat, 0, 0, 0);
  // Broad dry banks follow the bend; all seven shallow treads are usable along either bank.
  addStrip(-HALF_WIDTH, 0, -WATER_WIDTH, 0, floor);
  addStrip(WATER_WIDTH, 0, HALF_WIDTH, 0, floor);
  for (const [from, to] of [[0, END_DECK], [LENGTH - END_DECK, LENGTH]]) addStrip(-WATER_WIDTH, 0, WATER_WIDTH, 0, floor, from, to);
  for (let i = 0; i < DEPTH / 0.25; i++) {
    const edge = WATER_WIDTH - i * 0.4, next = edge - 0.4, y = -(i + 1) * 0.25;
    const from = END_DECK + i * 0.4, to = LENGTH - from;
    for (const side of [-1, 1]) {
      addStrip(side * edge, y + 0.25, side * edge, y, shell, from, to);
      addStrip(Math.min(side * edge, side * next), y, Math.max(side * edge, side * next), y, poolMaterial, from, to);
    }
    addStrip(-next, y, next, y, poolMaterial, from, from + 0.4);
    addStrip(-next, y, next, y, poolMaterial, to - 0.4, to);
    // Close the vertical faces at both ends as well as along the banks.
    for (const s of [from,to]) {
      const p=pointAt(s);
      const riser=new THREE.BoxGeometry(edge*2,0.25,0.03).rotateY(Math.atan2(p.tx,p.tz));
      geometry(riser,shell,p.x,y+0.125,p.z);
    }
  }
  addStrip(-2.2, -DEPTH, 2.2, -DEPTH, poolMaterial, 6.8, LENGTH - 6.8);
  for (const side of [-1, 1]) {
    addStrip(side * 5, 0.015, side * 5.24, 0.015, accent);
    // A discreet opening in the outer bank leads to the hidden stillwater room.
    const ranges = side === -1 ? [[0, 24], [32, LENGTH]] : [[0, LENGTH]];
    for (const [from, to] of ranges) {
      addStrip(side * 10, 0, side * 10, 6, shell, from, to);
      addStrip(side * 9.98, 0, side * 9.98, 1, accent, from, to);
      for (let s = from; s < to; s += 0.6) {
        const a = pointAt(s, side * 10), b = pointAt(Math.min(to, s + 0.6), side * 10);
        walls.push({ x0: Math.min(a.x,b.x)-0.12, x1: Math.max(a.x,b.x)+0.12, z0: Math.min(a.z,b.z)-0.12, z1: Math.max(a.z,b.z)+0.12, y0: 0, y1: 6 });
      }
    }
  }
  box(200, 4.6, 68, 0.25, 2.8, 8, ivory, true);
  // Real gaps in the ceiling reveal the sky; the side strips leave a generous clerestory.
  let from = 0;
  for (const [start, end] of [...OPENINGS, [LENGTH, LENGTH]]) {
    addStrip(-10, 6, 10, 6, shell, from, start);
    if (end > start) {
      addStrip(-10, 6, -4, 6, shell, start, end);
      addStrip(4, 6, 10, 6, shell, start, end);
      for (const s of [start, end]) {
        const p = pointAt(s);
        const beam = new THREE.BoxGeometry(20, 0.25, 0.22).rotateY(Math.atan2(p.tx,p.tz));
        geometry(beam, brass, p.x, 6, p.z);
      }
      addStrip(-4, -DEPTH + 0.025, 4, -DEPTH + 0.025, glow, start + 1, Math.min(end - 1, start + 1.12));
    }
    from = end;
  }
  for (const [s, yaw, text] of [[1, Math.PI, 'Sunken Baths'], [LENGTH - 1, -Math.PI / 2, 'Lantern Baths']]) {
    const p = pointAt(s, -7);
    sign(text, p.x, 1.8, p.z, yaw, 'Walk the banks or let the water carry you');
  }
  // A quiet seat halfway along the outside bank, in shade just before the bend.
  box(202.5, 0.5, 78, 1.5, 1, 4, ivory, true);
  const shadow = new THREE.PlaneGeometry(5, 7);
  geometry(shadow, shade, 202.5, 0.02, 78, [-Math.PI / 2, 0, 0]);
  const water = createWater(200, 40, 248, 102, -0.12, DEPTH);
  water.geometry.dispose(); water.geometry = strip(-5, -0.12, 5, -0.12, END_DECK, LENGTH - END_DECK);
  water.position.set(0, 0, 0); water.rotation.set(0, 0, 0); water.name = 'Lazy River water';
  owned.add(water.geometry); section.add(water); waterMeshes.push(water);
  return {
    pointAt, length: LENGTH, project,
    contains(x, z) { return project(x, z).inside; },
    terrain(x, z) {
      const p = project(x, z);
      if (!p.inside) return null;
      const edge = Math.min(WATER_WIDTH - Math.abs(p.offset), p.s - END_DECK, LENGTH - END_DECK - p.s);
      return edge > 0 ? { floor: -Math.min(DEPTH, (Math.floor(edge / 0.4) + 1) * 0.25), water: -0.12 } : { floor: 0, water: NaN };
    },
    currentAt(x, z) {
      const p = project(x, z);
      if (!p.inside || Math.abs(p.offset) > 2.2 || p.s < 6.8 || p.s > LENGTH - 6.8) return null;
      const q = pointAt(p.s), centering = clamp(-p.offset * 0.35, -0.4, 0.4);
      const speed = Math.min(0.9, (LENGTH - 6.8 - p.s) * 0.4 + 0.15);
      return { x: q.tx * speed + q.tz * centering, z: q.tz * speed - q.tx * centering };
    },
    openness(x, z) { const p = project(x,z); return p.inside && OPENINGS.some(([a,b]) => p.s > a && p.s < b) ? 1 : 0; },
    nearestWater(x, z) { const p = project(x,z), q = pointAt(clamp(p.s,END_DECK,LENGTH-END_DECK), p.offset < 0 ? -5 : 5); return { x:q.x, y:-0.12, z:q.z }; },
  };
}
