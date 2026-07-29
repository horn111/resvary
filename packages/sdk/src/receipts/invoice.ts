/**
 * Invoice and receipt creation helpers.
 */

import { randomBytes } from 'node:crypto';
import { DEFAULTS } from '../constants.js';
import { isAmountAtLeast, toStablecoinUnits } from './amount.js';
import { createInvoiceMemo, createInvoiceMemoData, createInvoiceMemoId } from './memo.js';
import type {
  PaymentInvoice,
  PaymentReceipt,
  CreateInvoiceInput,
  ObservedPayment,
  PaymentMatchResult,
} from './types.js';

const DEFAULT_PAYMENT_URI_SCHEME = 'arc';

export function createInvoice(input: CreateInvoiceInput): PaymentInvoice {
  const id = input.id ?? createInvoiceId();
  const currency = input.currency ?? 'USDC';
  const network = input.network ?? DEFAULTS.network;
  const createdAt = input.createdAt ?? Date.now();
  const memo = createInvoiceMemo(id);
  const memoId = createInvoiceMemoId(id);
  const memoData = createInvoiceMemoData(memo);
  const amountUnits = toStablecoinUnits(input.amount).toString();

  return {
    id,
    status: 'open',
    amount: input.amount,
    amountUnits,
    currency,
    payTo: input.payTo,
    network,
    memo,
    memoId,
    memoData,
    paymentUri: createPaymentUri({
      payTo: input.payTo,
      amount: input.amount,
      currency,
      network,
      memo,
    }),
    createdAt,
    expiresAt: input.expiresAt,
    customerId: input.customerId,
    description: input.description,
    metadata: input.metadata,
  };
}

export function createPaymentUri(params: {
  payTo: `0x${string}`;
  amount: string;
  currency: string;
  network: string;
  memo: string;
  scheme?: string;
}): string {
  const search = new URLSearchParams({
    to: params.payTo,
    amount: params.amount,
    currency: params.currency,
    network: params.network,
    memo: params.memo,
  });

  return `${params.scheme ?? DEFAULT_PAYMENT_URI_SCHEME}://pay?${search.toString()}`;
}

export function isInvoiceExpired(invoice: PaymentInvoice, now = Date.now()): boolean {
  return invoice.expiresAt !== undefined && now > invoice.expiresAt;
}

export function matchPaymentToInvoice(
  invoice: PaymentInvoice,
  payment: ObservedPayment,
  now = Date.now(),
): PaymentMatchResult {
  if (isInvoiceExpired(invoice, now)) {
    return { success: false, reason: 'invoice_expired' };
  }

  if (payment.to.toLowerCase() !== invoice.payTo.toLowerCase()) {
    return { success: false, reason: 'wrong_recipient' };
  }

  if ((payment.currency ?? invoice.currency) !== invoice.currency) {
    return { success: false, reason: 'wrong_currency' };
  }

  if ((payment.network ?? invoice.network) !== invoice.network) {
    return { success: false, reason: 'wrong_network' };
  }

  if (payment.memo !== undefined && payment.memo !== invoice.memo) {
    return { success: false, reason: 'wrong_memo' };
  }

  if (
    payment.memoId !== undefined
    && invoice.memoId !== undefined
    && payment.memoId.toLowerCase() !== invoice.memoId.toLowerCase()
  ) {
    return { success: false, reason: 'wrong_memo_id' };
  }

  if (!isAmountAtLeast(payment.amount, invoice.amount)) {
    return { success: false, reason: 'insufficient_amount' };
  }

  return { success: true };
}

export function createReceipt(
  invoice: PaymentInvoice,
  payment: ObservedPayment,
  createdAt = payment.observedAt ?? Date.now(),
): PaymentReceipt {
  const match = matchPaymentToInvoice(invoice, payment, createdAt);
  if (!match.success) {
    throw new Error(`Payment does not match invoice: ${match.reason}`);
  }

  const amount = payment.amount;

  return {
    id: `rcpt_${createInvoiceId(12)}`,
    invoiceId: invoice.id,
    status: 'paid',
    amount,
    amountUnits: toStablecoinUnits(amount).toString(),
    currency: payment.currency ?? invoice.currency,
    network: payment.network ?? invoice.network,
    payTo: invoice.payTo,
    payer: payment.from,
    memo: payment.memo ?? invoice.memo,
    txHash: payment.txHash,
    createdAt,
    blockNumber: payment.blockNumber,
    onchainProof: payment.onchainProof,
    metadata: {
      ...invoice.metadata,
      ...payment.metadata,
    },
  };
}

export function createInvoiceId(size = 16): string {
  return randomBytes(size).toString('hex');
}
