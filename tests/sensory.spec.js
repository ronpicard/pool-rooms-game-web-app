import { test, expect } from '@playwright/test';

async function start(page, settings = {}) {
  await page.addInitScript(settings => {
    if (!localStorage.getItem('poolrooms.settings')) localStorage.setItem('poolrooms.settings', JSON.stringify({ quality: 'low', inputMode: 'touch', ...settings }));
  }, settings);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.PR?.game?.world)).toBe(true);
  await page.locator('#btn-start').click();
}

async function slider(page, id, value) {
  await page.locator(id).evaluate((input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

// Tap the real final output without changing its routing to the speakers.
async function measureAudio(page) {
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
      if (destination === this.context.destination && !window.soundMeter) {
        const context = this.context, source = this;
        // Capture every audio quantum, including short footsteps while WebGL blocks the page thread.
        const url = URL.createObjectURL(new Blob([`
          class OutputMeter extends AudioWorkletProcessor {
            constructor() {
              super(); this.energy = [0, 0]; this.samples = [0, 0];
              this.port.onmessage = ({ data }) => {
                if (data.type === 'start') { this.energy = [0, 0]; this.samples = [0, 0]; }
                this.port.postMessage({ id: data.id, levels: this.energy.map((sum, i) => Math.sqrt(sum / Math.max(1, this.samples[i]))) });
              };
            }
            process(inputs) {
              for (let channel = 0; channel < 2; channel++) {
                const samples = inputs[0][channel];
                if (!samples) continue;
                for (const value of samples) this.energy[channel] += value * value;
                this.samples[channel] += samples.length;
              }
              return true;
            }
          }
          registerProcessor('output-meter', OutputMeter);
        `], { type: 'text/javascript' }));
        const ready = context.audioWorklet.addModule(url).then(() => {
          const meter = new AudioWorkletNode(context, 'output-meter', { channelCount: 2, channelCountMode: 'explicit', outputChannelCount: [2] });
          connect.call(source, meter);
          connect.call(meter, context.destination); // The worklet emits silence; the original speaker route stays intact.
          const pending = new Map(); let nextId = 0;
          meter.port.onmessage = ({ data }) => { pending.get(data.id)?.(data.levels); pending.delete(data.id); };
          return type => new Promise(resolve => {
            const id = ++nextId; pending.set(id, resolve); meter.port.postMessage({ type, id });
          });
        }).finally(() => URL.revokeObjectURL(url));
        window.soundMeter = {
          context,
          async read() {
            const request = await ready;
            await request('start');
            await new Promise(resolve => setTimeout(resolve, 300));
            return request('read');
          },
        };
      }
      return connect.call(this, destination, ...args);
    };
  });
}

test('sound preferences validate old saves, persist independently and fit on a phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page, { environmentVolume: -2, musicVolume: 'bad', movementVolume: 4, gentleSound: 'yes' });
  expect(await page.evaluate(() => ({ environment: PR.game.settings.environmentVolume, movement: PR.game.settings.movementVolume, music: PR.game.settings.musicVolume, gentle: PR.game.settings.gentleSound })))
    .toEqual({ environment: 0, movement: 1, music: 0, gentle: false });
  await page.locator('#btn-pause').click();
  await slider(page, '#rng-environmentVolume', 65);
  await slider(page, '#rng-movementVolume', 30);
  await slider(page, '#rng-musicVolume', 25);
  await page.locator('#chk-gentle').check();
  await expect.poll(() => page.evaluate(() => PR.game.settings.musicVolume)).toBe(0.25);
  expect(await page.locator('.sound-settings').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('sound-settings-mobile.png') });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!PR.game?.world)).toBe(true);
  expect(await page.evaluate(() => ({ environment: PR.game.settings.environmentVolume, movement: PR.game.settings.movementVolume, music: PR.game.settings.musicVolume, gentle: PR.game.settings.gentleSound })))
    .toEqual({ environment: 0.65, movement: 0.3, music: 0.25, gentle: true });
});

test('music produces sound independently, category mutes silence echoes, and pause suspends audio', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await measureAudio(page);
  await start(page, { environmentVolume: 0, movementVolume: 0, musicVolume: 0 });
  await expect.poll(() => page.evaluate(() => soundMeter.context.state)).toBe('running');
  expect(Math.max(...await page.evaluate(() => soundMeter.read()))).toBeLessThan(0.00001);
  await page.locator('#btn-pause').click();
  await expect.poll(() => page.evaluate(() => soundMeter.context.state)).toBe('suspended');
  await slider(page, '#rng-musicVolume', 60);
  await page.locator('#btn-resume').click();
  await expect.poll(async () => Math.max(...await page.evaluate(() => soundMeter.read())), { timeout: 12000 }).toBeGreaterThan(0.001);
  await page.locator('#btn-pause').click();
  await slider(page, '#rng-musicVolume', 0);
  await page.locator('#btn-resume').click();
  await expect.poll(async () => Math.max(...await page.evaluate(() => soundMeter.read()))).toBeLessThan(0.00001);
  await page.locator('#btn-pause').click();
  await slider(page, '#rng-environmentVolume', 100);
  await page.locator('#btn-resume').click();
  await expect.poll(async () => Math.max(...await page.evaluate(() => soundMeter.read()))).toBeGreaterThan(0.001);
  await page.locator('#btn-pause').click();
  await slider(page, '#rng-volume', 0);
  await page.locator('#btn-resume').click();
  await expect.poll(async () => Math.max(...await page.evaluate(() => soundMeter.read()))).toBeLessThan(0.00001);
  expect(errors).toEqual([]);
});

