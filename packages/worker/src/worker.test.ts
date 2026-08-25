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
});
