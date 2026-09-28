// Run after npm run build:core. Uses synthetic usage; no AI or payment provider is called.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CreditLedger, DurableMeteredOperations } from '@resvary/sdk/credits';
import { getOperationEvidence, OperatorService } from '@resvary/sdk/admin';
import { createSqliteCreditStore } from '@resvary/sqlite';
import { createSqliteAdminStore } from '@resvary/sqlite/admin';

const projectId = 'recovery_example';
const operationKey = 'background-report-001';
const phase = process.argv[2];
const directory =
  phase === 'worker' ? process.argv[3] : mkdtempSync(join(tmpdir(), 'resvary-recovery-example-'));
const path = join(directory, 'ledger.sqlite');
const counterPath = join(directory, 'provider-calls.json');

if (phase === 'worker') {
  const store = createSqliteCreditStore({ path });
  const ledger = new CreditLedger({ projectId, store });
  await ledger.registerMeter({ key: 'reports', dimensions: ['reports'], idempotencyKey: 'meter' });
  const price = await ledger.createPriceVersion({
    meterKey: 'reports',
    rates: [{ dimension: 'reports', unitSize: '1', amount: '2' }],
    idempotencyKey: 'price',
  });
  await ledger.grantCredits({ customerId: 'customer', amount: '10', idempotencyKey: 'grant' });
  const operations = new DurableMeteredOperations(ledger);
  await operations.create({
    customerId: 'customer',
    priceId: price.id,
    estimatedUsage: { reports: '1' },
    idempotencyKey: operationKey,
  });
  const claim = await operations.claim({ operationKey, workerId: 'report-worker' });
  assert.ok(claim, 'Only the worker holding the claim can execute the provider request');

  // Stand-in for an external provider side effect. The durable counter survives the process.
  writeFileSync(counterPath, JSON.stringify({ calls: 1 }));
  await operations.saveResult({
    operationKey,
    claimToken: claim.claimToken,
    result: {
      value: { reportId: 'synthetic-report' },
      actualUsage: { reports: '1' },
      usageEventId: 'synthetic-report-001',
    },
  });
  // Abrupt exit after saving the result, before settling the charge or closing the database.
  process.exit(42);
}

const worker = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'worker', directory], {
  stdio: 'inherit',
});
assert.equal(worker.status, 42, 'Worker must stop at the simulated crash boundary');

const store = createSqliteCreditStore({ path });
const admin = createSqliteAdminStore({ path });
try {
  const ledger = new CreditLedger({ projectId, store });
  const evidence = await getOperationEvidence(store, projectId, operationKey);
  assert.equal(evidence.operation.status, 'result_saved');
  const operator = new OperatorService({
    projectId,
    ledger,
    adminStore: admin,
    deliveryStore: store,
  });
  const command = {
    actionId: randomUUID(),
    operationKey,
    resultHash: evidence.operation.resultHash,
    reason: 'Verified saved usage after the background worker exited',
  };
  const recovered = await operator.settleOperation(command);
  const replay = await operator.settleOperation(command);
  assert.equal(recovered.result.operation.receiptId, replay.result.operation.receiptId);
  assert.equal((await ledger.listUsageReceipts('customer')).length, 1);
  assert.equal((await ledger.getBalance('customer')).postedAmount, '8');
  assert.equal(JSON.parse(readFileSync(counterPath, 'utf8')).calls, 1);
  console.log(
    JSON.stringify(
      {
        operation: recovered.result.operation.status,
        providerCalls: 1,
        receipts: 1,
        balance: '8',
        database: path,
      },
      null,
      2,
    ),
  );
} finally {
  admin.close();
  store.close();
}
