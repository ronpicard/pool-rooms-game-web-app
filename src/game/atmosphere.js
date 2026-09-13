import * as THREE from 'three';

// Lighting and arrival copy share the same room identities as the designed walk.
export const ATMOSPHERES = {
  'Sun Pavilion': { caption: 'A little further from the everyday.', fog: 0xdde7dd, sky: 0xfff0d3, ground: 0x659b9e, sun: 0xffe2b4, fill: 1.15, direct: 1.85, exposure: 1.08, haze: 1 },
  'Blue Arcade': { caption: 'Follow the rhythm of the arches.', fog: 0xb8d4da, sky: 0xd4eaf3, ground: 0x457e8d, sun: 0xe6f4ff, fill: 0.95, direct: 1.35, exposure: 1.04, haze: 0.88 },
  'Water passage': { caption: 'Rain, somewhere ahead.', fog: 0xc2d8d6, sky: 0xdcebe8, ground: 0x527b7e, sun: 0xd6e7e4, fill: 0.8, direct: 0.9, exposure: 1, haze: 0.85 },
  'Rain Hall': { caption: 'Stay a moment. Listen to the water.', fog: 0xb8ceca, sky: 0xdae8e4, ground: 0x507d7d, sun: 0xe6f3ed, fill: 0.85, direct: 1.1, exposure: 1.02, haze: 0.78 },
  'Quiet passage': { caption: 'The world grows softer.', fog: 0xcfc4cf, sky: 0xeadce4, ground: 0x776b85, sun: 0xffdfcd, fill: 0.75, direct: 0.85, exposure: 1, haze: 0.86 },
  'Sunken Baths': { caption: 'Nothing here needs to hurry.', fog: 0xc9bdce, sky: 0xf1dfeb, ground: 0x74648a, sun: 0xffd5b6, fill: 0.72, direct: 0.85, exposure: 1.02, haze: 0.84 },
  'The threshold': { caption: 'Beyond the light, another room.', fog: 0x9db8bb, sky: 0xcbdedc, ground: 0x476b7a, sun: 0xe2ecdf, fill: 0.65, direct: 0.75, exposure: 1, haze: 0.8 },
  'Column Sea': { caption: 'An ocean held beneath a ceiling.', fog: 0x8daeb3, sky: 0xc6dddf, ground: 0x375568, sun: 0xd5e9dd, fill: 0.56, direct: 0.72, exposure: 1, haze: 0.72 },
  'Toward the sky': { caption: 'The air feels different up ahead.', fog: 0xe6decb, sky: 0xffeacd, ground: 0x8a9e99, sun: 0xffddb0, fill: 0.95, direct: 1.4, exposure: 1.05, haze: 0.95 },
  'Sky Pool': { caption: 'There is nowhere else you need to be.', fog: 0xdce9e5, sky: 0xfff1da, ground: 0x749fa6, sun: 0xffdfaa, fill: 1.25, direct: 2, exposure: 1.08, haze: 1.15 },
  'Changing Gallery': { caption: 'Leave the outside world at the door.', fog: 0xc9dbcf, sky: 0xe6eee0, ground: 0x628981, sun: 0xffe9cb, fill: 0.9, direct: 1.05, exposure: 1.03, haze: 0.9 },
  'Lantern Baths': { caption: 'A pool of warmth, tucked away.', fog: 0xd9bc9f, sky: 0xffdfb4, ground: 0x8a6b68, sun: 0xffc481, fill: 0.68, direct: 0.85, exposure: 1.04, haze: 0.88 },
};

const profiles = Object.fromEntries(Object.entries(ATMOSPHERES).map(([name, p]) => [name, {
  ...p, fog: new THREE.Color(p.fog), sky: new THREE.Color(p.sky),
  ground: new THREE.Color(p.ground), sun: new THREE.Color(p.sun),
}]));

export function createAtmosphere({ hemisphere, sun, renderer, skyColor }) {
  let haze = 1;
  return {
    // Exponential blending stays smooth across doorways at any frame rate.
    update(room, dt, immediate = false) {
      const p = profiles[room] || profiles['Sun Pavilion'];
      const blend = immediate ? 1 : 1 - Math.exp(-dt * 0.8);
      hemisphere.color.lerp(p.sky, blend);
      hemisphere.groundColor.lerp(p.ground, blend);
      sun.color.lerp(p.sun, blend);
      skyColor.lerp(p.fog, blend);
      hemisphere.intensity += (p.fill - hemisphere.intensity) * blend;
      sun.intensity += (p.direct - sun.intensity) * blend;
      renderer.toneMappingExposure += (p.exposure - renderer.toneMappingExposure) * blend;
      haze += (p.haze - haze) * blend;
      return haze;
    },
  };
}
