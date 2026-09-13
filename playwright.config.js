import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  // Software-rendered startup can take longer than the default five-second assertion window.
  expect: { timeout: 30000 },
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // Behavior checks do not need a large framebuffer; visual budget tests set their own viewport.
    viewport: { width: 640, height: 360 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'node tests/serve.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
