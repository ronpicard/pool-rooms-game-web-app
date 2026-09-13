import { test, expect } from '@playwright/test';
import { CHECKPOINTS, readProgress } from '../src/game/progress.js';
import { writeFile } from 'node:fs/promises';

async function enter(page, path = '/') {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poolrooms.settings')) localStorage.setItem('poolrooms.settings', JSON.stringify({quality:'low',inputMode:'touch',reducedMotion:true}));
  });
  await page.goto(path);
  await expect.poll(()=>page.evaluate(()=>!!window.PR?.game?.world)).toBe(true);
  await expect(page.locator('#start-form button')).toHaveCount(1);
  await expect(page.locator('#btn-start')).toHaveAccessibleName('Start Exploring');
  await page.locator('#btn-start').click();
}

test('the river carries an idle swimmer around the bend and permits swimming against it', async ({page}) => {
  await enter(page);
  await page.locator('#btn-pause').click();
  const result=await page.evaluate(()=>{
    const {player,input,world}=PR.game;
    player.teleport(210,-1.37,49,0.45);
    for(let i=0;i<6600;i++) player.fixedStep(1/60);
    const end=player.position.toArray(), yaw=player.yaw;
    player.teleport(232,-1.37,92,Math.PI/2);
    input.state.moveZ=1;
    for(let i=0;i<240;i++) player.fixedStep(1/60);
    input.state.moveZ=0;
    return {end,yaw,upstream:player.position.x,water:world.waterAt(210,60),bank:world.currentAt(203,60),outside:world.currentAt(136,12)};
  });
  expect(result.end[0]).toBeGreaterThan(237);
  expect(result.end[0]).toBeLessThan(245);
  expect(result.end[2]).toBeCloseTo(92,0);
  expect(result.yaw).toBe(0.45);
  expect(result.upstream).toBeLessThan(229);
  expect(result.water).toBeCloseTo(-0.12,3);
  expect(result.bank).toBeNull(); expect(result.outside).toBeNull();
});

test('both river entrances and hidden room thresholds are traversable in both directions', async ({page})=>{
  await enter(page); await page.locator('#btn-pause').click();
  const routes=await page.evaluate(()=>{
    const {player,input,world}=PR.game;
    return [
      [210,38,Math.PI,210,44,'Lazy River'],[210,42,0,210,36,'Sunken Baths'],
      [246,92,-Math.PI/2,251,92,'Lantern Baths'],[250,92,Math.PI/2,244,92,'Lazy River'],
      [124,38,Math.PI,124,44,'Rain Garden'],[124,42,0,124,36,'Rain Hall'],
      [202,68,Math.PI/2,196,68,'Stillwater Nook'],[198,68,-Math.PI/2,204,68,'Lazy River'],
    ].map(([x,z,yaw,tx,tz,name])=>{
      player.teleport(x,0,z,yaw); input.state.moveZ=1;
      for(let i=0;i<110;i++) player.fixedStep(1/60);
      input.state.moveZ=0;
      return {name,actual:world.journey.roomAt(player.position.x,player.position.z)?.name,distance:Math.hypot(player.position.x-tx,player.position.z-tz)};
    });
  });
  for(const route of routes) { expect(route.actual,JSON.stringify(route)).toBe(route.name); expect(route.distance).toBeLessThan(4); }
});

test('river banks have usable exit steps and every saved checkpoint is on clear dry ground', async ({page})=>{
  await enter(page); await page.locator('#btn-pause').click();
  const result=await page.evaluate(checkpoints=>{
    const {player,input,world}=PR.game;
    const exits=[0,Math.PI].map(yaw=>{
      player.teleport(232,-1.37,92,yaw); input.state.moveZ=1;
      for(let i=0;i<210;i++) player.fixedStep(1/60);
      input.state.moveZ=0;
      return {position:player.position.toArray(),water:player.state.inWater,room:world.journey.roomAt(player.position.x,player.position.z)?.name};
    });
    const safe=Object.entries(checkpoints).map(([name,[x,y,z,yaw]])=>{
      player.teleport(x,y,z,yaw);
      for(let i=0;i<60;i++) player.fixedStep(1/60);
      return {name,position:player.position.toArray(),expected:[x,y,z],water:player.state.inWater,blocked:world.wallsNear(x,z).some(w=>x>w.x0-0.35&&x<w.x1+0.35&&z>w.z0-0.35&&z<w.z1+0.35&&y<w.y1&&y+1.75>w.y0)};
    });
    return {exits,safe};
  },CHECKPOINTS);
  for(const exit of result.exits) { expect(exit.position[1]).toBeCloseTo(0,2); expect(exit.water).toBe(false); expect(exit.room).toBe('Lazy River'); }
  for(const point of result.safe) { expect(point.position,point.name).toEqual(point.expected); expect(point.water,point.name).toBe(false); expect(point.blocked,point.name).toBe(false); }
});

