import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';
import { ARC_TESTNET_CONTRACTS } from '../constants.js';
import { CreditLedger, InvalidCreditStateError } from '../credits/index.js';
import {
  ARC_MEMO_ABI,
  InMemoryReceiptStore,
  createReceipt,
  type MemoPaymentRequest,
} from '../receipts/index.js';
import { ArcCreditFunding } from './arc.js';

const payTo = '0x1111111111111111111111111111111111111111' as const;
const payer = '0x2222222222222222222222222222222222222222' as const;
const txHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const blockHash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const transferEvent = parseAbiItem(
  'event Transfer(address indexed from,address indexed to,uint256 value)',
);
const memoEvent = ARC_MEMO_ABI.find((item) => item.type === 'event' && item.name === 'Memo');

describe('ArcCreditFunding', () => {
  it('converts a verified payment receipt into credits exactly once', async () => {
    const ledger = new CreditLedger({ projectId: 'project_ai' });
    const receiptStore = new InMemoryReceiptStore();
    const proofClient = createProofClient();
    const funding = new ArcCreditFunding({
      ledger,
      payTo,
      receiptStore,
      publicClient: proofClient,
    });
    const request = await funding.createFundingRequest({
      customerId: 'cus_1',
      amount: '5',
      idempotencyKey: 'intent-1',
    });
    proofClient.setPayment(request.paymentRequest, 5_250_000n);
    const receipt = createReceipt(request.invoice, {
      from: payer,
      to: payTo,
      amount: '5.25',
      memo: request.invoice.memo,
      txHash,
    });
    const first = await funding.confirmPayment({
      fundingIntentId: request.fundingIntent.id,
      receipt,
      idempotencyKey: 'confirm-1',
    });
    const rebuiltReceipt = createReceipt(
      request.invoice,
      {
        from: payer,
        to: payTo,
        amount: '5.25',
        memo: request.invoice.memo,
        txHash,
      },
      receipt.createdAt + 1_000,
    );
    expect(rebuiltReceipt.id).not.toBe(receipt.id);
    const replay = await funding.confirmPayment({
      fundingIntentId: request.fundingIntent.id,
      receipt: rebuiltReceipt,
      idempotencyKey: 'confirm-1',
    });
    expect(first.account.postedAmount).toBe('5.25');
    expect(replay.fundingTransaction.id).toBe(first.fundingTransaction.id);
    expect(replay.fundingTransaction.paymentReceiptId).toBe(receipt.id);
    expect(await ledger.listFundingTransactions(request.fundingIntent.id)).toHaveLength(1);
    expect((await ledger.getBalance('cus_1')).postedAmount).toBe('5.25');
  });

  it('rejects underpayment and reusing a transaction for another customer', async () => {
    const ledger = new CreditLedger({ projectId: 'project_ai' });
    const receiptStore = new InMemoryReceiptStore();
    const proofClient = createProofClient();
    const funding = new ArcCreditFunding({
      ledger,
      payTo,
      receiptStore,
      publicClient: proofClient,
    });
    const first = await funding.createFundingRequest({
      customerId: 'cus_1',
      amount: '5',
      idempotencyKey: 'intent-1',
    });
    proofClient.setPayment(first.paymentRequest, 4_000_000n);
    const validReceipt = createReceipt(first.invoice, {
      from: payer,
      to: payTo,
      amount: '5',
      memo: first.invoice.memo,
      txHash,
    });
    const underpaid = { ...validReceipt, amount: '4', amountUnits: '4000000' };
    await expect(
      funding.confirmPayment({
        fundingIntentId: first.fundingIntent.id,
        receipt: underpaid,
        idempotencyKey: 'underpaid',
      }),
    ).rejects.toThrow('no USDC Transfer for');

    proofClient.setPayment(first.paymentRequest, 5_000_000n);
    const paid = validReceipt;
    await funding.confirmPayment({
      fundingIntentId: first.fundingIntent.id,
      receipt: paid,
      idempotencyKey: 'paid',
    });
    const second = await funding.createFundingRequest({
      customerId: 'cus_2',
      amount: '5',
      idempotencyKey: 'intent-2',
    });
    proofClient.setPayment(second.paymentRequest, 5_000_000n);
    const duplicate = {
      ...paid,
      id: 'rcpt_duplicate',
      invoiceId: second.invoice.id,
      memo: second.invoice.memo,
    };
    await expect(
      funding.confirmPayment({
        fundingIntentId: second.fundingIntent.id,
        receipt: duplicate,
        idempotencyKey: 'duplicate',
      }),
    ).rejects.toBeInstanceOf(InvalidCreditStateError);
  });

  it('rejects a structural receipt when RPC proof verification fails', async () => {
    const ledger = new CreditLedger({ projectId: 'project_unverified' });
    const receiptStore = new InMemoryReceiptStore();
    const funding = new ArcCreditFunding({
      ledger,
      payTo,
      receiptStore,
      publicClient: {
        getTransactionReceipt: async () => null,
      },
    });
    const request = await funding.createFundingRequest({
      customerId: 'cus_unverified',
      amount: '1',
      idempotencyKey: 'intent_unverified',
    });
    const receipt = createReceipt(request.invoice, {
      from: payer,
      to: payTo,
      amount: '1',
      memo: request.invoice.memo,
      txHash,
    });

    await expect(
      funding.confirmPayment({
        fundingIntentId: request.fundingIntent.id,
        receipt,
        idempotencyKey: 'confirm_unverified',
      }),
    ).rejects.toThrow('not found');
    await expect(ledger.getFundingIntent(request.fundingIntent.id)).resolves.toMatchObject({
      status: 'pending',
    });
  });

  it('reconstructs trusted payment terms and binds the receipt to the funding invoice', async () => {
    const ledger = new CreditLedger({ projectId: 'project_reconstructed' });
    const proofClient = createProofClient();
    const funding = new ArcCreditFunding({ ledger, payTo, publicClient: proofClient });
    const request = await funding.createFundingRequest({
      customerId: 'cus_reconstructed',
      amount: '1',
      idempotencyKey: 'intent_reconstructed',
    });
    proofClient.setPayment(request.paymentRequest, 1_000_000n);
    const receipt = createReceipt(request.invoice, {
      from: payer,
      to: payTo,
      amount: '1',
      memo: request.invoice.memo,
      txHash,
    });

    await expect(
      funding.confirmPayment({
        fundingIntentId: request.fundingIntent.id,
        receipt: { ...receipt, invoiceId: 'inv_unrelated' },
        idempotencyKey: 'confirm_wrong_invoice',
      }),
    ).rejects.toThrow('does not belong to the funding intent invoice');
    await expect(
      funding.confirmPayment({
        fundingIntentId: request.fundingIntent.id,
        receipt,
        idempotencyKey: 'confirm_reconstructed',
      }),
    ).resolves.toMatchObject({ account: { postedAmount: '1' } });
  });
});

