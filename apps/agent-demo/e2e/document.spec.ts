import { test, expect } from '@playwright/test';
import { createInvoice, createMemoPaymentRequest } from '@resvary/sdk/receipts';
test('fund, analyze, replay, use remaining credits and isolate a second browser', async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('LOCAL TEST MODE', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run free analysis' })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Testnet proof' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Run free analysis' }).click();
  await expect(page.getByTestId('receipt-id')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Gateway payment accepted. Product credits granted.')).toBeVisible();
  const receipt = await page.getByTestId('receipt-id').innerText();
  const balance = await page.getByTestId('balance').innerText();
  await page.getByRole('button', { name: 'Replay saved result' }).click();
  await expect(page.getByText('Same result. Same receipt. No new charge.')).toBeVisible();
  await expect(page.getByTestId('receipt-id')).toHaveText(receipt);
  await expect(page.getByTestId('balance')).toHaveText(balance);
  await page.screenshot({ path: testInfo.outputPath('completed-fixture.png'), fullPage: true });
  await page
    .getByLabel('Choose an example or paste plain text')
    .fill('The meeting is scheduled for Friday. The owner has not been assigned.');
  await page.getByRole('button', { name: 'Run free analysis' }).click();
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
  await expect(other.getByText('1 of 3 free runs left', { exact: false })).toBeVisible();
  await other.getByRole('button', { name: 'Run free analysis' }).click();
  await expect(other.getByTestId('receipt-id')).toBeVisible({ timeout: 30_000 });
  await expect(other.getByRole('button', { name: 'Connect wallet' })).toBeVisible();
  await expect(other.getByRole('button', { name: 'Run with my credits' })).toBeDisabled();
  await other.reload();
  await expect(other.getByText('0 of 3 free runs left', { exact: false })).toBeVisible();
  await other.setViewportSize({ width: 390, height: 844 });
  await other.screenshot({ path: testInfo.outputPath('mobile-fixture.png'), fullPage: true });
  expect(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await separate.close();
  expect(errors).toEqual([]);
});

test('visitor signs in, confirms a pending top-up after reload, and runs with credits', async ({
  page,
}) => {
  const wallet = '0x2222222222222222222222222222222222222222';
  const txHash = `0x${'a'.repeat(64)}`;
  const invoice = createInvoice({
    id: 'inv_browser',
    amount: '0.50',
    payTo: '0x1111111111111111111111111111111111111111',
    network: 'arc',
  });
  const payment = createMemoPaymentRequest(invoice);
  const status = {
    accepting: true,
    wallet: null as string | null,
    balance: '0',
    freeRunsRemaining: 0,
    maxPaidAmount: '0.347392',
    topUpAmounts: ['0.50', '1.00', '5.00'],
    testMode: false,
    arcEnvironment: 'mainnet',
    jobs: [] as { id: string; phase: string }[],
  };
  let confirmations = 0;
  let topUps = 0;
  let runs = 0;
  await page.addInitScript(
    ({ wallet, txHash }) => {
      (window as unknown as { ethereum: object }).ethereum = {
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [wallet];
          if (method === 'eth_chainId') return '0x13b2';
          if (method === 'wallet_switchEthereumChain') return null;
          if (method === 'personal_sign') return `0x${'1'.repeat(130)}`;
          if (method === 'eth_sendTransaction') {
            localStorage.setItem(
              'test:broadcasts',
              String(Number(localStorage.getItem('test:broadcasts') ?? 0) + 1),
            );
            return txHash;
          }
          throw new Error(`Unexpected wallet method ${method}`);
        },
        on() {},
        removeListener() {},
      };
    },
    { wallet, txHash },
  );
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: object = { ok: true };
    let code = 200;
    if (path === '/api/status') body = status;
    else if (path === '/api/wallet/challenge')
      body = { address: wallet, message: 'Browser fixture sign-in, not a payment authorization.' };
    else if (path === '/api/wallet/verify') {
      status.wallet = wallet;
      body = { address: wallet };
    } else if (path === '/api/wallet/funding') {
      topUps++;
      body = {
        fundingIntent: { id: `fund_${'a'.repeat(24)}` },
        invoice,
        paymentRequest: payment,
        chainId: 5042,
      };
    } else if (path.endsWith('/confirm')) {
      confirmations++;
      if (confirmations === 1) {
        code = 503;
        body = { error: 'Pending confirmation' };
      } else {
        status.balance = '0.50';
        body = { confirmed: true };
      }
    } else if (path === '/api/jobs' && route.request().method() === 'POST') {
      runs++;
      status.jobs = [{ id: 'fixture-paid', phase: 'completed' }];
      body = { id: 'fixture-paid', phase: 'completed' };
    } else if (path === '/api/jobs/fixture-paid')
      body = {
        id: 'fixture-paid',
        phase: 'completed',
        result: 'Paid fixture analysis.',
        events: [],
        failure: null,
        receipt: {
          id: 'receipt-paid-fixture',
          amount: '0.01',
          amountUnits: '10000',
          releasedAmount: '0.337392',
          releasedUnits: '337392',
          balanceAfterUnits: '490000',
        },
      };
    await route.fulfill({ status: code, json: body });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Run with my credits' })).toBeDisabled();
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('button', { name: 'Add USDC credits' })).toBeEnabled();
  await page.getByRole('button', { name: 'Add USDC credits' }).click();
  await expect(page.getByLabel('Arc transaction hash')).toHaveValue(txHash);
  await expect(page.getByRole('button', { name: 'Check payment' })).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel('Arc transaction hash')).toHaveValue(txHash);
  await page.getByRole('button', { name: 'Check payment' }).click();
  await expect(page.getByText('0.50 USDC added to your Resvary credits.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run with my credits' })).toBeEnabled();
  await page.getByRole('button', { name: 'Run with my credits' }).click();
  await expect(page.getByTestId('receipt-id')).toHaveText('receipt-paid-fixture');
  expect(topUps).toBe(1);
  expect(runs).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('test:broadcasts'))).toBe('1');
});
