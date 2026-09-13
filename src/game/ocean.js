// One wave definition feeds the ocean shader and the sound of water beneath the pier.
const WAVES = [
  [0.94, 0.342, 0.24, 0.24, 0.72],
  [-0.6, 0.8, 0.43, 0.12, 0.93],
  [0.28, -0.96, 0.81, 0.055, 1.18],
];
export function sampleOceanHeight(x, z, time) {
  return WAVES.reduce((height, [dx,dz,frequency,amplitude,speed]) =>
    height + Math.sin((x*dx + z*dz)*frequency-time*speed)*amplitude, 0);
}
export const OCEAN_WAVES = `
  vec3 oceanWave(vec2 p, float t, vec2 direction, float frequency, float amplitude, float speed) {
    float phase = dot(p, direction) * frequency - t * speed;
    return vec3(sin(phase) * amplitude, direction * cos(phase) * frequency * amplitude);
  }
  vec3 oceanSurface(vec2 p, float t) {
    return ${WAVES.map(([x,z,f,a,s]) => `oceanWave(p,t,vec2(${x},${z}),${f},${a},${s})`).join(' + ')};
  }
`;
