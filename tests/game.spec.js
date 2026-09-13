import { test, expect } from '@playwright/test';

test('Rain Hall ceiling lights leave clearance around every waterfall head', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('poolrooms.settings', JSON.stringify({quality:'low',inputMode:'touch'})));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!PR.game?.world)).toBe(true);
  const clearance = await page.evaluate(() => {
    const hall = PR.game.world.journey.root.getObjectByName('Rain Hall');
    const lights = [];
    // Inspect the actual batched ceiling disks, whose triangle fans share a center vertex.
    for (const mesh of hall.children) {
      if (!mesh.isMesh || mesh.material.color?.getHex() !== 0xffecc9) continue;
      const p = mesh.geometry.attributes.position, indices = mesh.geometry.index;
      const disks = new Map();
      for (let i=0;i<indices.count;i+=3) {
        const center = indices.getX(i+2), edge = indices.getX(i);
        if (Math.abs(p.getY(center)-25.96)>0.001 || Math.abs(p.getY(edge)-25.96)>0.001) continue;
        const radius = Math.hypot(p.getX(edge)-p.getX(center),p.getZ(edge)-p.getZ(center));
        if (radius>1) disks.set(center,{x:p.getX(center),z:p.getZ(center),radius});
      }
      lights.push(...disks.values());
    }
    const gaps=[];
    for (const light of lights) for (const x of [124,148]) for (const z of [-24,0,24]) {
      gaps.push(Math.hypot(light.x-x,light.z-z)-light.radius-3.02);
    }
    return {lights:lights.length,minimum:Math.min(...gaps)};
  });
  expect(clearance.lights).toBeGreaterThan(0);
  expect(clearance.minimum).toBeGreaterThan(1.5);
  await page.locator('#btn-start').click();
  await page.evaluate(() => { PR.game.player.teleport(118,0,14,-0.7); PR.game.player.pitch=1.05; });
  await expect.poll(() => page.evaluate(() => Math.abs(PR.game.scene.fog.far-95*0.78)), {timeout:10000}).toBeLessThan(0.7);
  await page.screenshot({path:testInfo.outputPath('rain-ceiling.png')});
});

test('side rooms connect in both directions and their pools have usable exits', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('poolrooms.settings', JSON.stringify({ quality:'low', inputMode:'touch' })));
  await page.goto('/poolrooms/');
  await expect.poll(() => page.evaluate(() => !!PR.game?.world)).toBe(true);
  const result = await page.evaluate(() => {
    const {world,player,input} = PR.game;
    const crossings = [];
    for(const [x,z] of [[136,-44],[272,72]]) for(const direction of [-1,1]) {
      player.teleport(x,0,z-direction*2,direction>0?Math.PI:0);
      input.state.moveZ=1;
      for(let i=0;i<90;i++) player.fixedStep(1/60);
      crossings.push((player.position.z-z)*direction);
    }
    const exits=[];
    for (const [x,z] of [[127,-61],[260,92]]) {
      player.teleport(x,world.floorAt(x,z),z,Math.PI/2);
      for(let i=0;i<240;i++) player.fixedStep(1/60);
      exits.push({wet:player.state.inWater,y:player.position.y});
    }
    // The rest of the shared wall remains solid beside the new doorway.
    player.teleport(145,0,-42,0);
    for(let i=0;i<120;i++) player.fixedStep(1/60);
    input.state.moveZ=0;
    return {crossings,exits,blocked:player.position.z,
      rain:world.journey.roomAt(110,-40)?.name,columns:world.journey.roomAt(240,68)?.name,
      gallery:world.journey.roomAt(136,-70)?.name,lanterns:world.journey.roomAt(272,108)?.name};
  });
  result.crossings.forEach(distance => expect(distance).toBeGreaterThan(1));
  result.exits.forEach(exit => { expect(exit.wet).toBe(false); expect(exit.y).toBeCloseTo(0,2); });
  expect(result.blocked).toBeGreaterThan(-44);
  expect(result.rain).toBe('Rain Hall'); expect(result.columns).toBe('Column Sea');
  expect(result.gallery).toBe('Changing Gallery'); expect(result.lanterns).toBe('Lantern Baths');
});

