// Runs from the independent tarball installation, with no workspace imports.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { CreditLedger, DurableMeteredOperations } from '@resvary/sdk/credits';
import {
  getOperationEvidence,
  OperatorService,
  type AdminOperationStore,
  type OperatorSettlementInput,
} from '@resvary/sdk/admin';
import { createSqliteCreditStore } from '@resvary/sqlite';
import { createSqliteAdminStore } from '@resvary/sqlite/admin';
import { createPostgresAdminStore } from '@resvary/postgres/admin';

// Both published adapters must expose the optional operation-query capability.
const postgresFactory: (
  config: Parameters<typeof createPostgresAdminStore>[0],
) => AdminOperationStore = createPostgresAdminStore;
void postgresFactory;

const projectId = 'release_smoke';
const operationKey = 'saved-report';
const customerId = 'customer';
const path = resolve('operation-recovery.sqlite');
let store = createSqliteCreditStore({ path });
const admin = createSqliteAdminStore({ path });
const queries: AdminOperationStore = admin;

try {
  const ledger = new CreditLedger({ projectId, store });
  await ledger.registerMeter({ key: 'reports', dimensions: ['reports'], idempotencyKey: 'meter' });
  const price = await ledger.createPriceVersion({
    meterKey: 'reports',
    rates: [{ dimension: 'reports', unitSize: '1', amount: '2' }],
    idempotencyKey: 'price',
  });
  await ledger.grantCredits({ customerId, amount: '10', idempotencyKey: 'grant' });
  const operations = new DurableMeteredOperations(ledger);
  await operations.create({
    customerId,
    priceId: price.id,
    estimatedUsage: { reports: '1' },
    idempotencyKey: operationKey,
  });
  const claim = await operations.claim({ operationKey, workerId: 'release-worker' });
  assert.ok(claim?.claimToken);
  await operations.saveResult({
    operationKey,
    claimToken: claim.claimToken,
    result: {
      value: { privatePayload: 'must-not-reach-admin' },
      actualUsage: { reports: '1' },
      usageEventId: 'report-usage',
    },
  });

  store.close();
  store = createSqliteCreditStore({ path });
  const reopenedLedger = new CreditLedger({ projectId, store });
  const evidence = await getOperationEvidence(store, projectId, operationKey);
  assert.ok(evidence?.operation.resultHash);
  assert.equal(evidence.operation.status, 'result_saved');
  assert.equal(JSON.stringify(evidence).includes('must-not-reach-admin'), false);
  assert.equal(JSON.stringify(evidence).includes(claim.claimToken), false);
  assert.equal(
    (await queries.listOperations({ projectId, status: 'result_saved' })).items.length,
    1,
  );
  const operator = new OperatorService({
    projectId,
    ledger: reopenedLedger,
    adminStore: admin,
    deliveryStore: store,
  });
  const command: OperatorSettlementInput = {
    actionId: randomUUID(),
    operationKey,
    resultHash: evidence.operation.resultHash,
    reason: 'Verified saved usage from the installed release archives',
  };
  const first = await operator.settleOperation(command);
  const replay = await operator.settleOperation(command);
  // The persisted journal omits optional properties whose value is undefined.
  assert.deepEqual(JSON.parse(JSON.stringify(replay)), JSON.parse(JSON.stringify(first)));
  assert.equal((await reopenedLedger.listUsageReceipts(customerId)).length, 1);
  assert.equal((await reopenedLedger.getBalance(customerId)).postedAmount, '8');
  const history = await queries.listOperationHistory(projectId, evidence.operation.id);
  assert.equal(history.items[0]?.toStatus, 'settled');
  assert.equal((await queries.getOperationHealth(projectId)).unresolvedCount, 0);
  console.log('Installed operation recovery, safe evidence, history, and command replay passed.');
} finally {
  admin.close();
  store.close();
}
