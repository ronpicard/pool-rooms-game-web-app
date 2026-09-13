import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('poolrooms.settings', JSON.stringify({quality:'low',inputMode:'touch',reducedMotion:true})));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.PR?.game?.world), {timeout:15000}).toBe(true);
});

test('water and pool steps preserve walking and sprinting pace from a standing start', async ({ page }) => {
  const runs=await page.evaluate(()=>{
    const {player,input,world}=PR.game;
    const results=[];
    try {
      for(const sprint of [false,true]) for(const surface of ['dry','wading','swimming','wet steps up','wet steps down']) {
        const floorAt=(_,z)=>surface==='swimming'?-5:surface==='wet steps up'?Math.floor(-z/0.75)*0.25:
          surface==='wet steps down'?-Math.floor(-z/0.75)*0.25:0;
        player.setWorld({floorAt,ceilingAt:()=>30,wallsNear:()=>[],
          waterAt:(x,z)=>surface==='dry'?NaN:surface==='swimming'?0:floorAt(x,z)+0.6});
        player.teleport(0,surface==='swimming'?-1.25:0,0,0);
        input.state.moveZ=0;input.state.sprint=false;
        for(let i=0;i<30;i++) player.fixedStep(1/60);
        input.state.moveZ=1;input.state.sprint=sprint;
        for(let i=0;i<60;i++) player.fixedStep(1/60);
        results.push({surface,sprint,distance:-player.position.z,speed:player.state.speed});
      }
    } finally {
      input.state.moveZ=0;input.state.sprint=false;player.setWorld(world);player.teleport(-38,2,12,-Math.PI/2);
    }
    return results;
  });
  for(const run of runs) {
    const dry=runs.find(other=>other.surface==='dry' && other.sprint===run.sprint);
    expect(run.speed,JSON.stringify(run)).toBeCloseTo(run.sprint?5.8:3.4,4);
    expect(run.distance,JSON.stringify(run)).toBeCloseTo(dry.distance,4);
  }
});

test('Pavilion slide steps keep full horizontal speed in both directions', async ({ page }) => {
  const runs=await page.evaluate(()=>{
    const {player,input,world}=PR.game;
    return [false,true].flatMap(sprint=>[1,-1].map(direction=>{
      const z=direction===1?45:25;
      input.state.moveZ=0;player.teleport(37,world.floorAt(37,z),z,direction===1?0:Math.PI);
      for(let i=0;i<5;i++) player.fixedStep(1/60);
      input.state.moveZ=1;input.state.sprint=sprint;
      for(let i=0;i<30;i++) player.fixedStep(1/60);
      const from=player.position.clone();
      for(let i=0;i<120;i++) player.fixedStep(1/60);
      input.state.moveZ=0;input.state.sprint=false;
      return {sprint,distance:Math.abs(player.position.z-from.z),rise:Math.abs(player.position.y-from.y)};
    }));
  });
  for(const run of runs) {
    expect(run.distance).toBeCloseTo(2*(run.sprint?5.8:3.4),4);
    expect(run.rise).toBeGreaterThan(2);
  }
});

test('the gaps between slide stair supports are passable in both directions', async ({ page }) => {
  const routes=await page.evaluate(()=>{
    const {player,input,world}=PR.game;
    return [
      ...[-5,-15,-25,-32,-35.7].map(z=>({name:'Rain Spiral',x:114.2,z,y:0})),
      {name:'Rain Slide landing',x:159.25,z:8.5,y:0,width:3.4},
      {name:'Sky Spiral pool',x:383,z:7,y:4.63},
      {name:'Sky Spiral landing',x:382.25,z:-12.4,y:6,width:3.4},
    ].flatMap(({name,x,z,y,width=2.2})=>[-1,1].map(direction=>{
      const start=x-direction*width, target=x+direction*width;
      player.teleport(start,y,z,-direction*Math.PI/2);
      input.state.moveZ=0;
      for(let i=0;i<15;i++) player.fixedStep(1/60);
      input.state.moveZ=1;
      let steps=0,maxY=player.position.y;
      while(direction*(target-player.position.x)>0 && steps++<240) {
        player.fixedStep(1/60);maxY=Math.max(maxY,player.position.y);
      }
      input.state.moveZ=0;
      return {name,z,direction,target,position:player.position.toArray(),maxY,base:y};
    }));
  });
  for(const route of routes) {
    expect(route.direction*(route.position[0]-route.target),JSON.stringify(route)).toBeGreaterThanOrEqual(0);
    expect(route.maxY,JSON.stringify(route)).toBeLessThan(route.base+0.3);
  }
});

