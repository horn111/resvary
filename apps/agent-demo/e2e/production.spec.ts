import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

type Receipt = {
  id: string;
  amount: string;
  amountUnits: string;
  releasedAmount: string;
  releasedUnits: string;
  balanceAfterUnits: string;
};

type Event = {
  seq: string;
  kind: string;
  detail: Record<string, unknown>;
};

type Job = {
  id: string;
  phase: string;
  result: string | null;
  receipt: Receipt | null;
  failure: string | null;
  events: Event[];
};

type Status = {
  accepting: boolean;
  balance: string;
  testMode: boolean;
  message: string;
  jobs: { id: string; phase: string }[];
};

type JobInput = { key: string; document: string };

const origin = new URL(process.env.LIVE_AGENT_DEMO_URL!).origin;
const terminal = new Set(['completed', 'failed', 'review_required']);

function amountToUnits(amount: string) {
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(`${fraction}000000`.slice(0, 6));
}

async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  expect(response.headers()['cache-control']).toContain('private, no-store');
  return (await response.json()) as T;
}

async function postJob(request: APIRequestContext, input: JobInput) {
  return request.post('/api/jobs', {
    headers: { origin },
    data: input,
  });
}

async function waitForTerminalJob(request: APIRequestContext, id: string) {
  let latest: Job | undefined;
  await expect
    .poll(
      async () => {
        latest = await getJson<Job>(request, `/api/jobs/${id}`);
        return terminal.has(latest.phase) ? latest.phase : 'pending';
      },
      { timeout: 5 * 60_000, intervals: [1_000, 2_000, 5_000, 10_000] },
    )
    .not.toBe('pending');
  expect(latest?.failure, `job ${id} failed in phase ${latest?.phase}`).toBeNull();
  expect(latest?.phase).toBe('completed');
  expect(latest?.result).toBeTruthy();
  expect(latest?.receipt).toBeTruthy();
  return latest!;
}

function expectAnalysis(result: string) {
  expect(result).toMatch(/Summary/i);
  expect(result).toMatch(/Key facts/i);
  expect(result).toMatch(/Open questions/i);
}

function expectOrderedEvents(job: Job, expectedKinds: string[]) {
  const kinds = job.events.map((event) => event.kind);
  let cursor = -1;
  for (const kind of expectedKinds) {
    const index = kinds.indexOf(kind, cursor + 1);
    expect(
      index,
      `${kind} must follow ${expectedKinds.slice(0, expectedKinds.indexOf(kind)).join(', ')}`,
    ).toBeGreaterThan(cursor);
    cursor = index;
  }
  for (let index = 1; index < job.events.length; index += 1) {
    expect(BigInt(job.events[index].seq)).toBeGreaterThan(BigInt(job.events[index - 1].seq));
  }
}

function captureBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

