import { test, expect } from '@playwright/test';

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
    await page.locator('.journey-options summary').click();
    await expect(page.locator('#seed-input')).toHaveValue('react-test');
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

test('mobile seed input and exploration controls', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('/poolrooms/');
  await expect(page.locator('#btn-start')).toBeEnabled();
  await page.locator('.journey-options summary').click();
  await page.locator('#seed-input').fill('HELLO ! pool');
  await expect(page.locator('#seed-input')).toHaveValue('hellopool');
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

test('resting ends the journey, pauses safely, and allows exploration to continue', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('poolrooms.settings', JSON.stringify({quality:'low',inputMode:'touch'})));
  await page.goto('/poolrooms/');
  await expect.poll(() => page.evaluate(() => !!PR.game?.world)).toBe(true);
  await page.locator('#btn-start').click();
  await expect(page.locator('#btn-rest')).toBeHidden();
  await page.keyboard.press('e');
  expect(await page.evaluate(()=>PR.game.resting)).toBe(false);
  await page.evaluate(()=>PR.game.player.teleport(410.3,7,32,-Math.PI/2));
  await expect(page.locator('#btn-rest')).toBeVisible();
  await page.locator('#btn-rest').click();
  await expect(page.locator('#ending')).toBeVisible();
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

test('new rooms render within the low-quality draw budget', async ({ page }, testInfo) => {
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
  await page.setViewportSize({width:1280,height:800});
  await page.addInitScript(()=>localStorage.setItem('poolrooms.settings',JSON.stringify({quality:'low',inputMode:'touch'})));
  await page.goto('/poolrooms/');
  await expect.poll(()=>page.evaluate(()=>!!PR.game?.world)).toBe(true);
  await page.locator('#btn-start').click();
  const metrics=[];
  for (const [name,x,z,yaw] of [['arcade',51,21,-1.15],['rain',111,12,-1.57],['baths',180,28,-1.2],['columns',240,12,-1.57],['sky',340,12,-1.3]]) {
    await page.evaluate(({x,z,yaw})=>PR.game.player.teleport(x,PR.game.world.floorAt(x,z),z,yaw),{x,z,yaw});
    await expect.poll(()=>page.evaluate(x=>Math.abs(PR.game.camera.position.x-x),x)).toBeLessThan(1);
    await page.screenshot({path:testInfo.outputPath(`${name}.png`)});
    const stats=await page.evaluate(()=>({calls:PR.game.renderer.info.render.calls,triangles:PR.game.renderer.info.render.triangles}));
    metrics.push({name,...stats});
    expect(stats.calls,name).toBeLessThan(180);
    expect(stats.triangles,name).toBeLessThan(250000);
  }
  await page.evaluate(()=>PR.game.player.teleport(410.3,7,32,-Math.PI/2));
  await expect(page.locator('#btn-rest')).toBeVisible();
  await page.locator('#btn-rest').click();
  await expect(page.locator('.ending-titles')).toHaveCSS('opacity','1',{timeout:10000});
  await page.screenshot({path:testInfo.outputPath('ending.png')});
  expect(await page.evaluate(()=>PR.game.camera.getWorldDirection(PR.game.player.velocity.clone()).x)).toBeGreaterThan(0.99);
  console.log('Low-quality render budget:', JSON.stringify(metrics));
  await testInfo.attach('render-budget',{body:JSON.stringify(metrics,null,2),contentType:'application/json'});
  expect(errors).toEqual([]);
});


test('a continuous walk reaches the Sky Pool without teleporting between rooms', async ({page}) => {
  await page.addInitScript(()=>localStorage.setItem('poolrooms.settings',JSON.stringify({quality:'low',inputMode:'touch'})));
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>!!PR.game?.world)).toBe(true);
  const result=await page.evaluate(()=>{
    const {player,world,input}=PR.game;
    player.teleport(46,0,12,-Math.PI/2);
    const points=[[51,12],[51,22],[93,22],[93,12],[110,12],[110,36],[162,36],[162,28],[179,28],[201,28],[201,18],[222,18],[222,12],[240,12],[304,12],[340,12],[340,28],[397,28],[397,32],[410.3,32]];
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
    player.teleport(410,7,28,-Math.PI/2);
    input.state.moveZ=1;
    for(let i=0;i<240;i++) player.fixedStep(1/60);
    const edge=player.position.toArray();
    player.teleport(410.3,7,32,Math.PI/2);
    for(let i=0;i<240;i++) player.fixedStep(1/60);
    input.state.moveZ=0;
    return {edge,returned:player.position.toArray(),oldChair:world.journey.restAvailable(394,32,6),ocean:!!world.group.getObjectByName('Ocean beyond the overlook')};
  });
  expect(result.edge[0]).toBeGreaterThan(415);
  expect(result.edge[0]).toBeLessThan(417);
  expect(result.edge[1]).toBeCloseTo(7,1);
  expect(result.returned[0]).toBeLessThan(400);
  expect(result.returned[1]).toBeCloseTo(6,1);
  expect(result.oldChair).toBe(false);
  expect(result.ocean).toBe(true);
});
