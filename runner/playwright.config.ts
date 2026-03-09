import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5199',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'flow emulator --contracts --rest-port=8888 --admin-port=8090 --port=3569 --block-time=1s',
      port: 8888,
      timeout: 15_000,
      reuseExistingServer: true,
    },
    {
      command: 'bun run dev -- --port 5199',
      port: 5199,
      timeout: 30_000,
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