test('stair supports, low treads and their undersides remain solid', async ({ page }) => {
  const result=await page.evaluate(()=>{
    const {player,input}=PR.game;
    player.teleport(116.4,0,-20,Math.PI/2);input.state.moveZ=1;
    for(let i=0;i<120;i++) player.fixedStep(1/60);
    const post=player.position.toArray();input.state.moveZ=0;

    player.teleport(114.2,0,3.5,Math.PI);
    for(let i=0;i<5;i++) player.fixedStep(1/60);
    player.velocity.y=6;player.state.onGround=false;
    let maxY=0;
    for(let i=0;i<120;i++) {
      player.fixedStep(1/60);maxY=Math.max(maxY,player.position.y);
    }
    const landed=player.position.y;
    input.state.moveZ=1;
    for(let i=0;i<120;i++) player.fixedStep(1/60);
    input.state.moveZ=0;
    return {post,maxY,landed,lowTreads:player.position.toArray()};
  });
  expect(result.post[0]).toBeGreaterThan(114.55);
  expect(result.post[0]).toBeLessThan(115);
  expect(result.maxY).toBeGreaterThan(0.2);
  expect(result.maxY).toBeLessThanOrEqual(0.45+1e-6);
  expect(result.landed).toBe(0);
  expect(result.lowTreads[2]).toBeLessThan(5);
  expect(result.lowTreads[1]).toBe(0);
});

test('Rain Spiral treads support walking and sprinting both ways and rails contain jumps', async ({ page }) => {
  const routes=await page.evaluate(()=>{
    const {player,input}=PR.game;
    return [false,true].flatMap(sprint=>[-1,1].map(direction=>{
      player.teleport(114.2,10.25,-15.2,direction===1?0:Math.PI);
      input.state.moveZ=0;
      for(let i=0;i<15;i++) player.fixedStep(1/60);
      input.state.moveZ=1;input.state.sprint=sprint;
      for(let i=0;i<30;i++) player.fixedStep(1/60);
      const from=player.position.clone();
      for(let i=0;i<120;i++) player.fixedStep(1/60);
      const distance=Math.abs(player.position.z-from.z),rise=direction*(player.position.y-from.y);
      player.yaw=direction*Math.PI/2;
      player.velocity.y=6;player.state.onGround=false;
      for(let i=0;i<120;i++) player.fixedStep(1/60);
      input.state.moveZ=0;input.state.sprint=false;
      return {sprint,distance,rise,end:player.position.toArray()};
    }));
  });
  for(const route of routes) {
    expect(route.distance).toBeCloseTo(2*(route.sprint?5.8:3.4),4);
    expect(route.rise).toBeGreaterThan(2);
    expect(Math.abs(route.end[0]-114.2)).toBeLessThan(1.1);
  }
});

test('standing on a join between elevated treads stays steady', async ({ page }) => {
  const positions=await page.evaluate(()=>{
    const {player,input}=PR.game;
    input.state.moveZ=0;
    return [[114.2,10.25,-15],[114.2,18,-35],[383,16.25,8]].map(([x,y,z])=>{
      player.teleport(x,y,z,0);
      for(let i=0;i<120;i++) player.fixedStep(1/60);
      return {start:[x,y,z],end:player.position.toArray()};
    });
  });
  for(const position of positions) {
    for(let axis=0;axis<3;axis++) expect(position.end[axis],JSON.stringify(position)).toBeCloseTo(position.start[axis],4);
  }
});

test('looking around on each slide preserves the view and completes the ride', async ({ page }) => {
  const rides = await page.evaluate(() => {
    const {player,input}=PR.game;
    return [[32,10,20.5],[32,14,-39.5],[158,4,8.5],[116.2,18,-36.5],[393,9.5,-1.25],[381,26,-11.5]].map(([x,y,z])=>{
      player.teleport(x,y,z,0.2);
      input.state.moveZ=0;
      for(let i=0;i<40;i++) player.fixedStep(1/60);
      player.applyLook(0.7,-0.35);
      const view=[player.yaw,player.pitch], from=player.position.clone();
      for(let i=0;i<50;i++) player.fixedStep(1/60);
      player.updateCamera(1);
      const during=[player.yaw,player.pitch], moved=player.position.distanceTo(from);
      const camera=[PR.game.camera.rotation.y,PR.game.camera.rotation.x];
      for(let i=0;i<900;i++) player.fixedStep(1/60);
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