test('scenic seating pauses movement without triggering the ending', async ({ page }, testInfo) => {
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('poolrooms.settings', JSON.stringify({quality:'low',inputMode:'touch',reducedMotion:true})));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!PR.game?.world)).toBe(true);
  await page.locator('#btn-start').click();
  await page.evaluate(() => PR.game.player.teleport(114.5,0,20,-Math.PI/2));
  await expect(page.locator('#btn-rest')).toHaveText('Sit for a while E');
  await page.evaluate(() => { PR.game.player.velocity.set(0.5,0,0); PR.game.player.state.speed=0.5; });
  await page.locator('#btn-rest').click();
  await expect(page.locator('#quiet-rest')).toContainText('Let the rain fill the silence.');
  await expect(page.locator('#ending')).toBeHidden();
  await expect(page.locator('#touch-layer')).toBeHidden();
  await expect.poll(() => page.evaluate(() => PR.game.camera.position.x)).toBeCloseTo(112,2);
  expect(await page.evaluate(() => PR.game.player.velocity.length())).toBe(0);
  const before=await page.evaluate(()=>PR.game.player.position.toArray());
  await page.keyboard.press('w');
  expect(await page.evaluate(()=>PR.game.player.position.toArray())).toEqual(before);
  expect(await page.evaluate(()=>localStorage.getItem('poolrooms.completed'))).toBeNull();
  await page.screenshot({path:testInfo.outputPath('rain-seat.png')});
  await page.locator('#btn-pause').click();
  await expect(page.locator('#quiet-rest')).toBeHidden();
  await page.locator('#btn-resume').click();
  await expect(page.locator('#quiet-rest')).toBeVisible();
  await page.locator('#btn-leave-seat').click();
  await expect(page.locator('#quiet-rest')).toBeHidden();
  await expect(page.locator('#touch-layer')).toBeVisible();
  expect(await page.evaluate(()=>PR.game.player.position.toArray())).toEqual(before);
  expect(errors).toEqual([]);
});

test('the centered long pier keeps its chair distant and closes the former right-hand exit', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('poolrooms.settings',JSON.stringify({quality:'low',inputMode:'touch'})));
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>!!PR.game?.world)).toBe(true);
  const result=await page.evaluate(()=>{
    const {world,player,input}=PR.game;
    const middleRest=world.journey.restSpotAt(440,14,7);
    player.teleport(440,7,14,0); input.state.moveZ=1;
    for(let i=0;i<240;i++) player.fixedStep(1/60);
    const edge=player.position.z;
    player.teleport(400,6,32,-Math.PI/2);
    for(let i=0;i<120;i++) player.fixedStep(1/60);
    input.state.moveZ=0;
    const chair=world.journey.restSpotAt(477.3,14,7);
    return {middleRest,edge,oldExit:player.position.x,floor:world.floorAt(470,14),end:chair?.ending,chairZ:chair?.z};
  });
  expect(result.middleRest).toBeNull(); expect(result.edge).toBeGreaterThan(8);
  expect(result.floor).toBe(7); expect(result.end).toBe(true);
  expect(result.chairZ).toBe((-16+44)/2);
  expect(result.oldExit).toBeLessThan(404);
});

test('room arrivals fade away and the pause menu remembers the current place', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('poolrooms.settings', JSON.stringify({ quality: 'low', inputMode: 'touch' })));
  await page.goto('/poolrooms/');
  await expect.poll(() => page.evaluate(() => !!PR.game?.world)).toBe(true);
  await page.locator('#btn-start').click();
  await expect(page.locator('#arrival')).toContainText('Sun Pavilion');
  await page.evaluate(() => PR.game.player.teleport(51, 0, 21, -1.15));
  await expect(page.locator('#arrival')).toContainText('Blue Arcade');
  await expect(page.locator('#arrival')).toContainText('Follow the rhythm of the arches.');
  await expect(page.locator('#toast')).toBeHidden();
  await expect(page.locator('#arrival')).toBeHidden({ timeout: 10000 });
  await page.locator('#btn-pause').click();
  await expect(page.locator('#pause-menu .menu-eyebrow')).toHaveText('Blue Arcade');
});

test('ocean waves stay visible and animate on every quality setting', async ({ page }, testInfo) => {
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
  await page.setViewportSize({width:1280,height:800});
  await page.addInitScript(() => localStorage.setItem('poolrooms.settings', JSON.stringify({quality:'low',inputMode:'touch',reducedMotion:true})));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!PR.game?.world)).toBe(true);
  await page.locator('#btn-start').click();
  await page.evaluate(() => { PR.game.player.teleport(470,7,9,0); PR.game.player.pitch=-0.25; });
  await expect.poll(() => page.evaluate(() => PR.game.camera.far)).toBeGreaterThanOrEqual(1000);
  await expect.poll(() => page.evaluate(() => Math.abs(PR.game.scene.fog.far-95*1.15)), {timeout:10000}).toBeLessThan(0.7);
  await page.screenshot({path:testInfo.outputPath('ocean.png')});
  await page.locator('#btn-pause').click();
  for (const quality of ['low','medium','high']) {
    await page.locator('#sel-quality').selectOption(quality);
    const result = await page.evaluate(() => {
      const {renderer,scene,camera,world}=PR.game;
      const gl=renderer.getContext(), w=renderer.domElement.width, h=renderer.domElement.height;
      const width=Math.floor(w*0.2), height=Math.floor(h*0.12);
      // Render two fixed moments while paused: only the water changes in this ocean-only crop.
      const frames=[3,5].map(t=>{
        world.setTime(t); renderer.setRenderTarget(null); renderer.render(scene,camera);
        const pixels=new Uint8Array(width*height*4);
        gl.readPixels(Math.floor(w*0.4),Math.floor(h*0.3),width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        return pixels;
      });
      let difference=0, blue=0;
      for(let i=0;i<frames[0].length;i+=4) {
        for(let c=0;c<3;c++) difference+=Math.abs(frames[0][i+c]-frames[1][i+c]);
        blue+=frames[0][i+2]-frames[0][i];
      }
      const ocean=world.group.getObjectByName('Ocean beyond the overlook');
      const pool=world.group.getObjectByName('Sky Pool water');
      return {difference:difference/(width*height*3),blue:blue/(width*height),opaque:!ocean.material.transparent,
        poolTransparent:pool.material.transparent,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
    });
    expect(result.difference,quality).toBeGreaterThan(0.5);
    expect(result.blue,quality).toBeGreaterThan(10);
    expect(result.opaque).toBe(true); expect(result.poolTransparent).toBe(true);
    expect(result.calls,quality).toBeLessThan(180);
    expect(result.triangles,quality).toBeLessThan(250000);
    await testInfo.attach(`ocean-${quality}`,{body:JSON.stringify(result),contentType:'application/json'});
  }
  await page.locator('#btn-resume').click();
  await page.evaluate(() => PR.game.player.teleport(51,0,21,-Math.PI/2));
  await expect.poll(() => page.evaluate(() => PR.game.camera.far)).toBeLessThan(300);
  expect(errors).toEqual([]);
});

