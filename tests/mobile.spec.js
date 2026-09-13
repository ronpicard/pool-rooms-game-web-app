import { test, expect } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  // Exercise play with browser chrome, including phones without element fullscreen.
  // Desktop Chromium's fullscreen window cannot be rotated by Playwright's viewport API.
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = undefined;
    Element.prototype.webkitRequestFullscreen = undefined;
  });
});

async function enter(page) {
  await page.goto('/poolrooms/');
  await expect.poll(() => page.evaluate(() => !!window.PR?.game?.world)).toBe(true);
  await page.locator('#btn-start').tap();
  await expect(page.locator('#touch-layer')).toBeVisible();
}

async function touchSession(page) {
  const session = await page.context().newCDPSession(page);
  let active = [];
  return async (type, points) => {
    // Callers pass the fingers remaining down; Chromium touchEnd selects the fingers to release.
    const changed = type === 'touchEnd' && points.length
      ? active.filter(([id]) => !points.some(([other]) => other === id)) : points;
    await session.send('Input.dispatchTouchEvent', {
      type, touchPoints: changed.map(([id, x, y]) => ({ id, x, y, radiusX: 5, radiusY: 5, force: 1 })),
    });
    active = points;
  };
}

async function swipeUp(touch, x, from, to) {
  await touch('touchStart', [[1, x, from]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[1, x, from + (to - from) * i / 8]]);
  await touch('touchEnd', []);
}

async function center(page, selector) {
  const box = await page.locator(selector).boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
}

