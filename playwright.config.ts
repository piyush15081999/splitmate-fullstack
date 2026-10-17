import { defineConfig, devices } from '@playwright/test';

// No external base URL or reuseExistingServer: never point write tests at the real app.
const connection = process.env.DATABASE_URL;
if (!connection || new URL(connection).pathname !== '/splitmate_test') {
  throw new Error('E2E requires DATABASE_URL naming the dedicated splitmate_test database.');
}
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5273',
    reducedMotion: 'reduce',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'off', // Traces can record registration passwords and session headers.
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: [
    {
      command: 'node apps/backend/dist/server.js',
      url: 'http://localhost:3101/api/health',
      reuseExistingServer: false,
      timeout: 180_000,
      env: { DATABASE_URL: connection, PORT: '3101', HOST: '127.0.0.1', WEB_ORIGIN: 'http://localhost:5273', COOKIE_SECURE: 'false', NODE_ENV: 'test' },
    },
    {
      command: 'npm run dev -w @splitmate/frontend -- --host 127.0.0.1 --port 5273 --strictPort',
      url: 'http://localhost:5273',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_PROXY_TARGET: 'http://127.0.0.1:3101' },
    },
  ],
});