test('reduced motion follows the system preference, steadies walking, and persists an override', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    if (!localStorage.getItem('poolrooms.settings')) localStorage.setItem('poolrooms.settings', JSON.stringify({ quality: 'low', inputMode: 'touch' }));
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!PR.game?.world)).toBe(true);
  expect(await page.evaluate(() => PR.game.settings.reducedMotion)).toBe(true);
  const steady = await page.evaluate(() => {
    const { player, input, camera } = PR.game;
    player.teleport(52, 0, 22, -Math.PI / 2);
    input.state.moveZ = 1;
    const heights = [];
    for (let i = 0; i < 100; i++) {
      player.fixedStep(1 / 60); player.updateCamera(1);
      heights.push(camera.position.y - player.position.y);
    }
    input.state.moveZ = 0;
    return { variation: Math.max(...heights) - Math.min(...heights), distance: player.position.x - 52 };
  });
  expect(steady.distance).toBeGreaterThan(2);
  expect(steady.variation).toBeLessThan(0.0001);
  await page.locator('#btn-start').click();
  await expect(page.locator('#arrival')).toHaveCSS('animation-name', 'none');
  await page.evaluate(() => PR.game.player.teleport(477.3, 7, 14, -Math.PI / 2));
  await expect(page.locator('#btn-rest')).toBeVisible();
  await page.locator('#btn-rest').click();
  await expect.poll(() => page.evaluate(() => PR.game.camera.position.x), { timeout: 1000 }).toBeCloseTo(480, 4);
  await expect(page.locator('.ending-titles')).toHaveCSS('opacity', '1');
  await page.locator('#btn-pause').click();
  await expect(page.locator('#chk-motion')).toBeChecked();
  await page.locator('#chk-motion').uncheck();
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!PR.game?.world)).toBe(true);
  expect(await page.evaluate(() => PR.game.settings.reducedMotion)).toBe(false);
});

test('moving through water leaves bounded ripples at the pool surface', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => localStorage.setItem('poolrooms.settings', JSON.stringify({ quality: 'low', inputMode: 'touch' })));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!PR.game?.world)).toBe(true);
  const result = await page.evaluate(() => {
    const { world, player, input } = PR.game;
    const water = world.group.getObjectByName('Sky Pool water');
    player.teleport(360, 4.6, 10, 0);
    input.state.moveZ = 1;
    for (let i = 1; i <= 90; i++) { player.fixedStep(1 / 60); world.setTime(i / 60, player); }
    input.state.moveZ = 0;
    const active = water.material.uniforms.uRipples.value.filter(r => r.w > 0);
    const before = active.map(r => r.z);
    player.velocity.set(0, 0, 0); player.state.speed = 0;
    for (let i = 91; i <= 150; i++) world.setTime(i / 60, player);
    const after = water.material.uniforms.uRipples.value.filter(r => r.w > 0).map(r => r.z);
    return { count: active.length, before, after, heights: Array.from(water.material.uniforms.uRippleHeights.value).slice(0, active.length) };
  });
  expect(result.count).toBeGreaterThan(1);
  expect(result.count).toBeLessThanOrEqual(8);
  expect(result.after).toEqual(result.before);
  result.heights.forEach(height => expect(height).toBeCloseTo(5.88, 2));
  await page.locator('#btn-start').click();
  await expect.poll(() => page.evaluate(() => PR.game.renderer.info.render.calls)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('room lighting settles gradually and restarting restores the Pavilion atmosphere', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('poolrooms.settings', JSON.stringify({ quality: 'low', inputMode: 'touch' })));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!PR.game?.world)).toBe(true);
  await page.locator('#btn-start').click();
  const initial = await page.evaluate(() => PR.game.scene.fog.far);
  await page.evaluate(() => PR.game.player.teleport(240, 0, 12, -Math.PI / 2));
  await expect.poll(() => page.evaluate(() => PR.game.scene.fog.far), { timeout: 10000 }).toBeLessThan(initial * 0.8);
  await page.locator('#btn-pause').click();
  await page.locator('#btn-new-seed').click();
  await expect.poll(() => page.evaluate(() => PR.game.scene.fog.far)).toBeCloseTo(initial, 1);
  await expect(page.locator('#error-overlay')).toBeHidden();
});

