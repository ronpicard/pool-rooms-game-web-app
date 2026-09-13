import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { createBeachBalls } from '../src/game/pool-toys.js';

function createToys(placements, options = {}) {
  const balls = [];
  const controller = createBeachBalls({
    placements,
    mesh(geometry, material, x, y, z) {
      const ball = new THREE.Mesh(geometry, material);
      ball.position.set(x,y,z);
      balls.push(ball);
      return ball;
    },
    material: color => new THREE.MeshBasicMaterial({color}),
    contactShadow: () => new THREE.Object3D(),
    terrain: () => ({floor:-2,water:-0.12}),
    walls: [],
    bounds: [-20,-20,20,20],
    ...options,
  });
  return {balls, update:controller.update};
}

for (const surface of ['pool', 'raised pool', 'deck']) {
  test(`overlapping beach balls gently move each other on the ${surface}`, () => {
    const elevation = surface === 'raised pool' ? 6 : 0;
    const water = surface === 'deck' ? NaN : elevation-0.12;
    const {balls,update} = createToys([[0,0,1],[1.5,0,1]], {
      elevation, terrain: () => ({floor:elevation-2,water}),
    });
    update(0,0);
    expect(balls.map(ball=>ball.position.x)).toEqual([0,1.5]);
    update(1/60,1/60);
    expect(balls[0].position.x).toBeLessThan(0);
    expect(balls[1].position.x).toBeGreaterThan(1.5);
    // Contact changes their motion while still allowing visible overlap.
    expect(balls[0].position.distanceTo(balls[1].position)).toBeLessThan(2);
    for (let i=2;i<=120;i++) update(i/60,1/60);
    expect(balls[0].position.x).toBeLessThan(-0.2);
    expect(balls[1].position.x).toBeGreaterThan(1.7);
    if (Number.isFinite(water)) for (const ball of balls) {
      expect(ball.position.y+elevation).toBeGreaterThan(water);
      expect(ball.position.y+elevation-water).toBeLessThan(1);
    }
  });
}

test('a moving beach ball pushes a stationary ball without player contact', () => {
  const {balls,update} = createToys([[0,0,1],[3,0,0.7]]);
  const camera = new THREE.PerspectiveCamera();
  for (let i=1;i<=60;i++) {
    camera.position.set(balls[0].position.x-0.9,balls[0].position.y,0);
    expect(Math.abs(balls[1].position.x-camera.position.x)).toBeGreaterThan(0.7+0.65);
    update(i/60,1/60,camera);
  }
  for (let i=61;i<=240;i++) update(i/60,1/60);
  expect(balls[0].position.x).toBeGreaterThan(0.5);
  expect(balls[1].position.x).toBeGreaterThan(3.5);
});

test('beach balls sharing a center separate without invalid positions', () => {
  const {balls,update} = createToys([[0,0,1],[0,0,1],[0,0,0.7]]);
  for (let i=1;i<=120;i++) update(i/60,1/60);
  for (const ball of balls) expect(ball.position.toArray().every(Number.isFinite)).toBe(true);
  for (let i=0;i<balls.length;i++) for (let j=i+1;j<balls.length;j++) {
    expect(balls[i].position.distanceTo(balls[j].position)).toBeGreaterThan(0.5);
  }
});

test('beach balls do not push across a gap or between different heights', () => {
  const {balls,update} = createToys([[0,0,1],[3,0,1],[0,0.1,1]], {
    terrain: (x,z) => ({floor:z>0?5:0,water:NaN}),
  });
  for (let i=1;i<=120;i++) update(i/60,1/60);
  expect(balls.map(ball=>[ball.position.x,ball.position.z])).toEqual([[0,0],[3,0],[0,0.1]]);
});

test('beach ball contact respects pool edges, deck bounds and walls', () => {
  for (const options of [
    {terrain:x=>({floor:-2,water:x<=2?-0.12:NaN})},
    {terrain:()=>({floor:0,water:NaN}),bounds:[-20,-20,3,20]},
    {terrain:()=>({floor:0,water:NaN}),walls:[{x0:3,x1:4,z0:-20,z1:20,y0:0,y1:4}]},
  ]) {
    const {balls,update} = createToys([[0.9,0,1],[1.9,0,1]],options);
    for (let i=1;i<=180;i++) {
      update(i/60,1/60);
      expect(balls[1].position.x).toBeLessThanOrEqual(2);
    }
    expect(balls[0].position.x).toBeLessThan(0.5);
  }
});
