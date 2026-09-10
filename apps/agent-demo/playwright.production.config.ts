import { defineConfig } from '@playwright/test';

const baseURL = process.env.LIVE_AGENT_DEMO_URL?.trim().replace(/\/$/, '');

if (process.env.RUN_LIVE_AGENT_DEMO !== 'true') {
  throw new Error(
    'Production E2E is opt-in. Set RUN_LIVE_AGENT_DEMO=true after the deployment is ready.',
  );
}

if (!baseURL || new URL(baseURL).protocol !== 'https:') {
  throw new Error('LIVE_AGENT_DEMO_URL must be the HTTPS origin of the public demo.');
}

export default defineConfig({
  testDir: './e2e',
  testMatch: ['production.spec.ts', 'session.production.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 6 * 60_000,
  expect: { timeout: 15_000 },
  outputDir: './test-results/live-agent-demo',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: './playwright-report/live-agent-demo' }],
  ],
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 1200 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
});