test('room interactions respond through the nearby prompt and restore their state',async({page})=>{
  await enter(page);
  for(const [id,x,y,z,label] of [
    ['fountain',26,0,-16,'Pause the fountain'],['shutters',87,0,2,'Lower the shutters'],
    ['rain',110,0,-5,'Soften the rain'],['boat',191,0,4,'Float the paper boat'],
    ['locker',149.6,0,-71.8,'Open the little locker'],['bowl',240,0,17,'Sound the bowl'],
    ['sunshade',374,6,34,'Tilt the sunshade'],['lanterns',293.5,0,107,'Turn down the lanterns'],
  ]) {
    await page.evaluate(([x,y,z])=>PR.game.player.teleport(x,y,z,0),[x,y,z]);
    await expect(page.locator('#btn-interact')).toContainText(label);
    await page.locator('#btn-interact').click();
    await expect.poll(()=>page.evaluate(id=>JSON.parse(localStorage.getItem('poolrooms.walk')).interactions[id],id),{message:id}).toBe(true);
  }
  await expect.poll(()=>page.evaluate(()=>PR.game.world.journey.rainSources.every(source=>source.level===0.22))).toBe(true);
  const before=await page.evaluate(()=>PR.game.world.journey.root.getObjectByName('Paper boat').position.toArray());
  await expect.poll(()=>page.evaluate(before=>PR.game.world.journey.root.getObjectByName('Paper boat').position.distanceTo({x:before[0],y:before[1],z:before[2]}),before)).toBeGreaterThan(0.15);
  await page.reload(); await expect(page.locator('#btn-start')).toBeEnabled(); await page.locator('#btn-start').click();
  expect(await page.evaluate(()=>PR.game.world.interactions.filter(item=>item.value).map(item=>item.id))).toHaveLength(8);
  expect(await page.evaluate(()=>PR.game.world.journey.root.getObjectByName('Keepsake locker door').rotation.y)).toBeLessThan(-1);
});

test('discoveries are remembered once and a reload resumes safely from an underwater visit',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('poolrooms.settings',JSON.stringify({quality:'low',inputMode:'desktop',reducedMotion:true}));
    Element.prototype.requestPointerLock=()=>Promise.reject(new DOMException('Unavailable in test','NotAllowedError'));
  });
  await enter(page,'/poolrooms/');
  for(const [name,x,y,z] of [['Rain Garden',119,0,44],['Stillwater Nook',197,0,68],['Column Sea',287,-4.5,48]]) {
    await page.evaluate(([x,y,z])=>PR.game.player.teleport(x,y,z,0),[x,y,z]);
    await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('poolrooms.walk')).room)).toBe(name);
  }
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('poolrooms.walk')).discoveries.length)).toBe(3);
  await page.reload();
  await expect(page.locator('#start-form button')).toHaveCount(1);
  await expect(page.locator('#btn-start')).toHaveAccessibleName('Start Exploring');
  await expect(page.locator('.continue-caption')).toHaveCount(0);
  await expect(page.locator('#btn-start')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#start-overlay')).toBeHidden();
  expect(await page.evaluate(()=>PR.game.player.position.toArray())).toEqual(CHECKPOINTS['Column Sea'].slice(0,3));
  expect(await page.evaluate(()=>PR.game.player.state.inWater)).toBe(false);
  await page.locator('#btn-pause').click();
  await page.locator('.found-places summary').click();
  await expect(page.locator('.found-places li')).toHaveCount(3);
  await expect(page.locator('.revisit-places')).toHaveCount(0);
});

