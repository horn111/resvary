import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CreditLedger, InsufficientCreditsError, type CreditAccount } from '@settlary/sdk/credits';
import { createSqliteCreditStore } from './credit.js';

describe('SqliteCreditStore', () => {
  it('persists balances, reservations, usage receipts, ledger, outbox, and idempotency across restarts', async () => {
    const path = tempDatabasePath();
    const firstStore = createSqliteCreditStore({ path });
    const first = new CreditLedger({ projectId: 'project_ai', store: firstStore });
    const meter = await first.registerMeter({
      key: 'tokens',
      dimensions: ['tokens'],
      idempotencyKey: 'meter-1',
    });
    const price = await first.createPriceVersion({
      meterKey: meter.key,
      rates: [{ dimension: 'tokens', unitSize: '1000', amount: '0.01' }],
      idempotencyKey: 'price-1',
    });
    await first.grantCredits({ customerId: 'cus_1', amount: '2', idempotencyKey: 'grant-1' });
    const reservation = await first.reserveCredits({
      customerId: 'cus_1',
      priceId: price.id,
      estimatedUsage: { tokens: '1000' },
      idempotencyKey: 'reserve-1',
    });
    const committed = await first.commitUsage({
      reservationId: reservation.id,
      usageEventId: 'provider-1',
      actualUsage: { tokens: '400' },
      idempotencyKey: 'commit-1',
    });
    firstStore.close();

    const secondStore = createSqliteCreditStore({ path });
    const second = new CreditLedger({ projectId: 'project_ai', store: secondStore });
    expect(await second.getBalance('cus_1')).toMatchObject({
      postedAmount: '1.996',
      reservedAmount: '0',
    });
    expect((await second.getUsageReceipt(committed.receipt.id))?.usageEventId).toBe('provider-1');
    expect(await second.listLedgerEntries('cus_1')).toHaveLength(4);
    expect((await second.listOutboxEvents()).map((event) => event.type)).toEqual([
      'credit.granted',
      'credit.reserved',
      'usage.charged',
    ]);
    const replay = await second.grantCredits({
      customerId: 'cus_1',
      amount: '2',
      idempotencyKey: 'grant-1',
    });
    expect(replay.account.postedAmount).toBe('2');
    expect((await second.getBalance('cus_1')).postedAmount).toBe('1.996');
    secondStore.close();
  });

  it('rolls a failed transaction back completely', async () => {
    const store = createSqliteCreditStore({ path: tempDatabasePath() });
    const account: CreditAccount = {
      id: 'acct_rollback',
      projectId: 'project_ai',
      customerId: 'cus_rollback',
      currency: 'USD',
      postedUnits: '1000000',
      reservedUnits: '0',
      availableUnits: '1000000',
      postedAmount: '1',
      reservedAmount: '0',
      availableAmount: '1',
      createdAt: 1,
      updatedAt: 1,
    };
    await expect(
      store.transaction(async (tx) => {
        await tx.saveAccount(account);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await store.getAccount(account.id)).toBeUndefined();
    store.close();
  });

  it('serializes parallel reservations against the same account', async () => {
    const store = createSqliteCreditStore({ path: tempDatabasePath() });
    const ledger = new CreditLedger({ projectId: 'project_ai', store });
    const meter = await ledger.registerMeter({
      key: 'jobs',
      dimensions: ['jobs'],
      idempotencyKey: 'meter-1',
    });
    const price = await ledger.createPriceVersion({
      meterKey: meter.key,
      rates: [{ dimension: 'jobs', unitSize: '1', amount: '1' }],
      idempotencyKey: 'price-1',
    });
    await ledger.grantCredits({ customerId: 'cus_1', amount: '1', idempotencyKey: 'grant-1' });
    const results = await Promise.allSettled(
      ['a', 'b'].map((key) =>
        ledger.reserveCredits({
          customerId: 'cus_1',
          priceId: price.id,
          estimatedUsage: { jobs: '1' },
          idempotencyKey: `reserve-${key}`,
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason).toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect((await ledger.getBalance('cus_1')).availableAmount).toBe('0');
    store.close();
  });
});

function tempDatabasePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'settlary-credits-')), 'settlary.sqlite');
}
