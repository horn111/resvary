import { createInvoice, createReceipt, isInvoiceExpired } from './invoice.js';
import type {
  PaymentInvoice,
  PaymentReceipt,
  CreateInvoiceInput,
  ObservedPayment,
  WebhookEvent,
} from './types.js';
import type {
  ReceiptStore,
  ReceiptStoreInvoiceFilter,
  TransactionalReceiptStore,
} from './store.js';
import { createWebhookEvent } from './webhooks.js';

export interface PersistentReceiptLedgerConfig {
  store: ReceiptStore;
}

export class PersistentReceiptLedger {
  private readonly store: ReceiptStore;

  constructor(config: PersistentReceiptLedgerConfig) {
    this.store = config.store;
  }

  async createInvoice(input: CreateInvoiceInput): Promise<PaymentInvoice> {
    const invoice = createInvoice(input);
    return this.withTransaction(async (store) => {
      await this.addInvoiceToStore(store, invoice);
      await store.saveWebhookEvent(createWebhookEvent('invoice.created', { invoice }));
      return invoice;
    });
  }

  async addInvoice(invoice: PaymentInvoice): Promise<void> {
    await this.withTransaction((store) => this.addInvoiceToStore(store, invoice));
  }

  async getInvoice(id: string): Promise<PaymentInvoice | undefined> {
    return this.store.getInvoice(id);
  }

  async listInvoices(filter?: ReceiptStoreInvoiceFilter): Promise<PaymentInvoice[]> {
    return this.store.listInvoices(filter);
  }

  async recordPayment(invoiceId: string, payment: ObservedPayment): Promise<PaymentReceipt> {
    return this.withTransaction((store) => this.recordPaymentInStore(store, invoiceId, payment));
  }

  private async recordPaymentInStore(
    store: ReceiptStore,
    invoiceId: string,
    payment: ObservedPayment,
  ): Promise<PaymentReceipt> {
    const existingReceipt = payment.txHash
      ? await store.getReceiptByTxHash(payment.txHash)
      : undefined;
    if (existingReceipt) {
      if (existingReceipt.invoiceId !== invoiceId) {
        throw new Error(
          `Payment transaction ${payment.txHash} is already assigned to invoice ${existingReceipt.invoiceId}`,
        );
      }
      return existingReceipt;
    }

    const invoice = await this.requireInvoiceFromStore(store, invoiceId);
    const observedInvoice = await this.updateInvoiceInStore(store, invoice.id, {
      status: 'observed',
    });
    await store.saveWebhookEvent(
      createWebhookEvent('invoice.observed', {
        invoice: observedInvoice,
        payment,
      }),
    );

    const receipt = createReceipt(observedInvoice, payment);
    await store.saveReceipt(receipt);
    const persistedReceipt = payment.txHash
      ? ((await store.getReceiptByTxHash(payment.txHash)) ?? receipt)
      : receipt;
    if (persistedReceipt.invoiceId !== invoice.id) {
      throw new Error(
        `Payment transaction ${payment.txHash} is already assigned to invoice ${persistedReceipt.invoiceId}`,
      );
    }
    const paidInvoice = await this.updateInvoiceInStore(store, invoice.id, { status: 'paid' });
    await store.saveWebhookEvent(
      createWebhookEvent('invoice.paid', {
        invoice: paidInvoice,
        receipt: persistedReceipt,
      }),
    );
    return persistedReceipt;
  }

  async markExpired(invoiceId: string, now = Date.now()): Promise<PaymentInvoice> {
    return this.withTransaction(async (store) => {
      const invoice = await this.requireInvoiceFromStore(store, invoiceId);
      if (!isInvoiceExpired(invoice, now)) {
        throw new Error(`Invoice is not expired: ${invoiceId}`);
      }
      const expiredInvoice = await this.updateInvoiceInStore(store, invoiceId, {
        status: 'expired',
      });
      await store.saveWebhookEvent(
        createWebhookEvent('invoice.expired', { invoice: expiredInvoice }),
      );
      return expiredInvoice;
    });
  }

  async markRefunded(
    invoiceId: string,
    refund: { txHash?: `0x${string}`; refundedAt?: number } = {},
  ): Promise<PaymentReceipt> {
    return this.withTransaction(async (store) => {
      const invoice = await this.requireInvoiceFromStore(store, invoiceId);
      const invoiceReceipts = (await store.listReceipts()).filter(
        (item) => item.invoiceId === invoiceId,
      );
      const existingRefund = invoiceReceipts.find((item) => item.status === 'refunded');
      if (invoice.status === 'refunded' && existingRefund) return existingRefund;
      if (refund.txHash) {
        const transactionReceipt = await store.getReceiptByTxHash(refund.txHash);
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
      await store.saveReceipt(refundedReceipt);
      const refundedInvoice = await this.updateInvoiceInStore(store, invoice.id, {
        status: 'refunded',
      });
      await store.saveWebhookEvent(
        createWebhookEvent('invoice.refunded', {
          invoice: refundedInvoice,
          receipt: refundedReceipt,
        }),
      );
      return refundedReceipt;
    });
  }

  async getReceipt(id: string): Promise<PaymentReceipt | undefined> {
    return this.store.getReceipt(id);
  }

  async getReceiptByTxHash(
    txHash: `0x${string}`,
    invoiceId?: string,
  ): Promise<PaymentReceipt | undefined> {
    return this.store.getReceiptByTxHash(txHash, invoiceId);
  }

  async listReceipts(): Promise<PaymentReceipt[]> {
    return this.store.listReceipts();
  }

  async listWebhookEvents(): Promise<WebhookEvent[]> {
    return this.store.listWebhookEvents();
  }

  private async addInvoiceToStore(store: ReceiptStore, invoice: PaymentInvoice): Promise<void> {
    const existing = await store.getInvoice(invoice.id);
    if (existing) throw new Error(`Invoice already exists: ${invoice.id}`);
    await store.saveInvoice(invoice);
  }

  private async requireInvoiceFromStore(store: ReceiptStore, id: string): Promise<PaymentInvoice> {
    const invoice = await store.getInvoice(id);
    if (!invoice) {
      throw new Error(`Invoice not found: ${id}`);
    }

    return invoice;
  }

  private async updateInvoiceInStore(
    store: ReceiptStore,
    id: string,
    patch: Partial<PaymentInvoice>,
  ): Promise<PaymentInvoice> {
    const invoice = await this.requireInvoiceFromStore(store, id);
    const next = { ...invoice, ...patch };
    await store.saveInvoice(next);
    return next;
  }

  private withTransaction<T>(handler: (store: ReceiptStore) => Promise<T>): Promise<T> {
    const store = this.store as ReceiptStore & Partial<TransactionalReceiptStore>;
    return typeof store.transaction === 'function'
      ? store.transaction(handler)
      : handler(this.store);
  }
}
