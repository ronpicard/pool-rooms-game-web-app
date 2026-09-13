import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('poolrooms.settings', JSON.stringify({quality:'low',inputMode:'touch',reducedMotion:true})));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.PR?.game?.world)).toBe(true);
});

test('the opening view follows a dry, continuous route to the Blue Arcade', async ({ page }) => {
  const result=await page.evaluate(() => {
    const {player,input,world,camera}=PR.game;
    const start=player.position.toArray(), direction=camera.getWorldDirection(player.velocity.clone()).toArray();
    input.state.moveZ=1;
    let wet=false, steps=0;
    while(player.position.x<51 && steps++<2400) {
      player.fixedStep(1/60);world.update(player.position.x);
      wet ||= player.state.inWater;
    }
    input.state.moveZ=0;
    return {start,direction,wet,end:player.position.toArray(),room:world.journey.roomAt(player.position.x,player.position.z)?.name,ceiling:world.ceilingAt(-38,12)};
  });
  expect(result.start).toEqual([-38,2,12]);
  expect(result.direction[0]).toBeCloseTo(1,5);
  expect(result.wet).toBe(false);
  expect(result.end[0]).toBeGreaterThanOrEqual(51);
  expect(result.room).toBe('Blue Arcade');
  expect(result.ceiling).toBe(24);
});

test('the expanded wings connect across chunk seams and the perimeter stays solid', async ({ page }) => {
  const result=await page.evaluate(() => {
    const {player,input,world}=PR.game;
    return [[-26,0,55,-Math.PI/2],[-38,0,-26,Math.PI],[-38,0,46,Math.PI],[-46,0,45,Math.PI/2],[0,0,70,Math.PI],[0,0,-46,0]].map(([x,y,z,yaw])=>{
      player.teleport(x,y,z,yaw);input.state.moveZ=1;
      for(let i=0;i<120;i++) player.fixedStep(1/60);
      input.state.moveZ=0;
      return player.position.toArray();
    });
  });
  expect(result[0][0]).toBeGreaterThan(-22);
  expect(result[1][2]).toBeGreaterThan(-22);
  expect(result[2][2]).toBeGreaterThan(50);
  expect(result[3][0]).toBeGreaterThan(-48);
  expect(result[4][2]).toBeLessThan(72);
  expect(result[5][2]).toBeGreaterThan(-48);
});

test('Turquoise Spiral can be reached by its stairs and ends in the lagoon', async ({ page }) => {
  const result=await page.evaluate(() => {
    const {player,input,world}=PR.game;
    player.teleport(37,0,-2,0);input.state.moveZ=1;
    let steps=0;
    while(player.position.z>-39.4 && steps++<1000) player.fixedStep(1/60);
    const landing=player.position.toArray();player.yaw=Math.PI/2;
    for(let i=0;i<100;i++) player.fixedStep(1/60);
    input.state.moveZ=0;const riding=player.position.toArray();
    for(let i=0;i<900;i++) player.fixedStep(1/60);
    const end={swimming:player.state.swimming,water:world.waterAt(player.position.x,player.position.z)};
    player.teleport(32,14,-39.5,0);
    for(let i=0;i<30;i++) player.fixedStep(1/60);
    player.teleport(37,0,-2,0);
    for(let i=0;i<60;i++) player.fixedStep(1/60);
    return {landing,riding,end,reset:player.position.toArray()};
  });
  expect(result.landing[1]).toBeCloseTo(14,2);
  expect(result.landing[2]).toBeLessThan(-39.3);
  expect(result.riding[0]).toBeLessThan(32);
  expect(result.riding[1]).toBeGreaterThan(10);
  expect(result.end.swimming).toBe(true);
  expect(result.end.water).toBeCloseTo(-0.12,2);
  expect(result.reset).toEqual([37,0,-2]);
});

