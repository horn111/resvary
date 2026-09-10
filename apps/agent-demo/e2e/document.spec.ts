import { test, expect } from '@playwright/test';
test('fund, analyze, replay, use remaining credits and isolate a second browser', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('LOCAL TEST MODE', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run paid analysis' })).toBeEnabled();
  await page.getByRole('button', { name: 'Run paid analysis' }).click();
  await expect(page.getByTestId('receipt-id')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Gateway payment accepted. Product credits granted.')).toBeVisible();
  const receipt = await page.getByTestId('receipt-id').innerText();
  const balance = await page.getByTestId('balance').innerText();
  await page.getByRole('button', { name: 'Replay saved result' }).click();
  await expect(page.getByText('Same result. Same receipt. No new charge.')).toBeVisible();
  await expect(page.getByTestId('receipt-id')).toHaveText(receipt);
  await expect(page.getByTestId('balance')).toHaveText(balance);
  await page.screenshot({ path: 'test-results/completed-fixture.png', fullPage: true });
  await page
    .getByLabel('Choose an example or paste plain text')
    .fill('The meeting is scheduled for Friday. The owner has not been assigned.');
  await page.getByRole('button', { name: 'Run paid analysis' }).click();
  await expect(page.getByTestId('receipt-id')).not.toHaveText(receipt, { timeout: 30_000 });
  await expect(page.getByTestId('receipt-id')).toBeVisible();
  await expect(page.getByText('Gateway payment accepted. Product credits granted.')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('receipt-id')).toBeVisible();
  const separate = await browser.newContext();
  const other = await separate.newPage();
  await other.goto('/');
  await expect(other.getByTestId('balance')).toHaveText('$0.000000');
  await expect(other.getByTestId('receipt-id')).toHaveCount(0);
  await other.setViewportSize({ width: 390, height: 844 });
  await other.screenshot({ path: 'test-results/mobile-fixture.png', fullPage: true });
  expect(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await separate.close();
  expect(errors).toEqual([]);
});
