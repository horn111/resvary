import { expect, test } from '@playwright/test';

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

async function authenticate(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Admin secret').fill(secret);
  await page.getByRole('button', { name: 'Open console' }).click();
  await expect(page).toHaveURL(/\/$/);
}
