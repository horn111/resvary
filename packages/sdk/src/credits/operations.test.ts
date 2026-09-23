import { describe, expect, it } from 'vitest';
import { CreditLedger } from './ledger.js';
import { DurableMeteredOperations } from './operations.js';
import { InMemoryCreditStore } from './store.js';

async function fixture() {
  let now = 1_000;
  const store = new InMemoryCreditStore();
  const ledger = new CreditLedger({
    projectId: 'operations',
    store,
    now: () => now,
    reservationTtlMs: 100,
  });
  const meter = await ledger.registerMeter({
    key: 'jobs',
    dimensions: ['jobs'],
    idempotencyKey: 'meter',
  });
  const price = await ledger.createPriceVersion({
    meterKey: meter.key,
    rates: [{ dimension: 'jobs', unitSize: '1', amount: '1' }],
    idempotencyKey: 'price',
  });
  await ledger.grantCredits({ customerId: 'customer', amount: '10', idempotencyKey: 'grant' });
  const input = {
    customerId: 'customer',
    priceId: price.id,
    estimatedUsage: { jobs: '1' },
    idempotencyKey: 'job-1',
  };
  const operations = new DurableMeteredOperations(ledger, { now: () => now });
  return {
    store,
    ledger,
    operations,
    input,
    setNow: (value: number) => {
      now = value;
    },
  };
}