test('waterfall sources follow the architecture and walls muffle sound while doors remain open', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(() => {
    const scene = PR.game.world.soundscape;
    return {
      sources: scene.rain,
      wall: scene.occluded({x:104,y:1.6,z:2},{x:124,y:0.25,z:0}),
      door: scene.occluded({x:104,y:1.6,z:12},{x:124,y:0.25,z:12}),
      nearest: scene.nearestWater({x:114,y:1.6,z:12}),
      start: scene.pierProgress({x:404}), end: scene.pierProgress({x:484}),
    };
  });
  expect(result.sources).toHaveLength(6);
  expect(result.sources).toContainEqual({x:124,y:0.25,z:0});
  expect(result.wall).toBe(true); expect(result.door).toBe(false);
  expect(result.nearest).toEqual({x:116,y:-0.12,z:12});
  expect(result.start).toBe(0); expect(result.end).toBe(1);
});

test('footsteps remain audible with environment off and the movement slider silences them', async ({ page }) => {
  await measureAudio(page);
  await start(page, { environmentVolume: 0, movementVolume: 1, musicVolume: 0 });
  await expect.poll(() => page.evaluate(() => soundMeter.context.state)).toBe('running');
  await page.evaluate(() => soundMeter.read());
  await page.evaluate(() => {
    PR.game.player.teleport(51,0,21,0); PR.game.input.state.moveZ=1;
  });
  await expect.poll(() => page.evaluate(() => PR.game.player.position.z)).toBeLessThan(20);
  await expect.poll(async () => Math.max(...await page.evaluate(() => soundMeter.read()))).toBeGreaterThan(0.001);
  await page.locator('#btn-pause').click();
  await slider(page, '#rng-movementVolume', 0);
  await page.locator('#btn-resume').click();
  await expect.poll(() => page.evaluate(() => soundMeter.context.state)).toBe('running');
  await page.evaluate(() => { PR.game.player.teleport(51,0,21,0); PR.game.input.state.moveZ=1; });
  await expect.poll(() => page.evaluate(() => PR.game.player.position.z)).toBeLessThan(20);
  await expect.poll(async () => Math.max(...await page.evaluate(() => soundMeter.read()))).toBeLessThan(0.00001);
});

test('water entry has bounded bubbles, reduced motion disables them, and tile shaders render', async ({ page }, testInfo) => {
  test.slow(); // Allow shader compilation and screenshots at all three quality levels in CI.
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await start(page, { reducedMotion: false });
  await page.evaluate(() => { PR.game.player.teleport(132,-1.8,12,0); PR.game.player.pitch=0.3; PR.game.input.state.downHeld=true; });
  await expect.poll(() => page.evaluate(() => PR.game.scene.getObjectByName('Water entry bubbles').visible)).toBe(true);
  expect(await page.evaluate(() => PR.game.scene.getObjectByName('Water entry bubbles').geometry.attributes.position.count)).toBe(12);
  await page.screenshot({ path: testInfo.outputPath('underwater-entry.png') });
  await expect.poll(() => page.evaluate(() => PR.game.scene.getObjectByName('Water entry bubbles').visible)).toBe(false);
  await page.locator('#btn-pause').click(); await page.locator('#chk-motion').check();
  await page.locator('#btn-resume').click();
  await page.evaluate(() => PR.game.player.teleport(114,0,12,0));
  await expect.poll(() => page.evaluate(() => PR.game.camera.position.x)).toBeCloseTo(114,0);
  await page.evaluate(() => { PR.game.player.teleport(132,-1.8,12,0); PR.game.input.state.downHeld=true; });
  await expect(page.locator('#vignette')).toHaveClass('underwater');
  expect(await page.evaluate(() => PR.game.scene.getObjectByName('Water entry bubbles').visible)).toBe(false);
  await expect(page.locator('#water-lens')).toBeHidden();
  await page.evaluate(() => PR.game.player.teleport(114,0,12,-Math.PI/2));
  for (const quality of ['low','medium','high']) {
    await page.locator('#btn-pause').click();
    await page.locator('#sel-quality').selectOption(quality);
    await page.locator('#btn-resume').click();
    await page.screenshot({ path: testInfo.outputPath(`wet-tiles-${quality}.png`) });
  }
  expect(errors).toEqual([]);
});
