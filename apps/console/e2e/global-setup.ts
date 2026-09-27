import { copyFile, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import next from 'next';

export default async function globalSetup() {
  const root = process.cwd();
  const target = resolve(root, '../../.resvary/console-e2e.sqlite');
  await mkdir(dirname(target), { recursive: true });
  await Promise.all(
    [target, `${target}-wal`, `${target}-shm`].map((path) => rm(path, { force: true })),
  );
  await copyFile(resolve(root, 'fixtures/demo.sqlite'), target);

  const { CreditLedger, DurableMeteredOperations } = await import('@resvary/sdk/credits');
  const { createSqliteCreditStore } = await import('@resvary/sqlite');
  const store = createSqliteCreditStore({ path: target });
  const now = Date.now() - 3 * 3_600_000;
  const ledger = new CreditLedger({
    projectId: 'project_demo',
    store,
    now: () => now,
    reservationTtlMs: 86_400_000,
  });
  await ledger.registerMeter({
    key: 'recovery_jobs',
    dimensions: ['jobs'],
    idempotencyKey: 'recovery-meter',
  });
  const price = await ledger.createPriceVersion({
    meterKey: 'recovery_jobs',
    rates: [{ dimension: 'jobs', unitSize: '1', amount: '1' }],
    idempotencyKey: 'recovery-price',
  });
  await ledger.grantCredits({
    customerId: 'cus_recovery',
    amount: '20',
    idempotencyKey: 'recovery-grant',
  });
  const operations = new DurableMeteredOperations(ledger, { now: () => now });
  for (const key of ['e2e-saved-job', 'e2e-unknown-job', 'e2e-reconcile-job', 'e2e-running-job']) {
    await operations.create({
      customerId: 'cus_recovery',
      priceId: price.id,
      estimatedUsage: { jobs: '1' },
      idempotencyKey: key,
    });
    const claimed = await operations.claim({ operationKey: key, workerId: 'e2e-private-worker' });
    if (key === 'e2e-unknown-job')
      await operations.markOutcomeUnknown({
        operationKey: key,
        reason: 'Synthetic provider timeout',
      });
    else if (key !== 'e2e-running-job') {
      await operations.saveResult({
        operationKey: key,
        claimToken: claimed!.claimToken!,
        result: {
          value: 'e2e-private-provider-output',
          actualUsage: { jobs: key === 'e2e-reconcile-job' ? '2' : '1' },
          usageEventId: key,
        },
      });
      if (key === 'e2e-reconcile-job') await operations.settle(key);
    }
  }
  store.close();

  process.env.RESVARY_PROJECT_ID = 'project_demo';
  process.env.RESVARY_CONSOLE_ADMIN_SECRET = 'e2e-admin-secret-with-at-least-32-characters';
  process.env.RESVARY_SQLITE_PATH = target;
  delete process.env.RESVARY_CONSOLE_DEMO_MODE;
  delete process.env.DATABASE_URL;

  const app = next({ dev: false, dir: root });
  const handle = app.getRequestHandler();
  await app.prepare();
  const server = createServer((request, response) => handle(request, response));
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(3010, resolveListen);
  });

  return async () => {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await app.close();
  };
}