test('live funding, paid analysis, idempotent replay, remaining credits, and session isolation', async ({
  browser,
  page,
}, testInfo) => {
  const errors = captureBrowserErrors(page);
  const submittedInputs: JobInput[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/jobs') return;
    submittedInputs.push(request.postDataJSON() as JobInput);
  });

  await test.step('server rejects reads without a signed session', async () => {
    const anonymous = await browser.newContext({ baseURL: origin });
    const response = await anonymous.request.get('/api/status');
    expect(response.status()).toBe(401);
    expect(response.headers()['cache-control']).toContain('private, no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Start a new demo session' });
    await anonymous.close();
  });

  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'An agent pays for document analysis.' }),
  ).toBeVisible();
  await expect(
    page.getByText('Testnet USDC is supplied by the project.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('LOCAL TEST MODE', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run paid analysis' })).toBeEnabled();

  const initialStatus = await getJson<Status>(page.request, '/api/status');
  expect(initialStatus).toMatchObject({ accepting: true, balance: '0', testMode: false, jobs: [] });
  const sessionCookie = (await page.context().cookies(origin)).find(
    (cookie) => cookie.name === 'resvary_agent',
  );
  expect(sessionCookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });

  const runTag = crypto.randomUUID().slice(0, 8);
  const firstDocument = [
    `Synthetic E2E memo ${runTag}.`,
    'Project Aurora will review a draft release on November 4. Ada owns the review and Ben owns the rollout.',
    'The approved test budget is $240. Release requires a signed accessibility checklist and a passing rollback drill.',
    'The memo leaves the customer notification owner and final retention period unresolved.',
  ].join(' ');

  const firstResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/jobs',
  );
  await page.getByLabel('Choose an example or paste plain text').fill(firstDocument);
  await page.getByRole('button', { name: 'Run paid analysis' }).click();
  const firstResponse = await firstResponsePromise;
  expect(firstResponse.status()).toBe(202);
  const firstCreated = (await firstResponse.json()) as { id: string; phase: string };
  expect(firstCreated.id).toMatch(/^[0-9a-f-]{36}$/i);
  await expect.poll(() => submittedInputs.length).toBe(1);
  expect(submittedInputs[0]).toEqual({ key: expect.any(String), document: firstDocument });

  const firstJob = await waitForTerminalJob(page.request, firstCreated.id);
  expectAnalysis(firstJob.result!);
  expectOrderedEvents(firstJob, [
    'topup_required',
    'payment_started',
    'credits_funded',
    'credits_reserved',
    'analysis_started',
    'usage_charged',
  ]);
  const funded = firstJob.events.find((event) => event.kind === 'credits_funded')!;
  expect(funded.detail.testFixture).not.toBe(true);
  expect(funded.detail.fundingTransactionId).toEqual(expect.any(String));
  expect(BigInt(firstJob.receipt!.amountUnits)).toBeGreaterThan(0n);
  expect(BigInt(firstJob.receipt!.releasedUnits)).toBeGreaterThan(0n);
  expect(BigInt(firstJob.receipt!.balanceAfterUnits)).toBeGreaterThan(0n);
  await expect(page.getByTestId('receipt-id')).toHaveText(firstJob.receipt!.id, {
    timeout: 30_000,
  });
  await page.screenshot({
    path: testInfo.outputPath('01-live-funded-analysis.png'),
    fullPage: true,
  });

  const beforeReplay = await getJson<Status>(page.request, '/api/status');
  const replayResponse = await postJob(page.request, submittedInputs[0]);
  expect(replayResponse.status()).toBe(202);
  expect(await replayResponse.json()).toMatchObject({ id: firstJob.id, phase: 'completed' });
  const replayedJob = await getJson<Job>(page.request, `/api/jobs/${firstJob.id}`);
  const afterReplay = await getJson<Status>(page.request, '/api/status');
  expect(replayedJob).toEqual(firstJob);
  expect(afterReplay.balance).toBe(beforeReplay.balance);
  expect(afterReplay.jobs).toEqual(beforeReplay.jobs);

  await page.getByRole('button', { name: 'Replay saved result' }).click();
  await expect(page.getByText('Same result. Same receipt. No new charge.')).toBeVisible();
  await expect(page.getByTestId('receipt-id')).toHaveText(firstJob.receipt!.id);
  await expect(page.getByTestId('balance')).toHaveText(
    `$${Number(beforeReplay.balance).toFixed(6)}`,
  );
  await page.screenshot({ path: testInfo.outputPath('02-idempotent-replay.png'), fullPage: true });

  const secondDocument = `Synthetic note ${runTag}: Ada owns the Friday review.`;
  const secondResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/jobs',
  );
  await page.getByLabel('Choose an example or paste plain text').fill(secondDocument);
  await page.getByRole('button', { name: 'Run paid analysis' }).click();
  const secondResponse = await secondResponsePromise;
  expect(secondResponse.status()).toBe(202);
  const secondCreated = (await secondResponse.json()) as { id: string; phase: string };
  expect(secondCreated.id).not.toBe(firstJob.id);
  await expect.poll(() => submittedInputs.length).toBe(2);
  expect(submittedInputs[1]).toEqual({ key: expect.any(String), document: secondDocument });
  expect(submittedInputs[1].key).not.toBe(submittedInputs[0].key);

  const secondJob = await waitForTerminalJob(page.request, secondCreated.id);
  expectAnalysis(secondJob.result!);
  expectOrderedEvents(secondJob, ['credits_reserved', 'analysis_started', 'usage_charged']);
  const secondKinds = secondJob.events.map((event) => event.kind);
  expect(secondKinds).not.toContain('topup_required');
  expect(secondKinds).not.toContain('payment_started');
  expect(secondKinds).not.toContain('credits_funded');
  expect(secondJob.receipt!.id).not.toBe(firstJob.receipt!.id);
  expect(BigInt(secondJob.receipt!.balanceAfterUnits)).toBeLessThan(
    BigInt(firstJob.receipt!.balanceAfterUnits),
  );
  const finalStatus = await getJson<Status>(page.request, '/api/status');
  expect(amountToUnits(finalStatus.balance)).toBe(BigInt(secondJob.receipt!.balanceAfterUnits));
  expect(finalStatus.jobs.map((job) => job.id)).toEqual([secondJob.id, firstJob.id]);
  await expect(page.getByTestId('receipt-id')).toHaveText(secondJob.receipt!.id, {
    timeout: 30_000,
  });
  await page.screenshot({
    path: testInfo.outputPath('03-second-run-from-existing-credits.png'),
    fullPage: true,
  });

  await test.step('a second browser cannot read the first session', async () => {
    const isolated = await browser.newContext({
      baseURL: origin,
      viewport: { width: 390, height: 844 },
    });
    const other = await isolated.newPage();
    const isolatedErrors = captureBrowserErrors(other);
    await other.goto('/');
    await expect(other.getByRole('button', { name: 'Run paid analysis' })).toBeEnabled({
      timeout: 45_000,
    });
    await expect(other.getByTestId('balance')).toHaveText('$0.000000');
    await expect(other.getByTestId('receipt-id')).toHaveCount(0);
    const otherStatus = await getJson<Status>(other.request, '/api/status');
    expect(otherStatus).toMatchObject({ balance: '0', testMode: false, jobs: [] });
    const crossSessionRead = await other.request.get(`/api/jobs/${firstJob.id}`);
    expect(crossSessionRead.status()).toBe(404);
    await expect(crossSessionRead.json()).resolves.toEqual({ error: 'Job not found' });
    const otherCookie = (await isolated.cookies(origin)).find(
      (cookie) => cookie.name === 'resvary_agent',
    );
    expect(otherCookie?.value).not.toBe(sessionCookie?.value);
    expect(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(isolatedErrors).toEqual([]);
    await isolated.close();
  });

  await testInfo.attach('live-proof.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          origin,
          runTag,
          first: {
            id: firstJob.id,
            receiptId: firstJob.receipt!.id,
            charge: firstJob.receipt!.amount,
            released: firstJob.receipt!.releasedAmount,
            balanceAfterUnits: firstJob.receipt!.balanceAfterUnits,
            events: firstJob.events,
          },
          replay: {
            requestKey: submittedInputs[0].key,
            sameJobId: replayedJob.id === firstJob.id,
            sameReceiptId: replayedJob.receipt?.id === firstJob.receipt!.id,
            balanceUnchanged: afterReplay.balance === beforeReplay.balance,
          },
          second: {
            id: secondJob.id,
            receiptId: secondJob.receipt!.id,
            charge: secondJob.receipt!.amount,
            released: secondJob.receipt!.releasedAmount,
            balanceAfterUnits: secondJob.receipt!.balanceAfterUnits,
            events: secondJob.events,
          },
          isolation: { otherSessionBalance: '0', crossSessionReadStatus: 404 },
        },
        null,
        2,
      ),
    ),
    contentType: 'application/json',
  });

  expect(errors).toEqual([]);
});
