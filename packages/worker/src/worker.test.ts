import { describe, expect, it, vi } from 'vitest';
import { CreditLedger, InMemoryCreditStore } from '@resvary/sdk/credits';
import { OutboxWorker } from './worker.js';

describe('OutboxWorker', () => {
  it('delivers a claimed event exactly once', async () => {
    const store = new InMemoryCreditStore();
    const ledger = new CreditLedger({ projectId: 'project', store, now: () => 1_000 });
    await ledger.grantCredits({ customerId: 'customer', amount: '1', idempotencyKey: 'grant' });
    const deliver = vi.fn().mockResolvedValue({ delivered: true, retryable: false });
    const worker = new OutboxWorker({
      store,
      transport: { deliver },
      workerId: 'worker',
      now: () => 2_000,
    });

    expect(await worker.runOnce()).toBe(1);
    expect(await worker.runOnce()).toBe(0);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect((await store.listOutboxEvents())[0]?.status).toBe('delivered');
  });

  it('recovers an expired lease and dead-letters after the attempt limit', async () => {
    const store = new InMemoryCreditStore();
    const ledger = new CreditLedger({ projectId: 'project', store, now: () => 1_000 });
    await ledger.grantCredits({ customerId: 'customer', amount: '1', idempotencyKey: 'grant' });
    await store.claimOutboxEvents({ workerId: 'crashed', now: 1_000, leaseMs: 100, limit: 1 });
    const worker = new OutboxWorker({
      store,
      transport: {
        deliver: vi.fn().mockResolvedValue({ delivered: false, retryable: true, error: 'offline' }),
      },
      workerId: 'replacement',
      maxAttempts: 2,
      now: () => 2_000,
      random: () => 0.5,
    });

    expect(await worker.runOnce()).toBe(1);
    expect((await store.listOutboxEvents())[0]?.status).toBe('dead_letter');
  });

  it('fences a stale attempt even when a replacement uses the same worker id', async () => {
    const store = new InMemoryCreditStore();
    const ledger = new CreditLedger({ projectId: 'project', store, now: () => 1_000 });
    await ledger.grantCredits({ customerId: 'customer', amount: '1', idempotencyKey: 'grant' });
    const [first] = await store.claimOutboxEvents({
      workerId: 'replica',
      now: 1_000,
      leaseMs: 100,
      limit: 1,
    });
    const [replacement] = await store.claimOutboxEvents({
      workerId: 'replica',
      now: 2_000,
      leaseMs: 100,
      limit: 1,
    });

    await expect(
      store.completeOutboxEvent(first!.id, 'replica', 2_001, first!.attemptCount),
    ).rejects.toThrow('lease attempt changed');
    await expect(
      store.completeOutboxEvent(replacement!.id, 'replica', 2_002, replacement!.attemptCount),
    ).resolves.toBeUndefined();
  });

  it('rejects unsafe worker configuration', () => {
    const store = new InMemoryCreditStore();
    const transport = { deliver: vi.fn() };
    expect(() => new OutboxWorker({ store, transport, batchSize: 0 })).toThrow('batchSize');
    expect(() => new OutboxWorker({ store, transport, leaseMs: 0 })).toThrow('leaseMs');
    expect(() => new OutboxWorker({ store, transport, maxAttempts: 1.5 })).toThrow('integer');
    expect(
      () => new OutboxWorker({ store, transport, baseRetryMs: 2_000, maxRetryMs: 1_000 }),
    ).toThrow('maxRetryMs');
  });
});
