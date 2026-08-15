import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PersistentReceiptLedger,
  PersistentWebhookInbox,
  createWatcherCursorKey,
  createWebhookEvent,
  signWebhookEvent,
} from '@resvary/sdk/receipts';
import { createSqliteReceiptStore } from './index.js';

const seller = '0x1111111111111111111111111111111111111111' as const;
const buyer = '0x2222222222222222222222222222222222222222' as const;
const txHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;

describe('SqliteReceiptStore', () => {
  it('persists invoices, receipts, webhook events, deliveries, and cursors', async () => {
    const dbPath = tempDatabasePath();
    const store = createSqliteReceiptStore({ path: dbPath });
    const ledger = new PersistentReceiptLedger({ store });
    const invoice = await ledger.createInvoice({ id: 'inv_sqlite', amount: '2.00', payTo: seller });
    const receipt = await ledger.recordPayment(invoice.id, {
      txHash,
      from: buyer,
      to: seller,
      amount: '2.00',
      memo: invoice.memo,
      blockNumber: 12n,
    });
    const event = createWebhookEvent('invoice.paid', { invoice, receipt }, 1_700_000_000_000);
    const inbox = new PersistentWebhookInbox({ store });
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
    await store.saveWatcherCursor({
      key: cursorKey,
      network: invoice.network,
      invoiceId: invoice.id,
      memoId: invoice.memoId,
      nextFromBlock: 13n,
      updatedAt: 1_700_000_001_000,
    });
    store.close();

    const reloaded = createSqliteReceiptStore({ path: dbPath });
    expect((await reloaded.getInvoice(invoice.id))?.status).toBe('paid');
    expect((await reloaded.getReceipt(receipt.id))?.blockNumber).toBe(12n);
    expect(await reloaded.getReceiptByTxHash(txHash, invoice.id)).toMatchObject({
      id: receipt.id,
    });
    expect((await reloaded.getWebhookDelivery(delivery.id))?.attempt).toBe(1);
    expect((await reloaded.getWatcherCursor(cursorKey))?.nextFromBlock).toBe(13n);
    reloaded.close();
  });

  it('enforces duplicate tx idempotency through PersistentReceiptLedger', async () => {
    const store = createSqliteReceiptStore({ path: tempDatabasePath() });
    const ledger = new PersistentReceiptLedger({ store });
    const invoice = await ledger.createInvoice({ id: 'inv_sqlite_dupe', amount: '1', payTo: seller });
    const payment = {
      txHash,
      from: buyer,
      to: seller,
      amount: '1',
      memo: invoice.memo,
    };

    const first = await ledger.recordPayment(invoice.id, payment);
    const second = await ledger.recordPayment(invoice.id, payment);

    expect(second.id).toBe(first.id);
    expect(await ledger.listReceipts()).toHaveLength(1);
    store.close();
  });
});

function tempDatabasePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'resvary-sqlite-')), 'receipts.sqlite');
}
