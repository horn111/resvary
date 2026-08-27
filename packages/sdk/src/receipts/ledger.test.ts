import { describe, expect, it } from 'vitest';
import { ReceiptLedger } from './ledger.js';

const seller = '0x1111111111111111111111111111111111111111' as const;
const buyer = '0x2222222222222222222222222222222222222222' as const;

describe('ReceiptLedger', () => {
  it('records invoice, observed payment, paid receipt, and webhook events', () => {
    const ledger = new ReceiptLedger();
    const invoice = ledger.createInvoice({
      id: 'inv_ledger',
      amount: '3.50',
      payTo: seller,
      customerId: 'cus_123',
    });

    const receipt = ledger.recordPayment(invoice.id, {
      from: buyer,
      to: seller,
      amount: '3.50',
      memo: invoice.memo,
    });

    expect(ledger.getInvoice(invoice.id)?.status).toBe('paid');
    expect(ledger.getReceipt(receipt.id)).toEqual(receipt);
    expect(ledger.listInvoices({ customerId: 'cus_123' })).toHaveLength(1);
    expect(ledger.listWebhookEvents().map((event) => event.type)).toEqual([
      'invoice.created',
      'invoice.observed',
      'invoice.paid',
    ]);
  });

  it('marks expired invoices and paid invoices as refunded', () => {
    const ledger = new ReceiptLedger();
    const expired = ledger.createInvoice({
      id: 'inv_expired',
      amount: '1',
      payTo: seller,
      expiresAt: 1_000,
    });

    expect(ledger.markExpired(expired.id, 1_001).status).toBe('expired');

    const invoice = ledger.createInvoice({ id: 'inv_refund', amount: '1', payTo: seller });
    const paidReceipt = ledger.recordPayment(invoice.id, {
      txHash: '0xpayment',
      from: buyer,
      to: seller,
      amount: '1',
      memo: invoice.memo,
    });

    const refund = ledger.markRefunded(invoice.id, { refundedAt: 2_000 });
    expect(refund.status).toBe('refunded');
    expect(refund.txHash).toBeUndefined();
    expect(ledger.getInvoice(invoice.id)?.status).toBe('refunded');
    expect(ledger.markRefunded(invoice.id)).toBe(refund);
    expect(
      ledger.listWebhookEvents().filter((event) => event.type === 'invoice.refunded'),
    ).toHaveLength(1);

    const other = ledger.createInvoice({ id: 'inv_refund_tx', amount: '1', payTo: seller });
    ledger.recordPayment(other.id, {
      from: buyer,
      to: seller,
      amount: '1',
      memo: other.memo,
    });
    expect(() => ledger.markRefunded(other.id, { txHash: paidReceipt.txHash })).toThrow(
      'already assigned',
    );
  });
  it('returns the existing receipt for duplicate invoice tx records', () => {
    const ledger = new ReceiptLedger();
    const invoice = ledger.createInvoice({ id: 'inv_dupe', amount: '1', payTo: seller });
    const payment = {
      txHash: '0xabc' as `0x${string}`,
      from: buyer,
      to: seller,
      amount: '1',
      memo: invoice.memo,
    };

    const first = ledger.recordPayment(invoice.id, payment);
    const second = ledger.recordPayment(invoice.id, payment);

    expect(second).toBe(first);
    expect(ledger.listReceipts()).toHaveLength(1);
    expect(ledger.listWebhookEvents().map((event) => event.type)).toEqual([
      'invoice.created',
      'invoice.observed',
      'invoice.paid',
    ]);
  });

  it('rejects reusing one payment transaction for another invoice', () => {
    const ledger = new ReceiptLedger();
    const first = ledger.createInvoice({ id: 'inv_tx_first', amount: '1', payTo: seller });
    const second = ledger.createInvoice({ id: 'inv_tx_second', amount: '1', payTo: seller });
    const txHash = '0xabc' as `0x${string}`;

    ledger.recordPayment(first.id, {
      txHash,
      from: buyer,
      to: seller,
      amount: '1',
      memo: first.memo,
    });

    expect(() =>
      ledger.recordPayment(second.id, {
        txHash,
        from: buyer,
        to: seller,
        amount: '1',
        memo: second.memo,
      }),
    ).toThrow('already assigned');
    expect(ledger.getInvoice(second.id)?.status).toBe('open');
  });
});
