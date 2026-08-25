import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { CreditLedger } from '@resvary/sdk/credits';
import {
  PersistentReceiptLedger,
  PersistentWebhookInbox,
  createWatcherCursorKey,
  createWebhookEvent,
  signWebhookEvent,
} from '@resvary/sdk/receipts';
import { createPostgresCreditStore } from './credit.js';
import { migratePostgres } from './migrations.js';
import { createPostgresReceiptStore } from './receipt.js';

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;

suite('Postgres stores', () => {
  const schema = `resvary_test_${randomUUID().replaceAll('-', '')}`;
  const pool = connectionString ? new Pool({ connectionString }) : undefined;

  beforeAll(async () => {
    await migratePostgres({ pool: pool!, schema });
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });

  it('applies schema migrations idempotently', async () => {
    const status = await migratePostgres({ pool: pool!, schema });
    expect(status).toMatchObject({ currentVersion: 1, latestVersion: 1, pendingVersions: [] });
  });

  it('serializes reservations across independent store instances', async () => {
    const firstStore = createPostgresCreditStore({ pool: pool!, schema });
    const secondStore = createPostgresCreditStore({ pool: pool!, schema });
    const first = new CreditLedger({ projectId: 'project', store: firstStore });
    const second = new CreditLedger({ projectId: 'project', store: secondStore });
    await first.grantCredits({ customerId: 'customer', amount: '1', idempotencyKey: 'grant' });
    const meter = await first.registerMeter({
      key: 'jobs',
      dimensions: ['jobs'],
      idempotencyKey: 'meter',
    });
    const price = await first.createPriceVersion({
      meterKey: meter.key,
      rates: [{ dimension: 'jobs', unitSize: '1', amount: '0.75' }],
      idempotencyKey: 'price',
    });

    const results = await Promise.allSettled([
      first.reserveCredits({
        customerId: 'customer',
        priceId: price.id,
        estimatedUsage: { jobs: '1' },
        idempotencyKey: 'reserve-a',
      }),
      second.reserveCredits({
        customerId: 'customer',
        priceId: price.id,
        estimatedUsage: { jobs: '1' },
        idempotencyKey: 'reserve-b',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await first.getBalance('customer')).availableAmount).toBe('0.25');
  });

  it('claims disjoint outbox batches and persists receipts', async () => {
    const firstStore = createPostgresCreditStore({ pool: pool!, schema });
    const secondStore = createPostgresCreditStore({ pool: pool!, schema });
    const [firstClaim, secondClaim] = await Promise.all([
      firstStore.claimOutboxEvents({
        workerId: 'worker-a',
        now: Date.now(),
        leaseMs: 30_000,
        limit: 10,
      }),
      secondStore.claimOutboxEvents({
        workerId: 'worker-b',
        now: Date.now(),
        leaseMs: 30_000,
        limit: 10,
      }),
    ]);
    const ids = [...firstClaim, ...secondClaim].map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);

    const receipts = createPostgresReceiptStore({ pool: pool!, schema });
    const receiptLedger = new PersistentReceiptLedger({ store: receipts });
    const invoice = await receiptLedger.createInvoice({
      id: 'invoice_pg',
      amount: '1',
      payTo: '0x1111111111111111111111111111111111111111',
    });
    const receipt = await receiptLedger.recordPayment(invoice.id, {
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      from: '0x2222222222222222222222222222222222222222',
      to: invoice.payTo,
      amount: invoice.amount,
      memo: invoice.memo,
      blockNumber: 12n,
    });
    const event = createWebhookEvent('invoice.paid', { invoice, receipt }, 1_700_000_000_000);
    const inbox = new PersistentWebhookInbox({ store: receipts });
    const delivery = await inbox.receive({
      payload: event,
      header: signWebhookEvent(event, 'secret', 1_700_000_000).header,
      secret: 'secret',
      now: 1_700_000_000,
    });
    const cursorKey = createWatcherCursorKey({
      network: invoice.network,
      invoiceId: invoice.id,
      memoId: invoice.memoId,
    });
    await receipts.saveWatcherCursor({
      key: cursorKey,
      network: invoice.network,
      invoiceId: invoice.id,
      memoId: invoice.memoId,
      nextFromBlock: 13n,
      updatedAt: 1_700_000_001_000,
    });

    expect((await receipts.getInvoice(invoice.id))?.status).toBe('paid');
    expect((await receipts.getReceipt(receipt.id))?.blockNumber).toBe(12n);
    expect((await receipts.getWebhookDelivery(delivery.id))?.attempt).toBe(1);
    expect((await receipts.getWatcherCursor(cursorKey))?.nextFromBlock).toBe(13n);

    const concurrentInvoice = await receiptLedger.createInvoice({
      id: 'invoice_pg_concurrent',
      amount: '2',
      payTo: invoice.payTo,
    });
    const payment = {
      txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const,
      from: '0x2222222222222222222222222222222222222222' as const,
      to: concurrentInvoice.payTo,
      amount: concurrentInvoice.amount,
      memo: concurrentInvoice.memo,
    };
    const [concurrentA, concurrentB] = await Promise.all([
      new PersistentReceiptLedger({ store: receipts }).recordPayment(concurrentInvoice.id, payment),
      new PersistentReceiptLedger({ store: receipts }).recordPayment(concurrentInvoice.id, payment),
    ]);
    expect(concurrentB.id).toBe(concurrentA.id);
  });
});
