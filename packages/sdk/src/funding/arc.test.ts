import { describe, expect, it } from 'vitest';
import { CreditLedger, InvalidCreditStateError } from '../credits/index.js';
import { createReceipt } from '../receipts/index.js';
import { ArcCreditFunding } from './arc.js';

const payTo = '0x1111111111111111111111111111111111111111' as const;
const payer = '0x2222222222222222222222222222222222222222' as const;
const txHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;

describe('ArcCreditFunding', () => {
  it('converts a verified payment receipt into credits exactly once', async () => {
    const ledger = new CreditLedger({ projectId: 'project_ai' });
    const funding = new ArcCreditFunding({ ledger, payTo });
    const request = await funding.createFundingRequest({
      customerId: 'cus_1',
      amount: '5',
      idempotencyKey: 'intent-1',
    });
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
    const funding = new ArcCreditFunding({ ledger, payTo });
    const first = await funding.createFundingRequest({
      customerId: 'cus_1',
      amount: '5',
      idempotencyKey: 'intent-1',
    });
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
    ).rejects.toBeInstanceOf(InvalidCreditStateError);

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
});