for (const path of ['/', '/poolrooms/']) {
  test(`loads, plays and persists settings at ${path}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(response.url()); });
    await page.addInitScript(() => { if (!localStorage.getItem('poolrooms.settings')) localStorage.setItem('poolrooms.settings', JSON.stringify({ quality: 'low', inputMode: 'touch' })); });
    await page.goto(`${path}#seed=react-test&depth=2&mode=drains`);
    await expect(page.locator('#btn-start')).toBeEnabled();
    await expect.poll(() => page.evaluate(() => !!window.PR?.game?.world)).toBe(true);
    await expect(page.locator('#error-overlay')).toBeHidden();
    await expect(page.getByText('World variation', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => PR.game.seed)).toBe('react-test');
    await page.locator('#btn-start').click();
    await expect(page.locator('#start-overlay')).toBeHidden();
    await expect(page.locator('#hud-depth')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => PR.game.depth)).toBe(0);
    await expect(page.locator('#touch-layer')).toBeVisible();
    await page.locator('#btn-pause').click();
    await expect(page.locator('#pause-menu')).toBeVisible();
    await page.locator('#chk-invert').check();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('poolrooms.settings')).invertY)).toBe(true);
    await page.locator('#btn-resume').click();
    await expect(page.locator('#pause-menu')).toBeHidden();
    await expect(page).not.toHaveURL(/depth=/);
    await page.reload();
    await expect(page.locator('#btn-start')).toBeEnabled();
    await page.locator('#btn-start').click();
    await expect(page.locator('#hud-depth')).toHaveCount(0);
    await page.locator('#btn-pause').click();
    await expect(page.locator('#chk-invert')).toBeChecked();
    await expect(page.locator('#error-overlay')).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test('mobile entrance has simple exploration controls', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('/poolrooms/');
  await expect(page.locator('#btn-start')).toBeEnabled();
  await expect(page.locator('#seed-input')).toHaveCount(0);
  await expect(page.getByText('World variation', { exact: true })).toHaveCount(0);
  await page.getByText('How to explore', { exact: true }).click();
  await expect(page.locator('#hints-touch')).toBeVisible();
  await expect(page.locator('#mode-toggle')).toHaveCount(0);
  await page.locator('#btn-start').click();
  await expect.poll(() => page.evaluate(() => PR.game.mode)).toBe('wander');
  await expect(page.locator('#compass')).toBeHidden();
  await expect(page.locator('.hud-depth')).toHaveCount(0);
  await expect(page.locator('#btn-pause')).toBeVisible();
  await page.locator('#btn-pause').click();
  await expect(page.locator('#pause-menu')).toBeVisible();
  await context.close();
});

test('desktop movement and pause when pointer lock is refused', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('poolrooms.settings', JSON.stringify({ quality: 'low', inputMode: 'desktop' }));
    Element.prototype.requestPointerLock = () => Promise.reject(new DOMException('Unavailable in test', 'NotAllowedError'));
  });
  await page.goto('/#seed=desktop-test');
  await expect.poll(() => page.evaluate(() => !!window.PR?.game?.world)).toBe(true);
  await page.locator('#btn-start').click();
  await expect(page.locator('#toast')).toContainText('capture the mouse');
  const before = await page.evaluate(() => window.PR.game.player.position.toArray());
  await page.keyboard.down('w');
  await expect.poll(async () => page.evaluate(before => window.PR.game.player.position.distanceTo({ x: before[0], y: before[1], z: before[2] }), before)).toBeGreaterThan(0.1);
  await page.keyboard.up('w');
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('WebGL failure displays a readable error', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type.startsWith('webgl') ? null : getContext.call(this, type, ...args);
    };
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#error-message')).toContainText('WebGL');
  await expect(page.locator('#start-overlay')).toBeHidden();
});


test('pavilion stairs lead to a complete slide ride and teleport cancels a ride', async ({ page }) => {
  await page.goto('/#seed=pavilion-route&mode=wander');
  await expect.poll(() => page.evaluate(() => !!window.PR?.game?.world)).toBe(true);
  // The menu stops animation. Advance the public controller deterministically to exercise
  // collision, steps, the landing, the actual slide trigger, and swimming after splashdown.
  const route = await page.evaluate(() => {
    const { player, input, world } = PR.game;
    player.teleport(37, 0, 38, 0);
    input.state.moveZ = 1;
    for (let i = 0; i < 312; i++) player.fixedStep(1 / 60);
    const landing = player.position.toArray();
    player.applyLook(-Math.PI / 2, 0);
    for (let i = 0; i < 100; i++) player.fixedStep(1 / 60);
    input.state.moveZ = 0;
    const riding = player.position.toArray();
    for (let i = 0; i < 480; i++) player.fixedStep(1 / 60);
    const splashdown = { position: player.position.toArray(), swimming: player.state.swimming, water: world.waterAt(player.position.x, player.position.z) };
    player.teleport(32, 6, 20.5, 0);
    for (let i = 0; i < 30; i++) player.fixedStep(1 / 60);
    player.teleport(37, 0, 40, 0);
    for (let i = 0; i < 60; i++) player.fixedStep(1 / 60);
    return { landing, riding, splashdown, reset: player.position.toArray() };
  });
  expect(route.landing[1]).toBeCloseTo(6, 2);
  expect(route.landing[2]).toBeGreaterThan(19);
  expect(route.landing[2]).toBeLessThan(22);
  expect(route.riding[0]).toBeLessThan(32);
  expect(route.riding[1]).toBeGreaterThan(3);
  expect(route.splashdown.swimming).toBe(true);
  expect(route.splashdown.water).toBeCloseTo(-0.12, 2);
  expect(route.splashdown.position[0]).toBeGreaterThan(15);
  expect(route.splashdown.position[0]).toBeLessThan(25);
  expect(route.reset).toEqual([37, 0, 40]);
});

