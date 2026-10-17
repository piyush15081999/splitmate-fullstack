import { defineConfig, devices } from '@playwright/test';
const connection = process.env.DATABASE_URL;
if (!connection || new URL(connection).pathname !== '/splitmate_test') throw new Error('Production browser tests require the isolated splitmate_test database.');
export default defineConfig({
  testDir: './tests/production', workers: 1, retries: 0, timeout: 180_000, expect: { timeout: 20_000 }, forbidOnly: !!process.env.CI,
  reporter: [['list']], outputDir: 'test-results/production',
  use: { baseURL: 'https://localhost:5275', ignoreHTTPSErrors: true, actionTimeout: 30_000, navigationTimeout: 45_000, reducedMotion: 'reduce', screenshot: 'only-on-failure', trace: 'off', video: 'off' },
  projects: [{ name: 'production-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: [
    { command: 'node apps/backend/dist/server.js', url: 'http://127.0.0.1:3103/healthz', reuseExistingServer: false, timeout: 180_000,
      env: { DATABASE_URL: connection, PORT: '3103', HOST: '127.0.0.1', NODE_ENV: 'production', WEB_ORIGIN: 'https://localhost:5275', COOKIE_SECURE: 'true', TRUST_PROXY: '1' } },
    { command: 'node scripts/https-test-proxy.mjs', url: 'https://localhost:5275/healthz', ignoreHTTPSErrors: true, reuseExistingServer: false, timeout: 120_000 },
  ],
});
