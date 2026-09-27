import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const secret = 'e2e-admin-secret-with-at-least-32-characters';

test.describe.configure({ mode: 'serial' });

test('rejects mutations without a session and authenticates the operator', async ({
  page,
  request,
}) => {
  const unauthorized = await request.post('/api/operator', {
    headers: { origin: 'http://localhost:3010' },
    data: {
      action: 'grant',
      actionId: crypto.randomUUID(),
      customerId: 'cus_0001',
      amount: '1',
      reason: 'Unauthorized test request',
    },
  });
  expect(unauthorized.status()).toBe(401);

  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Admin secret').fill('wrong-secret-that-is-still-long-enough-000');
  await page.getByRole('button', { name: 'Open console' }).click();
  await expect(page.getByText('Invalid admin secret', { exact: true })).toBeVisible();
  await page.getByLabel('Admin secret').fill(secret);
  await page.getByRole('button', { name: 'Open console' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'COMMAND LEDGER (LIVE)' })).toBeVisible();
});

test('searches within the configured project and opens a customer timeline', async ({ page }) => {
  await authenticate(page);
  await page.goto('/customers');
  await page.getByLabel('Search customer ID').fill('cus_0003');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('link', { name: 'cus_0003' })).toBeVisible();

  await page.getByLabel('Search customer ID').fill('another_project_customer');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('No customers match this project and search.')).toBeVisible();

  await page.goto('/customers/cus_0003');
  await expect(page.getByRole('heading', { name: 'cus_0003', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Account timeline' })).toBeVisible();
});

test('previews and records a grant and adjustment', async ({ page }) => {
  await authenticate(page);
  await page.goto('/customers/cus_0003');
  const grant = page.locator('form.operator-form').filter({ hasText: 'Manual grant' });
  await grant.getByLabel('Amount (USD)').fill('2.50');
  await grant.getByLabel('Reason').fill('E2E support grant verification');
  await grant.getByRole('button', { name: 'Preview result' }).click();
  await expect(grant.getByText('Change')).toContainText('+$2.50');
  await grant.getByRole('button', { name: 'Confirm manual grant' }).click();
  await expect(grant.getByRole('status')).toContainText('Recorded as');

  const adjustment = page.locator('form.operator-form').filter({ hasText: 'Balance adjustment' });
  await adjustment.getByLabel('Amount (USD)').fill('-0.25');
  await adjustment.getByLabel('Reason').fill('E2E correction verification');
  await adjustment.getByRole('button', { name: 'Preview result' }).click();
  await expect(adjustment.getByText('Change')).toContainText('-$0.25');
  await adjustment.getByRole('button', { name: 'Confirm balance adjustment' }).click();
  await expect(adjustment.getByRole('status')).toContainText('Recorded as');
});

test('replays one action UUID without applying a second mutation', async ({ page }) => {
  await authenticate(page);
  const actionId = crypto.randomUUID();
  const payload = {
    action: 'grant',
    actionId,
    customerId: 'cus_0002',
    amount: '1.25',
    reason: 'E2E idempotency replay verification',
  };
  const responses = await page.evaluate(async (body) => {
    const send = () =>
      fetch('/api/operator', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(async (response) => ({ status: response.status, body: await response.json() }));
    return [await send(), await send()];
  }, payload);
  expect(responses[0].status).toBe(200);
  expect(responses[1].status).toBe(200);
  expect(responses[1].body).toEqual(responses[0].body);
});

test('sweeps overdue reservations and requeues only dead-letter events', async ({ page }) => {
  await authenticate(page);
  await page.goto('/operations');
  const sweep = page.locator('form.simple-action').filter({ hasText: 'Expiry sweep' });
  await sweep.getByLabel('Reason').fill('E2E overdue reservation recovery');
  await sweep.getByRole('button', { name: 'Expire overdue reservations' }).click();
  await expect(sweep.getByRole('status')).toContainText('Recorded as');

  const requeue = page.locator('form.simple-action').filter({ hasText: 'Dead-letter recovery' });
  await requeue.getByLabel('Reason').fill('E2E receiver recovery verification');
  await requeue.getByRole('button', { name: 'Requeue event' }).click();
  await expect(
    page.getByRole('cell', { name: 'E2E receiver recovery verification' }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByText('No overdue reservations.')).toBeVisible();
  await expect(page.getByText('No dead-letter events.')).toBeVisible();
});

test('shows evidence drill-down and rejects a cross-origin mutation', async ({ page }) => {
  await authenticate(page);
  await page.goto('/audit?kind=usage_receipt');
  await expect(page.getByRole('heading', { name: 'Audit Explorer' })).toBeVisible();
  await expect(page.getByText('Linked evidence', { exact: true })).toBeVisible();
  await expect(page.getByText('Original JSON')).toBeVisible();

  const response = await page.context().request.post('/api/operator', {
    headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
    data: {
      action: 'grant',
      actionId: crypto.randomUUID(),
      customerId: 'cus_0001',
      amount: '1',
      reason: 'Cross-origin request must fail',
    },
  });
  expect(response.status()).toBe(403);
});

test('filters a recovery backlog and retries a lost settlement response with the same command ID', async ({
  page,
}) => {
  await authenticate(page);
  await page.goto('/operations');
  await expect(page.getByRole('heading', { name: 'Metered operations' })).toBeVisible();
  const health = await page
    .context()
    .request.get('/api/health', { headers: { authorization: `Bearer ${secret}` } });
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({
    meteredOperations: {
      unresolvedCount: 3,
      byStatus: {
        running: { count: 1 },
        outcome_unknown: { count: 1 },
        result_saved: { count: 1 },
        needs_reconciliation: { count: 1 },
      },
    },
  });
  await page.getByLabel('Operation status').selectOption('result_saved');
  await page.getByLabel('Last update').selectOption('1');
  await page.getByRole('button', { name: 'Filter operations' }).click();
  await expect(page.getByRole('link', { name: 'e2e-saved-job', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'e2e-unknown-job', exact: true })).toHaveCount(0);
  const capture = process.env.RESVARY_CAPTURE_REVIEW === '1';
  const screenshots = resolve(process.cwd(), '../../.impeccable/review');
  if (capture) await mkdir(screenshots, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (capture)
      await page.screenshot({
        path: resolve(screenshots, `operations-${width === 1440 ? 'desktop' : 'mobile'}.png`),
        fullPage: true,
      });
  }
  await page.getByRole('link', { name: 'e2e-saved-job', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Operation recovery' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Charge evidence' })).toBeVisible();
  expect(await page.content()).not.toContain('e2e-private-provider-output');
  expect(await page.content()).not.toContain('e2e-private-worker');
  expect(await page.content()).not.toContain('claimToken');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (capture)
      await page.screenshot({
        path: resolve(screenshots, `${width === 1440 ? 'desktop' : 'mobile'}.png`),
        fullPage: true,
      });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const form = page.locator('form.operation-recovery');
  await form.getByLabel('Reason').fill('E2E saved result reviewed after worker restart');
  await form.getByRole('button', { name: 'Review recovery action' }).click();
  const requests: string[] = [];
  await page.route('**/api/operator', async (route) => {
    requests.push(route.request().postData()!);
    if (requests.length === 1) {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
    } else await route.continue();
  });
  await form.getByRole('button', { name: 'Confirm: settle saved usage' }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await form.getByRole('button', { name: 'Retry same command' }).click();
  await expect(page.getByRole('heading', { name: 'Settled', exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toBe(requests[0]);
  await expect(
    page.getByRole('cell', { name: 'E2E saved result reviewed after worker restart', exact: true }),
  ).toHaveCount(1);
  await expect(
    page.locator('dl').filter({ hasText: 'Receipt' }).getByRole('link').last(),
  ).toHaveAttribute('href', /kind=usage_receipt/);
});

test('reconciles saved usage and resolves an unknown outcome only with external evidence', async ({
  page,
}) => {
  await authenticate(page);
  for (const [key, label, reason] of [
    [
      'e2e-reconcile-job',
      'reconcile saved usage',
      'E2E measured usage and available credits verified',
    ],
    [
      'e2e-unknown-job',
      'confirm no execution',
      'E2E provider confirmed the request was not executed',
    ],
  ]) {
    await page.goto(`/operations?search=${key}`);
    await page.getByRole('link', { name: key, exact: true }).click();
    const form = page.locator('form.operation-recovery');
    await form.getByLabel('Reason').fill(reason);
    if (key === 'e2e-unknown-job') {
      await form.getByRole('button', { name: 'Review recovery action' }).click();
      await expect(form.getByRole('button', { name: `Confirm: ${label}` })).toHaveCount(0);
      await form.getByLabel('External evidence reference').fill('provider-log:e2e-no-execution');
    }
    await form.getByRole('button', { name: 'Review recovery action' }).click();
    await form.getByRole('button', { name: `Confirm: ${label}` }).click();
    await expect(
      page.getByRole('heading', {
        name: key === 'e2e-unknown-job' ? 'Cancelled' : 'Settled',
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole('cell', { name: reason, exact: true })).toBeVisible();
  }
});

async function authenticate(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Admin secret').fill(secret);
  await page.getByRole('button', { name: 'Open console' }).click();
  await expect(page).toHaveURL(/\/$/);
}