test('curved lagoon permits entering, swimming, and climbing back onto the deck', async ({ page }) => {
  await page.goto('/#seed=pavilion-swim&mode=wander');
  await expect.poll(() => page.evaluate(() => !!window.PR?.game?.world)).toBe(true);
  const result = await page.evaluate(() => {
    const { player, input, world } = PR.game;
    player.teleport(20, 0, 24, 0);
    input.state.moveZ = 1;
    for (let i = 0; i < 360; i++) player.fixedStep(1 / 60);
    const swimming = player.state.swimming;
    input.state.moveZ = -1;
    for (let i = 0; i < 600; i++) player.fixedStep(1 / 60);
    input.state.moveZ = 0;
    return { swimming, exited: !player.state.inWater, y: player.position.y, z: player.position.z, dry: !Number.isFinite(world.waterAt(player.position.x, player.position.z)) };
  });
  expect(result.swimming).toBe(true);
  expect(result.exited).toBe(true);
  expect(result.dry).toBe(true);
  expect(result.y).toBeCloseTo(0, 2);
  expect(result.z).toBeGreaterThan(21);
});

test('pavilion stays continuous across chunk boundaries and its exit remains traversable', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('poolrooms.settings', JSON.stringify({ quality: 'low', inputMode: 'touch' })));
  await page.goto('/#seed=pavilion-seams&mode=wander');
  await expect.poll(() => page.evaluate(() => !!window.PR?.game?.world)).toBe(true);
  const result = await page.evaluate(() => {
    const { player, input, world } = PR.game;
    const positions = [];
    for (const x of [-2, 22, 46]) {
      const z = x === 46 ? 12 : 43;
      player.teleport(x, 0, z, -Math.PI / 2);
      input.state.moveZ = 1;
      for (let i = 0; i < 90; i++) {
        player.fixedStep(1 / 60);
        world.update(player.position.x, player.position.z, 2);
      }
      positions.push(player.position.x);
    }
    input.state.moveZ = 0;
    world.update(250, 250, 100);
    world.update(7, 28, 100);
    return { positions, restoredFloor: world.floorAt(7, 28), restoredPool: world.waterAt(10, 5) };
  });
  expect(result.positions[0]).toBeGreaterThan(2);
  expect(result.positions[1]).toBeGreaterThan(26);
  expect(result.positions[2]).toBeGreaterThan(49);
  expect(result.restoredFloor).toBe(1.5);
  expect(result.restoredPool).toBeCloseTo(-0.12, 2);
});

test('reflected water renders on medium and high without shader errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/#seed=pavilion-reflections');
  for (const quality of ['medium', 'high']) {
    await page.evaluate(quality => localStorage.setItem('poolrooms.settings', JSON.stringify({ quality, inputMode: 'touch' })), quality);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!window.PR?.game?.world)).toBe(true);
    await expect.poll(() => page.evaluate(() => PR.game.settings.quality)).toBe(quality);
    await page.locator('#btn-start').click();
    await expect.poll(() => page.evaluate(() => PR.game.renderer.info.render.calls)).toBeGreaterThan(0);
    await page.locator('#btn-pause').click();
    await page.locator('#btn-resume').click();
    await expect(page.locator('#error-overlay')).toBeHidden();
  }
  expect(errors).toEqual([]);
});


test('walking into a beach ball pushes it while it stays in the lagoon', async ({ page }) => {
  await page.goto('/#seed=pavilion-balls&mode=wander');
  await expect.poll(() => page.evaluate(() => !!window.PR?.game?.world)).toBe(true);
  const result = await page.evaluate(() => {
    const { player, input, world } = PR.game;
    const ball = world.group.getObjectByName('Beach ball');
    const initial = ball.position.clone();
    player.teleport(initial.x, world.floorAt(initial.x, initial.z + 2), initial.z + 2, 0);
    input.state.moveZ = 1;
    for (let i = 1; i <= 180; i++) {
      player.fixedStep(1 / 60);
      player.updateCamera(1);
      world.setTime(i / 60);
    }
    input.state.moveZ = 0;
    return { moved: ball.position.distanceTo(initial), water: world.waterAt(ball.position.x, ball.position.z), height: ball.position.y };
  });
  expect(result.moved).toBeGreaterThan(0.3);
  expect(result.water).toBeCloseTo(-0.12, 2);
  expect(result.height).toBeGreaterThan(result.water);
});

