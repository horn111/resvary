import type {
  PaymentInvoice,
  PaymentReceipt,
  InvoiceStatus,
  WebhookDeliveryAttempt,
  WebhookDeliveryStatus,
  WebhookEvent,
} from './types.js';

export interface ReceiptStoreInvoiceFilter {
  status?: InvoiceStatus;
  customerId?: string;
}

export interface ReceiptStoreDeliveryFilter {
  eventId?: string;
  status?: WebhookDeliveryStatus;
}

export interface ReceiptStoreEventFilter {
  type?: WebhookEvent['type'];
}

export interface WatcherCursor {
  key: string;
  network: string;
  nextFromBlock: bigint;
  updatedAt: number;
  invoiceId?: string;
  memoId?: `0x${string}`;
  metadata?: Record<string, unknown>;
}

export interface WatcherCursorKeyInput {
  network: string;
  invoiceId: string;
  memoId?: `0x${string}`;
}

export interface ReceiptStore {
  saveInvoice(invoice: PaymentInvoice): Promise<void>;
  getInvoice(id: string): Promise<PaymentInvoice | undefined>;
  listInvoices(filter?: ReceiptStoreInvoiceFilter): Promise<PaymentInvoice[]>;

  saveReceipt(receipt: PaymentReceipt): Promise<void>;
  getReceipt(id: string): Promise<PaymentReceipt | undefined>;
  getReceiptByTxHash(txHash: `0x${string}`, invoiceId?: string): Promise<PaymentReceipt | undefined>;
  listReceipts(): Promise<PaymentReceipt[]>;

  saveWebhookEvent(event: WebhookEvent): Promise<void>;
  listWebhookEvents(filter?: ReceiptStoreEventFilter): Promise<WebhookEvent[]>;

  saveWebhookDelivery(delivery: WebhookDeliveryAttempt): Promise<void>;
  getWebhookDelivery(id: string): Promise<WebhookDeliveryAttempt | undefined>;
  listWebhookDeliveries(filter?: ReceiptStoreDeliveryFilter): Promise<WebhookDeliveryAttempt[]>;

  getWatcherCursor(key: string): Promise<WatcherCursor | undefined>;
  listWatcherCursors(): Promise<WatcherCursor[]>;
  saveWatcherCursor(cursor: WatcherCursor): Promise<void>;
  deleteWatcherCursor(key: string): Promise<void>;
}

export class InMemoryReceiptStore implements ReceiptStore {
  private readonly invoices = new Map<string, PaymentInvoice>();
  private readonly receipts = new Map<string, PaymentReceipt>();
  private readonly events = new Map<string, WebhookEvent>();
  private readonly deliveries = new Map<string, WebhookDeliveryAttempt>();
  private readonly cursors = new Map<string, WatcherCursor>();

  async saveInvoice(invoice: PaymentInvoice): Promise<void> {
    this.invoices.set(invoice.id, invoice);
  }

  async getInvoice(id: string): Promise<PaymentInvoice | undefined> {
    return this.invoices.get(id);
  }

  async listInvoices(filter: ReceiptStoreInvoiceFilter = {}): Promise<PaymentInvoice[]> {
    return [...this.invoices.values()].filter((invoice) => {
      if (filter.status && invoice.status !== filter.status) {
        return false;
      }

      if (filter.customerId && invoice.customerId !== filter.customerId) {
        return false;
      }

      return true;
    });
  }

  async saveReceipt(receipt: PaymentReceipt): Promise<void> {
    this.receipts.set(receipt.id, receipt);
  }

  async getReceipt(id: string): Promise<PaymentReceipt | undefined> {
    return this.receipts.get(id);
  }

  async getReceiptByTxHash(
    txHash: `0x${string}`,
    invoiceId?: string,
  ): Promise<PaymentReceipt | undefined> {
    return [...this.receipts.values()].find((receipt) => (
      receipt.txHash?.toLowerCase() === txHash.toLowerCase()
      && (invoiceId === undefined || receipt.invoiceId === invoiceId)
    ));
  }

  async listReceipts(): Promise<PaymentReceipt[]> {
    return [...this.receipts.values()];
  }

  async saveWebhookEvent(event: WebhookEvent): Promise<void> {
    this.events.set(event.id, event);
  }

  async listWebhookEvents(filter: ReceiptStoreEventFilter = {}): Promise<WebhookEvent[]> {
    return [...this.events.values()].filter((event) => {
      if (filter.type && event.type !== filter.type) {
        return false;
      }

      return true;
    });
  }

  async saveWebhookDelivery(delivery: WebhookDeliveryAttempt): Promise<void> {
    this.deliveries.set(delivery.id, delivery);
  }

  async getWebhookDelivery(id: string): Promise<WebhookDeliveryAttempt | undefined> {
    return this.deliveries.get(id);
  }

  async listWebhookDeliveries(
    filter: ReceiptStoreDeliveryFilter = {},
  ): Promise<WebhookDeliveryAttempt[]> {
    return [...this.deliveries.values()].filter((delivery) => {
      if (filter.eventId && delivery.eventId !== filter.eventId) {
        return false;
      }

      if (filter.status && delivery.status !== filter.status) {
        return false;
      }

      return true;
    });
  }

  async getWatcherCursor(key: string): Promise<WatcherCursor | undefined> {
    return this.cursors.get(key);
  }

  async listWatcherCursors(): Promise<WatcherCursor[]> {
    return [...this.cursors.values()];
  }

  async saveWatcherCursor(cursor: WatcherCursor): Promise<void> {
    this.cursors.set(cursor.key, cursor);
  }

  async deleteWatcherCursor(key: string): Promise<void> {
    this.cursors.delete(key);
  }
}

export function createWatcherCursorKey(input: WatcherCursorKeyInput): string {
  return [
    input.network,
    input.invoiceId,
    input.memoId?.toLowerCase() ?? 'no-memo-id',
  ].join(':');
}