test('completing the walk unlocks only visited rooms and revisits leave the ending safely',async({page})=>{
  await enter(page);
  await page.evaluate(()=>PR.game.player.teleport(111,0,12,-1.5));
  await expect(page.locator('#arrival')).toContainText('Rain Hall');
  await page.evaluate(()=>PR.game.player.teleport(477.3,7,14,-Math.PI/2));
  await expect(page.locator('#btn-rest')).toBeVisible(); await page.locator('#btn-rest').click();
  await page.locator('#btn-pause').click(); await page.locator('.revisit-places summary').click();
  await expect(page.locator('.revisit-list button')).toHaveText(['Sun Pavilion','Rain Hall','Sky Pool']);
  await page.getByRole('button',{name:'Rain Hall',exact:true}).click();
  expect(await page.evaluate(()=>PR.game.resting)).toBe(false);
  expect(await page.evaluate(()=>PR.game.player.position.toArray())).toEqual(CHECKPOINTS['Rain Hall'].slice(0,3));
  await page.reload(); await page.locator('#btn-start').click();
  await page.locator('#btn-pause').click(); await expect(page.locator('.revisit-places')).toBeVisible();
});

for(const mode of ['touch','desktop']) test(`seated ${mode} free look keeps the player still and controls can be hidden and recovered`,async({page})=>{
  await enter(page);
  if(mode==='desktop') { await page.locator('#btn-pause').click(); await page.locator('#sel-input').selectOption('desktop'); await page.locator('#btn-resume').click(); }
  await page.evaluate(()=>PR.game.player.teleport(114.5,0,20,-Math.PI/2));
  await expect(page.locator('#btn-rest')).toBeVisible(); await page.locator('#btn-rest').click();
  await expect.poll(()=>page.evaluate(()=>PR.game.camera.position.x)).toBeCloseTo(112,2);
  const before=await page.evaluate(()=>({position:PR.game.player.position.toArray(),view:PR.game.camera.quaternion.toArray()}));
  await page.mouse.move(450,150); await page.mouse.down(); await page.mouse.move(550,200,{steps:8}); await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>PR.game.camera.quaternion.toArray())).not.toEqual(before.view);
  await page.keyboard.down('w'); await page.keyboard.press('Space'); await page.keyboard.up('w');
  expect(await page.evaluate(()=>PR.game.player.position.toArray())).toEqual(before.position);
  await page.locator('#quiet-rest .hide-seat-ui').click();
  await expect(page.locator('#quiet-rest')).toBeHidden(); await expect(page.locator('#hud')).toBeHidden();
  await page.mouse.click(400,160); await expect(page.locator('#quiet-rest')).toBeVisible();
  await page.keyboard.press('h'); await expect(page.locator('#quiet-rest')).toBeHidden();
  await page.keyboard.press('Escape'); await expect(page.locator('#pause-menu')).toBeVisible();
  await page.locator('#btn-resume').click(); await page.locator('#btn-leave-seat').click();
  expect(await page.evaluate(()=>PR.game.player.position.toArray())).toEqual(before.position);
});

test('malformed, foreign and obsolete saved walks do not restore arbitrary locations',()=>{
  for(const raw of [null,[],{version:1,seed:'ours',room:['Sky Pool']},{version:1,seed:'ours',room:'__proto__'},{version:1,seed:'other',room:'Sky Pool'},{version:99,seed:'ours',room:'Sky Pool'}]) expect(readProgress(raw,'ours')).toBeNull();
  const safe=readProgress({version:1,seed:'ours',room:'Rain Hall',visited:['Sky Pool','__proto__',42,'Sky Pool'],discoveries:['sun-mosaic','invalid'],interactions:{rain:'true',locker:true},completed:'true',position:[Infinity,NaN,-1e9]},'ours');
  expect(safe.visited).toEqual(['Sun Pavilion','Sky Pool','Rain Hall']);
  expect(safe.discoveries).toEqual(['sun-mosaic']); expect(safe.interactions).toEqual({locker:true}); expect(safe.completed).toBe(false); expect(safe.position).toBeUndefined();
});

test('a different share seed starts fresh and unavailable storage never prevents play',async({page})=>{
  await enter(page,'/#seed=first-walk');
  await page.evaluate(()=>PR.game.player.teleport(111,0,12,0));
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('poolrooms.walk')).room)).toBe('Rain Hall');
  await page.goto('/#seed=another-walk'); await page.reload();
  await expect(page.locator('#btn-continue')).toHaveCount(0); await page.locator('#btn-start').click();
  expect(await page.evaluate(()=>PR.game.player.position.toArray())).toEqual(CHECKPOINTS['Sun Pavilion'].slice(0,3));
  await page.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Storage disabled','SecurityError');};});
  await page.reload(); await page.locator('#btn-start').click();
  await expect(page.locator('#toast')).toContainText('cannot save your walk');
  expect(await page.evaluate(()=>PR.game.state)).toBe('playing');
  await page.locator('#btn-pause').click(); await page.locator('#btn-new-seed').click();
  expect(await page.evaluate(()=>PR.game.state)).toBe('playing');
  await expect(page.locator('#error-overlay')).toBeHidden();
});