test('Rain Hall and Sky Pool stairs lead to complete slide rides and rides reset on teleport', async ({ page }) => {
  await page.goto('/#seed=more-slides');
  await expect.poll(() => page.evaluate(() => !!PR.game?.world)).toBe(true);
  const rides = await page.evaluate(() => {
    const { player,input,world } = PR.game;
    return [[160,21,8.5,4,0,'Rain Slide'],[395,10,-1.25,3.5,6,'Sunset Slide']].map(([x,z,top,height,base,name]) => {
      player.teleport(x,base,z,0);
      input.state.moveZ=1;
      let steps=0;
      while(player.position.z>top+0.05 && steps++<400) player.fixedStep(1/60);
      const landing=player.position.toArray();
      player.yaw=Math.PI/2;
      for(let i=0;i<45;i++) player.fixedStep(1/60);
      input.state.moveZ=0;
      const riding=player.position.toArray();
      for(let i=0;i<420;i++) player.fixedStep(1/60);
      const end={position:player.position.toArray(),swimming:player.state.swimming,water:world.waterAt(player.position.x,player.position.z)};
      player.teleport(x-2,base+height,top,0);
      for(let i=0;i<30;i++) player.fixedStep(1/60);
      player.teleport(x,base,z,0);
      for(let i=0;i<60;i++) player.fixedStep(1/60);
      return {name,base,height,x,z,landing,riding,end,reset:player.position.toArray(),mesh:!!world.group.getObjectByName(name)};
    });
  });
  for(const ride of rides) {
    expect(ride.mesh,ride.name).toBe(true);
    expect(ride.landing[1],ride.name).toBeCloseTo(ride.base+ride.height,2);
    expect(ride.riding[0],ride.name).toBeLessThan(ride.x-2);
    expect(ride.riding[1],ride.name).toBeGreaterThan(ride.base+2);
    expect(ride.end.swimming,ride.name).toBe(true);
    expect(ride.end.water,ride.name).toBeCloseTo(ride.base-0.12,2);
    expect(ride.reset,ride.name).toEqual([ride.x,ride.base,ride.z]);
  }
});

test('new beach balls can be pushed and float at each room water level', async ({ page }) => {
  await page.goto('/#seed=more-balls');
  await expect.poll(() => page.evaluate(() => !!PR.game?.world)).toBe(true);
  const balls = await page.evaluate(() => {
    const {player,input,world}=PR.game;
    let time=0;
    return ['Rain Hall','Sky Pool','Lantern Baths'].map(name=>{
      const room=world.journey.root.getObjectByName(name);
      const items=room.children.filter(child=>child.name==='Beach ball');
      const ball=items[0], initial=ball.position.clone();
      const water=world.waterAt(initial.x,initial.z);
      player.teleport(initial.x,water-1.25,initial.z+2,0);
      world.update(initial.x,initial.z);
      input.state.moveZ=1;
      for(let i=0;i<180;i++) {
        player.fixedStep(1/60); player.updateCamera(1); world.setTime(time+=1/60);
      }
      input.state.moveZ=0;
      return {name,count:items.length,moved:Math.hypot(ball.position.x-initial.x,ball.position.z-initial.z),water:world.waterAt(ball.position.x,ball.position.z),expectedWater:water,height:ball.position.y+room.position.y};
    });
  });
  for(const ball of balls) {
    expect(ball.count,ball.name).toBeGreaterThanOrEqual(2);
    expect(ball.moved,ball.name).toBeGreaterThan(0.3);
    expect(ball.water,ball.name).toBeCloseTo(ball.expectedWater,2);
    expect(ball.height,ball.name).toBeGreaterThan(ball.water);
    expect(ball.height-ball.water,ball.name).toBeLessThan(1);
  }
});

test('deeper Rain Hall and Column Sea pools allow diving, surfacing and climbing out on every side', async ({ page }) => {
  await page.goto('/#seed=deeper-pools');
  await expect.poll(() => page.evaluate(() => !!PR.game?.world)).toBe(true);
  const pools=await page.evaluate(()=>{
    const {player,input,world}=PR.game;
    return [
      {name:'Rain Hall',x:136,z:-12,depth:3.5,edges:[[119,-12,Math.PI/2],[153,-12,-Math.PI/2],[136,-33,0],[136,29,Math.PI]]},
      {name:'Column Sea',x:278,z:38,depth:4.5,edges:[[246,38,Math.PI/2],[298,38,-Math.PI/2],[278,-38,0],[278,62,Math.PI]]},
    ].map(pool=>{
      player.teleport(pool.x,-1.37,pool.z,0);
      input.state.downHeld=true;
      for(let i=0;i<240;i++) player.fixedStep(1/60);
      const dive={y:player.position.y,underwater:player.state.underwater};
      input.state.downHeld=false; input.state.jumpHeld=true;
      for(let i=0;i<240;i++) player.fixedStep(1/60);
      const surface={y:player.position.y,underwater:player.state.underwater};
      input.state.jumpHeld=false;
      const exits=pool.edges.map(([x,z,yaw])=>{
        player.teleport(x,world.floorAt(x,z),z,yaw);
        input.state.moveZ=1;
        for(let i=0;i<180;i++) player.fixedStep(1/60);
        input.state.moveZ=0;
        return {inWater:player.state.inWater,y:player.position.y};
      });
      return {...pool,dive,surface,exits,shaderDepth:world.group.getObjectByName(pool.name+' water').material.uniforms.uDepth.value};
    });
  });
  for(const pool of pools) {
    expect(pool.dive.y,pool.name).toBeCloseTo(-pool.depth,2);
    expect(pool.dive.underwater,pool.name).toBe(true);
    expect(pool.surface.y,pool.name).toBeGreaterThan(-1.5);
    expect(pool.surface.underwater,pool.name).toBe(false);
    expect(pool.shaderDepth,pool.name).toBe(pool.depth);
    for(const exit of pool.exits) {
      expect(exit.inWater,pool.name).toBe(false);
      expect(exit.y,pool.name).toBeCloseTo(0,2);
    }
  }
});


