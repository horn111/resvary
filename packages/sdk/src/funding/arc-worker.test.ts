import { describe, expect, it } from 'vitest';
import { CreditLedger } from '../credits/index.js';
import { InMemoryReceiptStore, createReceipt } from '../receipts/index.js';
import { ArcCreditFunding } from './arc.js';
import { ArcFundingWorker } from './arc-worker.js';

const seller = '0x1111111111111111111111111111111111111111';
const buyer = '0x2222222222222222222222222222222222222222';
const txHash = `0x${'ab'.repeat(32)}` as `0x${string}`;

describe('ArcFundingWorker', () => {
  it('reconciles a saved receipt after a crash before credit grant', async () => {
    const ledger = new CreditLedger({ projectId: 'project_arc_worker' });
    const receiptStore = new InMemoryReceiptStore();
    const funding = new ArcCreditFunding({
      ledger,
      receiptStore,
      payTo: seller,
    });
    const request = await funding.createFundingRequest({
      customerId: 'customer_1',
      amount: '12.50',
      idempotencyKey: 'create_arc_1',
    });
    const receipt = createReceipt(request.invoice, {
      txHash,
      from: buyer,
      to: seller,
      amount: '12.50',
      network: request.invoice.network,
      currency: 'USDC',
      memo: request.invoice.memo,
      memoId: request.invoice.memoId,
      observedAt: Date.now(),
    });
    await receiptStore.saveReceipt(receipt);

    const worker = new ArcFundingWorker({
      ledger,
      receiptStore,
      payTo: seller,
      publicClient: {
        getBlockNumber: async () => 0n,
        getLogs: async () => [],
        getTransactionReceipt: async () => {
          throw new Error('not needed during reconciliation');
        },
        getChainId: async () => 5_042_002,
      } as any,
    });

    expect(await worker.reconcile()).toBe(1);
    const confirmed = await ledger.getFundingIntent(request.fundingIntent.id);
    const account = await ledger.store.getAccount(request.fundingIntent.accountId);
    expect(confirmed?.status).toBe('confirmed');
    expect(account?.availableAmount).toBe('12.5');

    expect(await worker.reconcile()).toBe(0);
    expect(await ledger.listFundingTransactions()).toHaveLength(1);
  });

  it('restores pending invoices from the persistent receipt store', async () => {
    const ledger = new CreditLedger({ projectId: 'project_arc_resume' });
    const receiptStore = new InMemoryReceiptStore();
    const funding = new ArcCreditFunding({ ledger, receiptStore, payTo: seller });
    await funding.createFundingRequest({
      customerId: 'customer_2',
      amount: '2',
      idempotencyKey: 'create_arc_2',
    });
    const worker = new ArcFundingWorker({
      ledger,
      receiptStore,
      payTo: seller,
      publicClient: {
        getBlockNumber: async () => 0n,
        getLogs: async () => [],
        getTransactionReceipt: async () => {
          throw new Error('not needed');
        },
        getChainId: async () => 5_042_002,
      } as any,
    });

    const resumed = await worker.resumePendingIntents();
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.rail).toBe('arc_direct');
  });
});