function createProofClient() {
  let paymentRequest: MemoPaymentRequest | undefined;
  let amountUnits = 0n;
  return {
    setPayment(request: MemoPaymentRequest, amount: bigint) {
      paymentRequest = request;
      amountUnits = amount;
    },
    async getTransactionReceipt() {
      if (!paymentRequest) throw new Error('Payment request not configured');
      return {
        status: 'success',
        blockNumber: 10n,
        transactionIndex: 0,
        logs: [transferLog(amountUnits), memoReceiptLog(paymentRequest)],
      };
    },
  };
}

function memoReceiptLog(request: MemoPaymentRequest) {
  if (!memoEvent) throw new Error('Memo event ABI missing');
  return {
    address: ARC_TESTNET_CONTRACTS.memo,
    topics: encodeEventTopics({
      abi: [memoEvent],
      eventName: 'Memo',
      args: { sender: payer, target: request.target, memoId: request.memoId },
    }),
    data: encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes' }, { type: 'uint256' }],
      [request.callDataHash, request.memoData, 42n],
    ),
    blockNumber: 10n,
    blockHash,
    transactionHash: txHash,
    transactionIndex: 0,
    logIndex: 1,
    removed: false,
  };
}

function transferLog(value: bigint) {
  return {
    address: ARC_TESTNET_CONTRACTS.usdc,
    topics: encodeEventTopics({
      abi: [transferEvent],
      eventName: 'Transfer',
      args: { from: payer, to: payTo },
    }),
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
    blockNumber: 10n,
    blockHash,
    transactionHash: txHash,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  };
}