test('the designed walk connects every room and all pools have usable steps', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('poolrooms.settings', JSON.stringify({ quality: 'low', inputMode: 'touch' })));
  await page.goto('/poolrooms/#seed=journey');
  await expect.poll(() => page.evaluate(() => !!PR.game?.world)).toBe(true);
  const route = await page.evaluate(() => {
    const {world, player, input} = PR.game;
    // Walk each threshold in both directions using the real controller and collision.
    const crossings = [];
    for (const [x,z] of [[48,12],[96,12],[108,12],[164,28],[176,28],[224,12],[236,12],[308,12],[336,12]]) {
      for (const direction of [1,-1]) {
        player.teleport(x-direction*2,world.floorAt(x-direction*2,z),z,-direction*Math.PI/2);
        input.state.moveZ=1;
        for(let i=0;i<90;i++) { player.fixedStep(1/60); world.update(player.position.x,player.position.z); }
        crossings.push({x, z, direction, reached:player.position.x});
      }
    }
    const exits=[];
    for (const [x,z] of [[60,12],[120,12],[190,14],[210,28],[248,28],[350,10]]) {
      player.teleport(x,world.floorAt(x,z),z,-Math.PI/2);
      input.state.moveZ=-1;
      for(let i=0;i<240;i++) player.fixedStep(1/60);
      exits.push({x, y:player.position.y, inWater:player.state.inWater});
    }
    input.state.moveZ=0;
    return {crossings, exits, drains:world.stats().drains};
  });
  for (const c of route.crossings) expect((c.reached-c.x)*c.direction, JSON.stringify(c)).toBeGreaterThan(1);
  for (const p of route.exits) { expect(p.inWater, JSON.stringify(p)).toBe(false); expect(p.y).toBeGreaterThanOrEqual(0); }
  expect(route.drains).toBe(0);
});

test('resting ends the journey, pauses safely, and allows exploration to continue', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('poolrooms.settings', JSON.stringify({quality:'low',inputMode:'touch'})));
  await page.goto('/poolrooms/');
  await expect.poll(() => page.evaluate(() => !!PR.game?.world)).toBe(true);
  await page.locator('#btn-start').click();
  await expect(page.locator('#btn-rest')).toBeHidden();
  await page.keyboard.press('e');
  expect(await page.evaluate(()=>PR.game.resting)).toBe(false);
  await page.evaluate(()=>PR.game.player.teleport(477.3,7,14,-Math.PI/2));
  await expect(page.locator('#btn-rest')).toBeVisible();
  await page.locator('#btn-rest').click();
  await expect(page.locator('#ending')).toBeVisible();
  await expect(page.locator('.ending-titles')).toHaveCSS('opacity','1',{timeout:10000});
  await page.screenshot({path:testInfo.outputPath('ending.png')});
  expect(await page.evaluate(()=>PR.game.camera.getWorldDirection(PR.game.player.velocity.clone()).x)).toBeGreaterThan(0.99);
  await expect(page.locator('#touch-layer')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('poolrooms.completed')))).toBe(true);
  await page.locator('#btn-pause').click();
  await expect(page.locator('#pause-menu')).toBeVisible();
  await expect(page.locator('#ending')).toBeHidden();
  await page.locator('#btn-resume').click();
  await expect(page.locator('#ending')).toBeVisible();
  await page.locator('#btn-get-up').click();
  await expect(page.locator('#ending')).toBeHidden();
  await expect(page.locator('#touch-layer')).toBeVisible();
  expect(await page.evaluate(()=>PR.game.resting)).toBe(false);
  await page.locator('#btn-pause').click();
  await page.locator('#btn-new-seed').click();
  expect(await page.evaluate(()=>PR.game.player.position.x)).toBeLessThan(48);
});