describe('DurableMeteredOperations', () => {
  it('claims once across workers, then settles a saved result after coordinator restart', async () => {
    const { ledger, store, operations, input } = await fixture();
    const created = await operations.create(input);
    expect((await operations.create(input)).id).toBe(created.id);
    await expect(
      operations.create({ ...input, estimatedUsage: { jobs: '2' } }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });

    const second = new DurableMeteredOperations(
      new CreditLedger({ projectId: 'operations', store, now: () => 1_000 }),
      { now: () => 1_000 },
    );
    const claims = await Promise.all([
      operations.claim({ operationKey: input.idempotencyKey, workerId: 'one' }),
      second.claim({ operationKey: input.idempotencyKey, workerId: 'two' }),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claim = claims.find(Boolean)!;
    const saved = await operations.saveResult({
      operationKey: input.idempotencyKey,
      claimToken: claim.claimToken!,
      result: {
        value: { providerId: 'answer-1' },
        actualUsage: { jobs: '1' },
        usageEventId: 'usage-1',
      },
    });
    expect(saved.status).toBe('result_saved');
    const settled = await second.settle(input.idempotencyKey);
    expect(settled.operation.status).toBe('settled');
    expect(settled.receipt?.usageEventId).toBe('usage-1');
    expect((await operations.settle(input.idempotencyKey)).receipt?.id).toBe(settled.receipt?.id);
    expect(await ledger.listUsageReceipts('customer')).toHaveLength(1);
    expect((await ledger.getBalance('customer')).postedAmount).toBe('9');
  });

  it('keeps a saved result through hold expiry and charges it only by explicit reconciliation', async () => {
    const { ledger, operations, input, setNow } = await fixture();
    await operations.create(input);
    const claim = await operations.claim({ operationKey: input.idempotencyKey, workerId: 'one' });
    await operations.saveResult({
      operationKey: input.idempotencyKey,
      claimToken: claim!.claimToken!,
      result: { value: 'answer', actualUsage: { jobs: '1' }, usageEventId: 'usage-expired' },
    });
    setNow(1_101);
    const unresolved = await operations.settle(input.idempotencyKey);
    expect(unresolved).toMatchObject({ operation: { status: 'needs_reconciliation' } });
    expect(unresolved.receipt).toBeUndefined();
    expect((await ledger.getBalance('customer')).availableAmount).toBe('10');
    const reconciled = await operations.reconcile(input.idempotencyKey);
    expect(reconciled.operation.status).toBe('settled');
    expect(reconciled.receipt?.usageEventId).toBe('usage-expired');
    expect(reconciled.receipt?.reservationId).not.toBe(claim!.reservationId);
    expect(await ledger.listUsageReceipts('customer')).toHaveLength(1);
    expect((await ledger.getBalance('customer')).postedAmount).toBe('9');
  });

  it('replays an already committed usage event after a crash before the operation update', async () => {
    const { ledger, operations, input } = await fixture();
    const created = await operations.create(input);
    const claim = await operations.claim({ operationKey: input.idempotencyKey, workerId: 'one' });
    await operations.saveResult({
      operationKey: input.idempotencyKey,
      claimToken: claim!.claimToken!,
      result: { value: 'answer', actualUsage: { jobs: '1' }, usageEventId: 'usage-crash' },
    });
    const committed = await ledger.commitUsage({
      reservationId: created.reservationId,
      usageEventId: 'usage-crash',
      actualUsage: { jobs: '1' },
      idempotencyKey: `${created.id}:commit:${created.reservationId}`,
    });
    expect((await operations.get(input.idempotencyKey))?.status).toBe('result_saved');
    const replay = await operations.settle(input.idempotencyKey);
    expect(replay.operation.status).toBe('settled');
    expect(replay.receipt?.id).toBe(committed.receipt.id);
    expect(await ledger.listUsageReceipts('customer')).toHaveLength(1);
  });

  it('does not attach a different external charge to a saved provider result', async () => {
    const { ledger, operations, input } = await fixture();
    const created = await operations.create(input);
    const claim = await operations.claim({ operationKey: input.idempotencyKey, workerId: 'one' });
    await operations.saveResult({
      operationKey: input.idempotencyKey,
      claimToken: claim!.claimToken!,
      result: { value: 'answer', actualUsage: { jobs: '1' }, usageEventId: 'saved-event' },
    });
    await ledger.commitUsage({
      reservationId: created.reservationId,
      usageEventId: 'other-event',
      actualUsage: { jobs: '1' },
      idempotencyKey: 'external-commit',
    });
    await expect(operations.settle(input.idempotencyKey)).rejects.toMatchObject({
      code: 'invalid_state',
    });
    expect((await operations.get(input.idempotencyKey))?.status).toBe('result_saved');
  });

  it('keeps reconciliation pending when the released balance was spent', async () => {
    const { ledger, operations, input, setNow } = await fixture();
    await operations.create(input);
    const claim = await operations.claim({ operationKey: input.idempotencyKey, workerId: 'one' });
    await operations.saveResult({
      operationKey: input.idempotencyKey,
      claimToken: claim!.claimToken!,
      result: { value: 'answer', actualUsage: { jobs: '1' }, usageEventId: 'usage-unfunded' },
    });
    setNow(1_101);
    await operations.settle(input.idempotencyKey);
    await ledger.adjustCredits({
      customerId: 'customer',
      amount: '-10',
      reason: 'other charges',
      idempotencyKey: 'spend-all',
    });
    await expect(operations.reconcile(input.idempotencyKey)).rejects.toMatchObject({
      code: 'insufficient_credits',
    });
    expect((await operations.get(input.idempotencyKey))?.status).toBe('needs_reconciliation');
    expect(await ledger.listUsageReceipts('customer')).toHaveLength(0);
    await ledger.grantCredits({ customerId: 'customer', amount: '1', idempotencyKey: 'new-funds' });
    expect((await operations.reconcile(input.idempotencyKey)).receipt?.usageEventId).toBe(
      'usage-unfunded',
    );
  });

  it('requires external evidence for unknown outcomes and never reclaims a running call', async () => {
    const { ledger, operations, input } = await fixture();
    await operations.create(input);
    const claim = await operations.claim({ operationKey: input.idempotencyKey, workerId: 'one' });
    await operations.markOutcomeUnknown({
      operationKey: input.idempotencyKey,
      reason: 'worker exited',
    });
    expect(
      await operations.claim({ operationKey: input.idempotencyKey, workerId: 'two' }),
    ).toBeUndefined();
    await expect(
      operations.confirmNotExecuted({ operationKey: input.idempotencyKey, evidenceReference: '' }),
    ).rejects.toThrow('evidenceReference');
    await operations.recoverResult({
      operationKey: input.idempotencyKey,
      evidenceReference: 'provider-lookup:answer-1',
      result: {
        value: { providerId: 'answer-1' },
        actualUsage: { jobs: '1' },
        usageEventId: 'usage-recovered',
      },
    });
    expect((await operations.settle(input.idempotencyKey)).receipt?.usageEventId).toBe(
      'usage-recovered',
    );
    expect((await ledger.getBalance('customer')).postedAmount).toBe('9');
    expect(claim?.workerId).toBe('one');
  });

  it('cancels an unclaimed operation whose reservation expired', async () => {
    const { ledger, operations, input, setNow } = await fixture();
    await operations.create(input);
    setNow(1_101);
    expect(
      await operations.claim({ operationKey: input.idempotencyKey, workerId: 'late' }),
    ).toBeUndefined();
    expect((await operations.get(input.idempotencyKey))?.status).toBe('cancelled');
    expect((await ledger.getBalance('customer')).availableAmount).toBe('10');
  });

  it('cancels an unknown outcome only after explicit negative evidence', async () => {
    const { ledger, operations, input } = await fixture();
    await operations.create(input);
    await operations.claim({ operationKey: input.idempotencyKey, workerId: 'one' });
    await operations.markOutcomeUnknown({ operationKey: input.idempotencyKey, reason: 'timeout' });
    const cancelled = await operations.confirmNotExecuted({
      operationKey: input.idempotencyKey,
      evidenceReference: 'provider-query:no-request-for-job-1',
    });
    expect(cancelled.status).toBe('cancelled');
    expect((await ledger.getBalance('customer')).availableAmount).toBe('10');
    expect(await ledger.listUsageReceipts('customer')).toHaveLength(0);
  });
});
