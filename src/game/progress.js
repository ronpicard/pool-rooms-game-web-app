import { PAVILION } from './landmark.js';

// Authored dry checkpoints keep reloads safe even if a save was made while diving or riding.
export const CHECKPOINTS = {
  'Sun Pavilion': PAVILION.spawn,
  'Blue Arcade': [51, 0, 20, -Math.PI / 2],
  'Rain Hall': [111, 0, 12, -Math.PI / 2],
  'Sunken Baths': [180, 0, 28, -Math.PI / 2],
  'Column Sea': [240, 0, 12, -Math.PI / 2],
  'Sky Pool': [340, 6, 12, -Math.PI / 2],
  'Changing Gallery': [120, 0, -50.5, -0.8],
  'Lantern Baths': [251, 0, 76, -2.3],
  'Rain Garden': [119, 0, 44, -1.5],
  'Lazy River': [203, 0, 49, Math.PI],
  'Stillwater Nook': [197, 0, 68, Math.PI / 2],
};

export const DISCOVERIES = {
  'rain-garden': 'A garden behind the rain',
  'sun-mosaic': 'A sun beneath the water',
  'stillwater-nook': 'A little room beside the river',
};
export const INTERACTIONS = ['fountain', 'shutters', 'rain', 'boat', 'locker', 'bowl', 'sunshade', 'lanterns'];
export const PROGRESS_KEY = 'poolrooms.walk';

export function freshProgress(seed) {
  return { version: 1, seed, room: 'Sun Pavilion', visited: ['Sun Pavilion'], discoveries: [], interactions: {}, completed: false };
}

export function readProgress(raw, seed) {
  if (!raw || raw.version !== 1 || raw.seed !== seed || typeof raw.room !== 'string' || !Object.hasOwn(CHECKPOINTS, raw.room)) return null;
  const progress = freshProgress(seed);
  progress.room = raw.room;
  progress.visited = [...new Set(['Sun Pavilion', ...(Array.isArray(raw.visited) ? raw.visited : [])]
    .filter(name => typeof name === 'string' && Object.hasOwn(CHECKPOINTS, name)))];
  if (!progress.visited.includes(progress.room)) progress.visited.push(progress.room);
  progress.discoveries = [...new Set((Array.isArray(raw.discoveries) ? raw.discoveries : [])
    .filter(id => typeof id === 'string' && Object.hasOwn(DISCOVERIES, id)))];
  for (const id of INTERACTIONS) if (typeof raw.interactions?.[id] === 'boolean') progress.interactions[id] = raw.interactions[id];
  progress.completed = raw.completed === true;
  return progress;
}
