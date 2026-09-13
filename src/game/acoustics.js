import { sampleOceanHeight } from './ocean.js';

// Geometry supplies the pool edges, waterfall impacts, pier and collision walls.
export function createSoundscape({ pools, rain, walls, pier, river }) {
  return {
    rain,
    river,
    oceanHeight: sampleOceanHeight,
    pierProgress(position) { return Math.max(0, Math.min(1, (position.x - pier.x0) / (pier.x1 - pier.x0))); },
    nearestWater(position) {
      let nearest = null, best = Infinity;
      for (const pool of pools) {
        let x, z, y;
        if (Array.isArray(pool)) {
          x = Math.max(pool[0], Math.min(pool[2], position.x));
          z = Math.max(pool[1], Math.min(pool[3], position.z)); y = pool[5] - 0.12;
          if (x === position.x && z === position.z) {
            const distances = [x-pool[0], pool[2]-x, z-pool[1], pool[3]-z];
            const edge = distances.indexOf(Math.min(...distances));
            if (edge < 2) x = pool[edge === 0 ? 0 : 2]; else z = pool[edge === 2 ? 1 : 3];
          }
        } else {
          const angle = Math.atan2((position.z-pool.z)/pool.rz, (position.x-pool.x)/pool.rx);
          x = pool.x + Math.cos(angle)*pool.rx; z = pool.z + Math.sin(angle)*pool.rz; y = -0.12;
        }
        const distance = Math.hypot(position.x-x, position.y-y, position.z-z);
        if (distance < best) { best = distance; nearest = { x, y, z }; }
      }
      if (river) {
        const water = river.nearestWater(position.x,position.z);
        if (Math.hypot(position.x-water.x,position.y-water.y,position.z-water.z)<best) nearest=water;
      }
      return nearest;
    },
    occluded(from, to) {
      // Slab intersection respects actual door gaps and elevated walls. Ignore the endpoints.
      return walls.some(wall => {
        let enter = 0.02, leave = 0.98;
        for (const axis of ['x', 'y', 'z']) {
          const delta = to[axis] - from[axis], low = wall[axis+'0'], high = wall[axis+'1'];
          if (Math.abs(delta) < 0.00001) {
            if (from[axis] < low || from[axis] > high) return false;
          } else {
            const a = (low-from[axis])/delta, b = (high-from[axis])/delta;
            enter = Math.max(enter, Math.min(a,b)); leave = Math.min(leave, Math.max(a,b));
            if (enter > leave) return false;
          }
        }
        return enter <= leave;
      });
    },
  };
}
