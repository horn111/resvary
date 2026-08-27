/**
 * In-memory invoice and receipt ledger.
 */

import { createInvoice, createReceipt, isInvoiceExpired } from './invoice.js';
import type {
  PaymentInvoice,
  PaymentReceipt,
  CreateInvoiceInput,
  InvoiceStatus,
  ObservedPayment,
  WebhookEvent,
} from './types.js';
import { createWebhookEvent } from './webhooks.js';

export interface LedgerFilter {
  status?: InvoiceStatus;
  customerId?: string;
}

export class ReceiptLedger {
  private readonly invoices = new Map<string, PaymentInvoice>();
  private readonly receipts = new Map<string, PaymentReceipt>();
  private readonly events: WebhookEvent[] = [];

  createInvoice(input: CreateInvoiceInput): PaymentInvoice {
    const invoice = createInvoice(input);
    this.addInvoice(invoice);
    this.events.push(createWebhookEvent('invoice.created', { invoice }));
    return invoice;
  }

  addInvoice(invoice: PaymentInvoice): void {
    if (this.invoices.has(invoice.id)) {
      throw new Error(`Invoice already exists: ${invoice.id}`);
    }

    this.invoices.set(invoice.id, invoice);
  }

  getInvoice(id: string): PaymentInvoice | undefined {
    return this.invoices.get(id);
  }

  listInvoices(filter?: LedgerFilter): PaymentInvoice[] {
    return [...this.invoices.values()].filter((invoice) => {
      if (filter?.status && invoice.status !== filter.status) {
        return false;
      }

      if (filter?.customerId && invoice.customerId !== filter.customerId) {
        return false;
      }

      return true;
    });
  }

  recordPayment(invoiceId: string, payment: ObservedPayment): PaymentReceipt {
    const existingReceipt = payment.txHash ? this.getReceiptByTxHash(payment.txHash) : undefined;
    if (existingReceipt) {
      if (existingReceipt.invoiceId !== invoiceId) {
        throw new Error(
          `Payment transaction ${payment.txHash} is already assigned to invoice ${existingReceipt.invoiceId}`,
        );
      }
      return existingReceipt;
    }

    const invoice = this.requireInvoice(invoiceId);
    const observedInvoice = this.updateInvoice(invoice.id, { status: 'observed' });
    this.events.push(createWebhookEvent('invoice.observed', { invoice: observedInvoice, payment }));

    const receipt = createReceipt(observedInvoice, payment);
    this.receipts.set(receipt.id, receipt);
    const paidInvoice = this.updateInvoice(invoice.id, { status: 'paid' });
    this.events.push(createWebhookEvent('invoice.paid', { invoice: paidInvoice, receipt }));
    return receipt;
  }

  markExpired(invoiceId: string, now = Date.now()): PaymentInvoice {
    const invoice = this.requireInvoice(invoiceId);

    if (!isInvoiceExpired(invoice, now)) {
      throw new Error(`Invoice is not expired: ${invoiceId}`);
    }

    const expiredInvoice = this.updateInvoice(invoiceId, { status: 'expired' });
    this.events.push(createWebhookEvent('invoice.expired', { invoice: expiredInvoice }));
    return expiredInvoice;
  }

  markRefunded(
    invoiceId: string,
    refund: { txHash?: `0x${string}`; refundedAt?: number } = {},
  ): PaymentReceipt {
    const invoice = this.requireInvoice(invoiceId);
    const invoiceReceipts = [...this.receipts.values()].filter(
      (item) => item.invoiceId === invoiceId,
    );
    const existingRefund = invoiceReceipts.find((item) => item.status === 'refunded');
    if (invoice.status === 'refunded' && existingRefund) return existingRefund;
    if (refund.txHash) {
      const transactionReceipt = this.getReceiptByTxHash(refund.txHash);
      if (transactionReceipt) {
        if (
          transactionReceipt.invoiceId === invoiceId &&
          transactionReceipt.status === 'refunded'
        ) {
          return transactionReceipt;
        }
        throw new Error(
          `Refund transaction ${refund.txHash} is already assigned to receipt ${transactionReceipt.id}`,
        );
      }
    }
    const receipt = invoiceReceipts.find((item) => item.status === 'paid');

    if (!receipt) {
      throw new Error(`Cannot refund invoice without a paid receipt: ${invoiceId}`);
    }

    const refundedReceipt: PaymentReceipt = {
      ...receipt,
      id: `rfnd_${receipt.id}`,
      status: 'refunded',
      txHash: refund.txHash,
      createdAt: refund.refundedAt ?? Date.now(),
    };

    this.receipts.set(refundedReceipt.id, refundedReceipt);
    const refundedInvoice = this.updateInvoice(invoice.id, { status: 'refunded' });
    this.events.push(
      createWebhookEvent('invoice.refunded', {
        invoice: refundedInvoice,
        receipt: refundedReceipt,
      }),
    );
    return refundedReceipt;
  }

  getReceipt(id: string): PaymentReceipt | undefined {
    return this.receipts.get(id);
  }

  getReceiptByTxHash(txHash: `0x${string}`, invoiceId?: string): PaymentReceipt | undefined {
    return [...this.receipts.values()].find(
      (receipt) =>
        receipt.txHash?.toLowerCase() === txHash.toLowerCase() &&
        (invoiceId === undefined || receipt.invoiceId === invoiceId),
    );
  }

  listReceipts(): PaymentReceipt[] {
    return [...this.receipts.values()];
  }

  listWebhookEvents(): WebhookEvent[] {
    return [...this.events];
  }

  private requireInvoice(id: string): PaymentInvoice {
    const invoice = this.invoices.get(id);
    if (!invoice) {
      throw new Error(`Invoice not found: ${id}`);
    }

    return invoice;
  }

  private updateInvoice(id: string, patch: Partial<PaymentInvoice>): PaymentInvoice {
    const invoice = this.requireInvoice(id);
    const next = { ...invoice, ...patch };
    this.invoices.set(id, next);
    return next;
  }
}