test('Start Exploring and seated controls fit a phone and restarting clears discoveries',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  await enter(page);
  await page.evaluate(()=>PR.game.player.teleport(119,0,44,0));
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('poolrooms.walk')).discoveries.length)).toBe(1);
  await page.reload();
  await expect(page.locator('#start-form button')).toHaveCount(1);
  await expect(page.locator('#btn-start')).toHaveAccessibleName('Start Exploring');
  await expect(page.locator('#btn-start')).toBeInViewport();
  await page.locator('#btn-start').tap();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('poolrooms.walk')).discoveries)).toEqual(['rain-garden']);
  await page.evaluate(()=>PR.game.player.teleport(114.5,0,20,-Math.PI/2));
  await expect(page.locator('#btn-rest')).toBeVisible(); await page.locator('#btn-rest').tap();
  await expect(page.locator('#btn-leave-seat')).toBeInViewport(); await expect(page.locator('#quiet-rest .hide-seat-ui')).toBeInViewport();
  await page.locator('#quiet-rest .hide-seat-ui').tap(); await expect(page.locator('#quiet-rest')).toBeHidden();
  await page.touchscreen.tap(200,300); await expect(page.locator('#quiet-rest')).toBeVisible();
  await page.locator('#btn-pause').tap(); await page.locator('#btn-new-seed').tap();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('poolrooms.walk')).discoveries)).toEqual([]);
  expect(await page.evaluate(()=>PR.game.resting)).toBe(false);
  await context.close();
});

test('Pavilion recesses, slide shade and skylight patches visibly render at all qualities',async({page},testInfo)=>{
  const errors=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
  await page.setViewportSize({width:960,height:600}); await enter(page); await page.locator('#btn-pause').click();
  for(const quality of ['low','medium','high']) {
    await page.locator('#sel-quality').selectOption(quality);
    const result=await page.evaluate(()=>{
      const {world,renderer,scene,camera}=PR.game;
      world.update(7); camera.position.set(7,3.12,28); camera.lookAt(10,2,5); camera.updateMatrixWorld();
      const details=[]; world.group.traverse(object=>{if(['Pavilion arch recess','Pavilion slide shade','Pavilion skylight patch'].includes(object.name)) details.push(object);});
      const gl=renderer.getContext(),w=renderer.domElement.width,h=renderer.domElement.height;
      const frames=[false,true].map(visible=>{
        details.forEach(detail=>{detail.visible=visible;}); renderer.setRenderTarget(null);renderer.render(scene,camera);
        const pixels=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;
      });
      let changed=0;
      for(let i=0;i<frames[0].length;i+=4) if(Math.abs(frames[0][i]-frames[1][i])+Math.abs(frames[0][i+1]-frames[1][i+1])+Math.abs(frames[0][i+2]-frames[1][i+2])>6) changed++;
      return {changed,image:renderer.domElement.toDataURL('image/png')};
    });
    expect(result.changed,quality).toBeGreaterThan(100);
    await writeFile(testInfo.outputPath(`pavilion-${quality}.png`),Buffer.from(result.image.split(',')[1],'base64'));
  }
  expect(errors).toEqual([]);
});

for(const [name,x,y,z,yaw] of [['river',210,0,43,Math.PI],['river-bend',211,-1.37,82,-2.7],['rain-garden',119,0,44,-1.3],['stillwater',197,0,68,Math.PI/2]]) {
  test(`${name} renders within the existing Low budget`,async({page},testInfo)=>{
    const errors=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
    await page.setViewportSize({width:1280,height:800}); await enter(page);
    await page.evaluate(([x,y,z,yaw])=>PR.game.player.teleport(x,y,z,yaw),[x,y,z,yaw]);
    await expect.poll(()=>page.evaluate(()=>PR.game.camera.position.x)).toBeCloseTo(x,0);
    await page.screenshot({path:testInfo.outputPath(`${name}.png`)});
    const stats=await page.evaluate(()=>({calls:PR.game.renderer.info.render.calls,triangles:PR.game.renderer.info.render.triangles}));
    expect(stats.calls).toBeLessThan(180); expect(stats.triangles).toBeLessThan(250000); expect(errors).toEqual([]);
  });
}