// Independent views keep screenshot work bounded on GitHub's software renderer.
for (const [name,x,z,yaw] of [['arcade',51,21,-1.15],['rain',111,12,-1.57],['rain-slide',160,25,0.65],['baths',180,28,-1.2],['columns',240,12,-1.57],['sky',340,12,-1.3],['sunset-slide',394,16,0.6],['gallery',120,-48,-0.8],['lanterns',251,76,-2.3],['pier',408,14,-Math.PI/2]]) {
  test(`${name} renders within the low-quality draw budget`, async ({ page }, testInfo) => {
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
    await page.setViewportSize({width:1280,height:800});
    await page.addInitScript(()=>localStorage.setItem('poolrooms.settings',JSON.stringify({quality:'low',inputMode:'touch'})));
    await page.goto('/poolrooms/');
    await expect.poll(()=>page.evaluate(()=>!!PR.game?.world)).toBe(true);
    await page.locator('#btn-start').click();
    await page.evaluate(({x,z,yaw})=>PR.game.player.teleport(x,PR.game.world.floorAt(x,z),z,yaw),{x,z,yaw});
    await expect.poll(()=>page.evaluate(x=>Math.abs(PR.game.camera.position.x-x),x)).toBeLessThan(1);
    // Capture the destination's settled lighting instead of the previous room's first frame.
    const haze = { arcade: 0.88, rain: 0.78, 'rain-slide': 0.78, baths: 0.84, columns: 0.72, sky: 1.15, 'sunset-slide': 1.15, gallery: 0.9, lanterns: 0.88, pier: 1.15 }[name];
    await expect.poll(() => page.evaluate(target => Math.abs(PR.game.scene.fog.far - target), 95 * haze), { timeout: 10000 }).toBeLessThan(0.7);
    await page.screenshot({path:testInfo.outputPath(`${name}.png`)});
    const stats=await page.evaluate(()=>({calls:PR.game.renderer.info.render.calls,triangles:PR.game.renderer.info.render.triangles}));
    expect(stats.calls,name).toBeLessThan(180);
    expect(stats.triangles,name).toBeLessThan(250000);
    await testInfo.attach('render-budget',{body:JSON.stringify({name,...stats},null,2),contentType:'application/json'});
    expect(errors).toEqual([]);
  });
}


test('a continuous walk reaches the Sky Pool without teleporting between rooms', async ({page}) => {
  await page.addInitScript(()=>localStorage.setItem('poolrooms.settings',JSON.stringify({quality:'low',inputMode:'touch'})));
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>!!PR.game?.world)).toBe(true);
  const result=await page.evaluate(()=>{
    const {player,world,input}=PR.game;
    player.teleport(46,0,12,-Math.PI/2);
    const points=[[51,12],[51,22],[93,22],[93,12],[110,12],[110,36],[162,36],[162,28],[179,28],[201,28],[201,18],[222,18],[222,12],[240,12],[304,12],[340,12],[340,28],[397,28],[397,14],[477.3,14]];
    const reached=[];
    for(const [x,z] of points) {
      let steps=0;
      while(Math.hypot(player.position.x-x,player.position.z-z)>0.25 && steps++<2400) {
        player.yaw=Math.atan2(-(x-player.position.x),-(z-player.position.z));
        input.state.moveZ=1;
        player.fixedStep(1/60); world.update(player.position.x,player.position.z);
      }
      reached.push({target:[x,z],distance:Math.hypot(player.position.x-x,player.position.z-z)});
      if(steps>=2400) break;
    }
    input.state.moveZ=0;
    return {chunks:world.stats().chunks,reached,position:player.position.toArray(),canRest:world.journey.restAvailable(player.position.x,player.position.z,player.position.y)};
  });
  expect(result.reached).toHaveLength(20);
  for(const point of result.reached) expect(point.distance,JSON.stringify(point)).toBeLessThan(0.3);
  expect(result.position[1]).toBeCloseTo(7,1);
  expect(result.canRest).toBe(true);
  expect(result.chunks).toBe(9);
});


test('the ocean overlook has walkable steps, a return route, and solid edge rails', async ({page}) => {
  await page.addInitScript(()=>localStorage.setItem('poolrooms.settings',JSON.stringify({quality:'low',inputMode:'touch'})));
  await page.goto('/poolrooms/');
  await expect.poll(()=>page.evaluate(()=>!!PR.game?.world)).toBe(true);
  const result=await page.evaluate(()=>{
    const {player,input,world}=PR.game;
    player.teleport(478,7,10,-Math.PI/2);
    input.state.moveZ=1;
    for(let i=0;i<240;i++) player.fixedStep(1/60);
    const edge=player.position.toArray();
    player.teleport(477.3,7,14,Math.PI/2);
    for(let i=0;i<1500;i++) player.fixedStep(1/60);
    input.state.moveZ=0;
    return {edge,returned:player.position.toArray(),oldChair:world.journey.restAvailable(394,32,6),ocean:!!world.group.getObjectByName('Ocean beyond the overlook')};
  });
  expect(result.edge[0]).toBeGreaterThan(483);
  expect(result.edge[0]).toBeLessThan(484);
  expect(result.edge[1]).toBeCloseTo(7,1);
  expect(result.returned[0]).toBeLessThan(400);
  expect(result.returned[1]).toBeCloseTo(6,1);
  expect(result.oldChair).toBe(false);
  expect(result.ocean).toBe(true);
});
