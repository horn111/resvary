import { describe, expect, it } from 'vitest';
import {
  createInvoice,
  createReceipt,
  isInvoiceExpired,
  matchPaymentToInvoice,
} from './invoice.js';

const seller = '0x1111111111111111111111111111111111111111' as const;
const buyer = '0x2222222222222222222222222222222222222222' as const;

describe('Arc invoices and receipts', () => {
  it('creates an invoice with a memo, payment URI, and minor units', () => {
    const invoice = createInvoice({
      id: 'inv_demo',
      amount: '19.00',
      payTo: seller,
      createdAt: 1_700_000_000_000,
    });

    expect(invoice.status).toBe('open');
    expect(invoice.amountUnits).toBe('19000000');
    expect(invoice.memo).toBe('resvary:invoice:v1:inv_demo');
    expect(invoice.paymentUri).toContain('arc://pay?');
    expect(invoice.paymentUri).toContain('amount=19.00');
  });

  it('matches a valid observed payment to an invoice', () => {
    const invoice = createInvoice({ id: 'inv_paid', amount: '19', payTo: seller });
    const match = matchPaymentToInvoice(invoice, {
      from: buyer,
      to: seller,
      amount: '19.000001',
      memo: invoice.memo,
    });

    expect(match).toEqual({ success: true });
  });

  it('rejects payments with the wrong recipient, memo, or amount', () => {
    const invoice = createInvoice({ id: 'inv_reject', amount: '19', payTo: seller });

    expect(matchPaymentToInvoice(invoice, {
      to: '0x3333333333333333333333333333333333333333',
      amount: '19',
      memo: invoice.memo,
    })).toEqual({ success: false, reason: 'wrong_recipient' });

    expect(matchPaymentToInvoice(invoice, {
      to: seller,
      amount: '19',
      memo: 'different',
    })).toEqual({ success: false, reason: 'wrong_memo' });

    expect(matchPaymentToInvoice(invoice, {
      to: seller,
      amount: '18.99',
      memo: invoice.memo,
    })).toEqual({ success: false, reason: 'insufficient_amount' });
  });

  it('creates a receipt from a matching payment', () => {
    const invoice = createInvoice({
      id: 'inv_receipt',
      amount: '19',
      payTo: seller,
      metadata: { plan: 'pro' },
    });
    const receipt = createReceipt(invoice, {
      txHash: '0xabc' as `0x${string}`,
      from: buyer,
      to: seller,
      amount: '19',
      memo: invoice.memo,
      metadata: { source: 'test' },
    }, 1_700_000_000_000);

    expect(receipt.invoiceId).toBe(invoice.id);
    expect(receipt.status).toBe('paid');
    expect(receipt.amountUnits).toBe('19000000');
    expect(receipt.metadata).toEqual({ plan: 'pro', source: 'test' });
  });

  it('detects expired invoices', () => {
    const invoice = createInvoice({
      id: 'inv_expired',
      amount: '19',
      payTo: seller,
      expiresAt: 1_000,
    });

    expect(isInvoiceExpired(invoice, 1_001)).toBe(true);
    expect(matchPaymentToInvoice(invoice, {
      to: seller,
      amount: '19',
      memo: invoice.memo,
    }, 1_001)).toEqual({ success: false, reason: 'invoice_expired' });
  });
});