for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`phone menus fit and scroll with a finger at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/poolrooms/');
    await expect.poll(() => page.evaluate(() => !!window.PR?.game?.world)).toBe(true);
    expect(await page.evaluate(() => PR.game.input.mode)).toBe('touch');
    expect(await page.evaluate(() => PR.game.settings.quality)).toBe('low');
    await page.locator('.start-controls summary').tap();
    const touch = await touchSession(page);
    await page.locator('#start-overlay').evaluate(el => { el.scrollTop = 0; });
    await swipeUp(touch, 40, viewport.height - 60, 90);
    await expect.poll(() => page.locator('#start-overlay').evaluate(el => el.scrollTop)).toBeGreaterThan(20);
    await page.locator('#btn-start').tap();
    await page.locator('#btn-pause').tap();
    const card = page.locator('#pause-menu .card');
    expect(await card.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await card.evaluate(el => { el.scrollTop = 0; });
    const box = await card.boundingBox();
    await swipeUp(touch, box.x + 10, box.y + box.height - 30, box.y + 30);
    await expect.poll(() => card.evaluate(el => el.scrollTop)).toBeGreaterThan(20);
    await page.locator('#chk-motion').tap();
    await expect(page.locator('#chk-motion')).toBeChecked();
    await page.screenshot({ path: testInfo.outputPath('mobile-pause.png') });
    await page.locator('#btn-resume').tap();
    await expect(page.locator('#pause-menu')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('mobile-play.png') });
  });
}

test('touch controls expose sprint, jump and diving without a keyboard', async ({ page }) => {
  await enter(page);
  await expect(page.getByRole('button', { name: 'Sprint', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dive', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sprint', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Sprint', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => PR.game.input.state.sprint)).toBe(true);
  await page.getByRole('button', { name: 'Sprint', exact: true }).tap();
  expect(await page.evaluate(() => PR.game.input.state.sprint)).toBe(false);
});

test('two thumbs can move and look while a third touch jumps', async ({ page }) => {
  await enter(page);
  const touch = await touchSession(page);
  const before = await page.evaluate(() => ({ x: PR.game.player.position.x, y: PR.game.player.position.y, yaw: PR.game.player.yaw }));
  await touch('touchStart', [[1, 80, 640]]);
  await touch('touchMove', [[1, 80, 580]]);
  await touch('touchStart', [[1, 80, 580], [2, 240, 410]]);
  await touch('touchMove', [[1, 80, 580], [2, 280, 430]]);
  await expect.poll(() => page.evaluate(() => PR.game.player.position.x)).toBeGreaterThan(before.x + 0.1);
  await expect.poll(() => page.evaluate(() => PR.game.player.yaw)).not.toBe(before.yaw);
  await touch('touchStart', [[1, 80, 580], [2, 280, 430], [3, ...await center(page, '#btn-jump')]]);
  await expect.poll(() => page.evaluate(() => PR.game.player.position.y)).toBeGreaterThan(before.y + 0.2);
  await touch('touchEnd', [[1, 80, 580], [2, 280, 430]]);
  expect(await page.evaluate(() => PR.game.input.state.jumpHeld)).toBe(false);
  expect(await page.evaluate(() => PR.game.input.state.moveZ)).toBe(1);
  await touch('touchStart', [[1, 80, 580], [2, 280, 430], [4, ...await center(page, '#sprint-indicator')]]);
  await touch('touchEnd', [[1, 80, 580], [2, 280, 430]]);
  expect(await page.evaluate(() => PR.game.input.state.sprint)).toBe(true);
  await touch('touchEnd', []);
  expect(await page.evaluate(() => PR.game.input.state.moveZ)).toBe(0);
  await expect(page.locator('#joystick')).not.toHaveClass(/active/);
});

test('holding Dive submerges the player and Jump / up returns to the surface', async ({ page }) => {
  await enter(page);
  await page.evaluate(() => PR.game.player.teleport(136, -1.37, -12, 0));
  const touch = await touchSession(page);
  const dive = [1, ...await center(page, '#btn-dive')];
  await touch('touchStart', [dive]);
  await expect.poll(() => page.evaluate(() => PR.game.player.position.y)).toBeLessThan(-2.4);
  expect(await page.evaluate(() => PR.game.player.state.underwater)).toBe(true);
  // Releasing outside the button still releases its captured finger.
  await touch('touchMove', [[1, 200, 450]]);
  await touch('touchEnd', []);
  expect(await page.evaluate(() => PR.game.input.state.downHeld)).toBe(false);
  await touch('touchStart', [[2, ...await center(page, '#btn-jump')]]);
  await expect.poll(() => page.evaluate(() => PR.game.player.state.underwater)).toBe(false);
  await touch('touchEnd', []);
  expect(await page.evaluate(() => PR.game.input.state.jumpHeld)).toBe(false);
});

test('cancelled touches, lost capture, pausing and rotation clear held controls', async ({ page }) => {
  await enter(page);
  const touch = await touchSession(page);
  const idle = { moveX: 0, moveZ: 0, sprint: false, jumpHeld: false, downHeld: false };
  for (const interruption of ['cancel', 'capture', 'pause', 'rotate']) {
    await page.locator('#sprint-indicator').tap();
    await touch('touchStart', [[1, 80, 640]]);
    await touch('touchMove', [[1, 80, 580]]);
    await touch('touchStart', [[1, 80, 580], [2, ...await center(page, '#btn-dive')]]);
    if (interruption === 'cancel') {
      await touch('touchCancel', []);
      // Sprint is a toggle and persists through a cancelled drag until explicitly turned off.
      await page.locator('#sprint-indicator').tap();
    } else if (interruption === 'capture') {
      await page.evaluate(() => {
        for (const id of ['touch-layer', 'btn-dive']) {
          const el = document.getElementById(id);
          // Capture ids come from actual browser pointer events, not CDP touch ids.
          el.addEventListener('pointermove', event => el.releasePointerCapture(event.pointerId), { once: true });
        }
      });
      await touch('touchMove', [[1, 81, 579], [2, ...await center(page, '#btn-dive')]]);
      await touch('touchMove', [[1, 82, 578], [2, 340, 790]]);
      await touch('touchMove', [[1, 83, 577], [2, 341, 789]]);
      await expect.poll(() => page.evaluate(() => [PR.game.input.state.moveZ, PR.game.input.state.downHeld])).toEqual([0, false]);
      await touch('touchEnd', []);
      await page.locator('#sprint-indicator').tap();
    } else if (interruption === 'pause') {
      await touch('touchStart', [[1, 80, 580], [2, ...await center(page, '#btn-dive')], [3, ...await center(page, '#btn-pause')]]);
      await expect(page.locator('#pause-menu')).toBeVisible();
      expect(await page.evaluate(() => ({ ...PR.game.input.state }))).toEqual(idle);
      await touch('touchEnd', []);
    } else {
      await page.setViewportSize({ width: 844, height: 390 });
      await touch('touchEnd', []);
      await expect.poll(() => page.evaluate(() => PR.game.camera.aspect)).toBeCloseTo(844 / 390, 3);
    }
    expect(await page.evaluate(() => ({ ...PR.game.input.state })), interruption).toEqual(idle);
    await expect(page.locator('#joystick')).not.toHaveClass(/active/);
    if (interruption === 'pause') await page.locator('#btn-resume').tap();
  }
});

test('phone invitations avoid thumb controls and the ending fits after rotation', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 568 });
  await enter(page);
  await page.evaluate(() => PR.game.player.teleport(114.5, 0, 20, -Math.PI / 2));
  await expect(page.locator('#btn-rest')).toBeVisible();
  const invitation = await page.locator('#btn-rest').boundingBox();
  const controls = await page.locator('.touch-actions').boundingBox();
  expect(invitation.y + invitation.height).toBeLessThan(controls.y);
  for (const selector of ['#btn-rest', '#btn-jump', '#btn-dive', '#sprint-indicator']) {
    await expect(page.locator(selector)).toBeInViewport({ ratio: 1 });
    const box = await page.locator(selector).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await page.locator('#btn-rest').tap();
  await expect(page.locator('#btn-leave-seat')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#quiet-rest .hide-seat-ui')).toBeInViewport({ ratio: 1 });
  await page.locator('#btn-leave-seat').tap();
  await page.evaluate(() => PR.game.player.teleport(477.3, 7, 14, -Math.PI / 2));
  await page.locator('#btn-rest').tap();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('#btn-get-up')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#ending .hide-seat-ui')).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath('mobile-ending.png') });
  await page.locator('#btn-get-up').tap();
  await expect(page.locator('#touch-layer')).toBeVisible();
});
