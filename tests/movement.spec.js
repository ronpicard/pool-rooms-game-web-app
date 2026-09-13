import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('poolrooms.settings', JSON.stringify({quality:'low',inputMode:'touch',reducedMotion:true})));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.PR?.game?.world), {timeout:15000}).toBe(true);
});

test('looking around on each slide preserves the view and completes the ride', async ({ page }) => {
  const rides = await page.evaluate(() => {
    const {player,input}=PR.game;
    return [[32,6,20.5],[158,4,8.5],[393,9.5,-1.25]].map(([x,y,z])=>{
      player.teleport(x,y,z,0.2);
      input.state.moveZ=0;
      for(let i=0;i<40;i++) player.fixedStep(1/60);
      player.applyLook(0.7,-0.35);
      const view=[player.yaw,player.pitch], from=player.position.clone();
      for(let i=0;i<50;i++) player.fixedStep(1/60);
      player.updateCamera(1);
      const during=[player.yaw,player.pitch], moved=player.position.distanceTo(from);
      const camera=[PR.game.camera.rotation.y,PR.game.camera.rotation.x];
      for(let i=0;i<500;i++) player.fixedStep(1/60);
      return {view,during,camera,moved,swimming:player.state.swimming};
    });
  });
  for(const ride of rides) {
    expect(ride.during).toEqual(ride.view);
    expect(ride.camera).toEqual(ride.view);
    expect(ride.moved).toBeGreaterThan(1);
    expect(ride.swimming).toBe(true);
  }
});

test('walking and sprinting up and down steps smooths the camera and teleport resets it', async ({ page }) => {
  const routes=await page.evaluate(()=>{
    const {player,input,camera}=PR.game;
    return [false,true].flatMap(sprint=>[1,-1].map(direction=>{
      player.teleport(direction===1?308.2:335.8,direction===1?0.25:6,12,-direction*Math.PI/2);
      player.setReducedMotion(true);
      for(let i=0;i<10;i++) player.fixedStep(1/60);
      player.updateCamera(1);
      input.state.moveZ=1; input.state.sprint=sprint;
      let previous=camera.position.y, maxCameraStep=0, maxFeetStep=0;
      for(let i=0;i<(sprint?285:490);i++) {
        const feet=player.position.y;
        player.fixedStep(1/60); player.updateCamera(1);
        maxCameraStep=Math.max(maxCameraStep,Math.abs(camera.position.y-previous));
        maxFeetStep=Math.max(maxFeetStep,Math.abs(player.position.y-feet));
        previous=camera.position.y;
      }
      input.state.moveZ=0; input.state.sprint=false;
      for(let i=0;i<90;i++) player.fixedStep(1/60);
      player.updateCamera(1);
      const settled=camera.position.y-player.position.y;
      player.teleport(51,0,21,0); player.updateCamera(0.5);
      return {maxCameraStep,maxFeetStep,settled,reset:camera.position.y};
    }));
  });
  for(const route of routes) {
    expect(route.maxFeetStep).toBeGreaterThanOrEqual(0.25);
    expect(route.maxCameraStep).toBeLessThan(0.085);
    expect(route.settled).toBeCloseTo(1.62,3);
    expect(route.reset).toBeCloseTo(1.62,3);
  }
});

test('jumping against every ocean-facing edge keeps the player on the terrace or pier', async ({ page }) => {
  const edges=await page.evaluate(()=>{
    const {player,input,world}=PR.game;
    return [[370,6,-15.15,0],[370,6,43.15,Math.PI],[403,6,30,-Math.PI/2],[470,7,8.8,0],[470,7,19.2,Math.PI],[483.2,7,14,-Math.PI/2]].map(([x,y,z,yaw])=>{
      player.teleport(x,y,z,yaw);
      for(let i=0;i<5;i++) player.fixedStep(1/60);
      input.state.moveZ=1; input.state.sprint=true;
      // Same launch velocity as a jump, keeping the deterministic controller test independent of DOM timing.
      player.velocity.y=6; player.state.onGround=false;
      for(let i=0;i<150;i++) player.fixedStep(1/60);
      input.state.moveZ=0; input.state.sprint=false;
      return {position:player.position.toArray(),room:world.journey.roomAt(player.position.x,player.position.z)?.name};
    });
  });
  for(const edge of edges) expect(edge.room,JSON.stringify(edge.position)).toBe('Sky Pool');
  expect(edges[0].position[2]).toBeGreaterThan(-16);
  expect(edges[1].position[2]).toBeLessThan(44);
  expect(edges[2].position[0]).toBeLessThan(404);
  expect(edges[3].position[2]).toBeGreaterThan(8);
  expect(edges[4].position[2]).toBeLessThan(20);
  expect(edges[5].position[0]).toBeLessThan(484);
});
