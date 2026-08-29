import { describe, expect, it } from 'vitest';
import { CreditLedger } from '../credits/index.js';
import { InMemoryReceiptStore, createReceipt } from '../receipts/index.js';
import { ArcCreditFunding } from './arc.js';
import { ArcFundingWorker } from './arc-worker.js';

const seller = '0x1111111111111111111111111111111111111111';
const buyer = '0x2222222222222222222222222222222222222222';
const txHash = `0x${'ab'.repeat(32)}` as `0x${string}`;

describe('ArcFundingWorker', () => {
  it('refuses to reconcile a saved receipt without fresh RPC verification', async () => {
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

    await expect(worker.reconcile()).rejects.toThrow('not found');
    const confirmed = await ledger.getFundingIntent(request.fundingIntent.id);
    const account = await ledger.store.getAccount(request.fundingIntent.accountId);
    expect(confirmed?.status).toBe('pending');
    expect(account?.availableAmount).toBe('0');
    expect(await ledger.listFundingTransactions()).toHaveLength(0);
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