test('the opening composition includes both tall slides and controllable fountains', async ({ page },testInfo) => {
  await page.setViewportSize({width:1600,height:900});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const result=await page.evaluate(() => {
    const {world,camera,scene,renderer}=PR.game;
    renderer.setSize(1600,900,false);camera.aspect=1600/900;camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const names=['Golden spiral slide','Turquoise spiral slide','Pavilion fountain 1','Pavilion fountain 2'];
    const features=names.map(name=>{
      const object=world.group.getObjectByName(name);object.geometry.computeBoundingBox();
      const bounds=object.geometry.boundingBox;
      const center=bounds.getCenter(camera.position.clone()).applyMatrix4(object.matrixWorld).project(camera);
      return {name,center:center.toArray(),height:bounds.max.y};
    });
    const control=world.interactions.find(item=>item.id==='fountain');
    const jets=[1,2].map(index=>world.group.getObjectByName(`Pavilion fountain ${index} jets`));
    control.set(true);const paused=jets.every(jet=>!jet.visible);
    control.set(false);const running=jets.every(jet=>jet.visible);
    renderer.setRenderTarget(null);renderer.render(scene,camera);
    return {features,paused,running,image:renderer.domElement.toDataURL('image/png'),calls:renderer.info.render.calls};
  });
  for(const feature of result.features) {
    expect(Math.abs(feature.center[0]),feature.name).toBeLessThan(1);
    expect(Math.abs(feature.center[1]),feature.name).toBeLessThan(1);
    expect(feature.center[2],feature.name).toBeLessThan(1);
  }
  expect(result.features[0].height).toBeGreaterThan(11);
  expect(result.features[1].height).toBeGreaterThan(15);
  expect(result.paused).toBe(true);expect(result.running).toBe(true);
  await writeFile(testInfo.outputPath('pavilion-opening.png'),Buffer.from(result.image.split(',')[1],'base64'));
  await testInfo.attach('render-budget',{body:JSON.stringify({calls:result.calls}),contentType:'application/json'});
  expect(errors).toEqual([]);
});

test('both fountains visibly flow and their valve stops jets, spills and droplets at every quality', async ({ page },testInfo) => {
  test.slow();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
  await page.setViewportSize({width:900,height:600});
  await page.locator('#btn-start').click();await page.locator('#btn-pause').click();
  for(const quality of ['low','medium','high']) {
    await page.locator('#sel-quality').selectOption(quality);
    const results=await page.evaluate(()=>{
      const {world,renderer,camera,scene}=PR.game;
      world.update(0);
      const control=world.interactions.find(item=>item.id==='fountain');
      return [[1,-6,-6],[2,11,19]].map(([index,x,z])=>{
        const jets=world.group.getObjectByName(`Pavilion fountain ${index} jets`);
        const drops=world.group.getObjectByName(`Pavilion fountain ${index} droplets`);
        camera.position.set(x+4,5,z+14);camera.lookAt(x,3,z);camera.updateMatrixWorld();
        // Isolate the water so moving reflections, toys and pool ripples cannot satisfy the check.
        const visibility=[];
        scene.traverse(object=>{
          if(object.isMesh || object.isPoints || object.isSprite) {
            visibility.push([object,object.visible]);object.visible=object===jets || object===drops;
          }
        });
        const gl=renderer.getContext(),w=renderer.domElement.width,h=renderer.domElement.height;
        const render=()=>{
          renderer.setRenderTarget(null);renderer.render(scene,camera);
          const pixels=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;
        };
        world.setTime(3.2);const first=render();
        world.setTime(3.4);const flowing=render();
        control.set(true);const stopped=render(),hidden=!jets.visible && !drops.visible;
        let movingPixels=0,waterPixels=0;
        for(let i=0;i<first.length;i+=4) {
          if(Math.abs(first[i]-flowing[i])+Math.abs(first[i+1]-flowing[i+1])+Math.abs(first[i+2]-flowing[i+2])>9) movingPixels++;
          if(Math.abs(stopped[i]-flowing[i])+Math.abs(stopped[i+1]-flowing[i+1])+Math.abs(stopped[i+2]-flowing[i+2])>9) waterPixels++;
        }
        visibility.forEach(([object,visible])=>{object.visible=visible;});control.set(false);
        renderer.render(scene,camera);
        return {index,movingPixels,waterPixels,hidden,restarted:jets.visible && drops.visible,
          count:drops.geometry.attributes.position.count,image:renderer.domElement.toDataURL('image/png')};
      });
    });
    for(const result of results) {
      expect(result.movingPixels,`${quality} fountain ${result.index}`).toBeGreaterThan(80);
      expect(result.waterPixels).toBeGreaterThan(150);
      expect(result.hidden).toBe(true);expect(result.restarted).toBe(true);
      expect(result.count).toBeLessThan(500);
      await writeFile(testInfo.outputPath(`fountain-${result.index}-${quality}.png`),Buffer.from(result.image.split(',')[1],'base64'));
    }
  }
  expect(errors).toEqual([]);
});
