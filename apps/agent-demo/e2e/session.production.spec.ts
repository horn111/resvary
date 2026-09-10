import { expect, test } from '@playwright/test';

test('read-only session isolation for a completed live proof', async ({ page }) => {
  const id = process.env.LIVE_AGENT_DEMO_PROOF_JOB_ID;
  test.skip(!id, 'Pass a previously completed synthetic live job ID');
  expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  // This context has no signed session. No POST /api/jobs occurs in this test.
  expect((await page.request.get('/api/status')).status()).toBe(401);
  const session = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/session',
  );
  await page.goto('/');
  expect((await session).status()).toBe(200);
  const status = await page.request.get('/api/status');
  expect(status.status()).toBe(200);
  expect(await status.json()).toMatchObject({ balance: '0', jobs: [], testMode: false });
  const otherJob = await page.request.get(`/api/jobs/${id}`);
  expect(otherJob.status()).toBe(404);
  expect(await otherJob.json()).toEqual({ error: 'Job not found' });
  const cookie = (await page.context().cookies()).find((value) => value.name === 'resvary_agent');
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
  await expect(page.getByTestId('balance')).toHaveText('$0.000000');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
