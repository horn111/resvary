import { DatabaseSync, type DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import {
  parseReceiptStoreValue,
  serializeReceiptStoreValue,
  type PaymentInvoice,
  type PaymentReceipt,
  type ReceiptStore,
  type TransactionalReceiptStore,
  type ReceiptStoreDeliveryFilter,
  type ReceiptStoreEventFilter,
  type ReceiptStoreInvoiceFilter,
  type WatcherCursor,
  type WebhookDeliveryAttempt,
  type WebhookEvent,
} from '@resvary/sdk/receipts';
import { hardenSqliteDatabaseFiles, prepareSqliteDatabasePath } from './filesystem.js';

export {
  SqliteCreditStore,
  createSqliteCreditStore,
  type SqliteCreditStoreConfig,
} from './credit.js';

export interface SqliteReceiptStoreConfig {
  path: string;
  createDirectory?: boolean;
}

type PayloadRow = {
  payload: string;
};

export class SqliteReceiptStore implements TransactionalReceiptStore {
  private readonly db: DatabaseSyncType;
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(config: SqliteReceiptStoreConfig) {
    prepareSqliteDatabasePath(config.path, config.createDirectory !== false);
    this.db = new DatabaseSync(config.path);
    this.migrate();
    hardenSqliteDatabaseFiles(config.path);
  }

  async transaction<T>(handler: (store: ReceiptStore) => Promise<T>): Promise<T> {
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.transactionTail;
    this.transactionTail = previous.then(() => current);
    await previous;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = await handler(this);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      release();
    }
  }

  async saveInvoice(invoice: PaymentInvoice): Promise<void> {
    this.db
      .prepare(
        `
      INSERT INTO resvary_invoices (id, status, customer_id, created_at, payload)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        customer_id = excluded.customer_id,
        created_at = excluded.created_at,
        payload = excluded.payload
    `,
      )
      .run(
        invoice.id,
        invoice.status,
        invoice.customerId ?? null,
        invoice.createdAt,
        serializeReceiptStoreValue(invoice),
      );
  }

  async getInvoice(id: string): Promise<PaymentInvoice | undefined> {
    return parsePayloadRow<PaymentInvoice>(
      this.db.prepare('SELECT payload FROM resvary_invoices WHERE id = ?').get(id),
    );
  }

  async listInvoices(filter: ReceiptStoreInvoiceFilter = {}): Promise<PaymentInvoice[]> {
    return this.allPayloads<PaymentInvoice>(
      'SELECT payload FROM resvary_invoices ORDER BY created_at ASC',
    ).filter((invoice) => {
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
    this.db
      .prepare(
        `
      INSERT INTO resvary_receipts (id, invoice_id, tx_hash_norm, status, created_at, payload)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        invoice_id = excluded.invoice_id,
        tx_hash_norm = excluded.tx_hash_norm,
        status = excluded.status,
        created_at = excluded.created_at,
        payload = excluded.payload
    `,
      )
      .run(
        receipt.id,
        receipt.invoiceId,
        receipt.txHash?.toLowerCase() ?? null,
        receipt.status,
        receipt.createdAt,
        serializeReceiptStoreValue(receipt),
      );
  }

  async getReceipt(id: string): Promise<PaymentReceipt | undefined> {
    return parsePayloadRow<PaymentReceipt>(
      this.db.prepare('SELECT payload FROM resvary_receipts WHERE id = ?').get(id),
    );
  }

  async getReceiptByTxHash(
    txHash: `0x${string}`,
    invoiceId?: string,
  ): Promise<PaymentReceipt | undefined> {
    const row = invoiceId
      ? this.db
          .prepare(
            'SELECT payload FROM resvary_receipts WHERE tx_hash_norm = ? AND invoice_id = ? LIMIT 1',
          )
          .get(txHash.toLowerCase(), invoiceId)
      : this.db
          .prepare('SELECT payload FROM resvary_receipts WHERE tx_hash_norm = ? LIMIT 1')
          .get(txHash.toLowerCase());

    return parsePayloadRow<PaymentReceipt>(row);
  }

  async listReceipts(): Promise<PaymentReceipt[]> {
    return this.allPayloads<PaymentReceipt>(
      'SELECT payload FROM resvary_receipts ORDER BY created_at ASC',
    );
  }

  async saveWebhookEvent(event: WebhookEvent): Promise<void> {
    this.db
      .prepare(
        `
      INSERT INTO arc_webhook_events (id, type, created_at, payload)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        created_at = excluded.created_at,
        payload = excluded.payload
    `,
      )
      .run(event.id, event.type, event.createdAt, serializeReceiptStoreValue(event));
  }

  async listWebhookEvents(filter: ReceiptStoreEventFilter = {}): Promise<WebhookEvent[]> {
    return this.allPayloads<WebhookEvent>(
      'SELECT payload FROM arc_webhook_events ORDER BY created_at ASC',
    ).filter((event) => !filter.type || event.type === filter.type);
  }

  async saveWebhookDelivery(delivery: WebhookDeliveryAttempt): Promise<void> {
    this.db
      .prepare(
        `
      INSERT INTO arc_webhook_deliveries (
        id,
        event_id,
        event_type,
        attempt,
        status,
        received_at,
        payload
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        event_id = excluded.event_id,
        event_type = excluded.event_type,
        attempt = excluded.attempt,
        status = excluded.status,
        received_at = excluded.received_at,
        payload = excluded.payload
    `,
      )
      .run(
        delivery.id,
        delivery.eventId,
        delivery.eventType,
        delivery.attempt,
        delivery.status,
        delivery.receivedAt,
        serializeReceiptStoreValue(delivery),
      );
  }

  async getWebhookDelivery(id: string): Promise<WebhookDeliveryAttempt | undefined> {
    return parsePayloadRow<WebhookDeliveryAttempt>(
      this.db.prepare('SELECT payload FROM arc_webhook_deliveries WHERE id = ?').get(id),
    );
  }

  async listWebhookDeliveries(
    filter: ReceiptStoreDeliveryFilter = {},
  ): Promise<WebhookDeliveryAttempt[]> {
    return this.allPayloads<WebhookDeliveryAttempt>(
      'SELECT payload FROM arc_webhook_deliveries ORDER BY received_at ASC, attempt ASC',
    ).filter((delivery) => {
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
    return parsePayloadRow<WatcherCursor>(
      this.db.prepare('SELECT payload FROM arc_watcher_cursors WHERE key = ?').get(key),
    );
  }

  async listWatcherCursors(): Promise<WatcherCursor[]> {
    return this.allPayloads<WatcherCursor>(
      'SELECT payload FROM arc_watcher_cursors ORDER BY updated_at ASC',
    );
  }

  async saveWatcherCursor(cursor: WatcherCursor): Promise<void> {
    this.db
      .prepare(
        `
      INSERT INTO arc_watcher_cursors (
        key,
        network,
        invoice_id,
        memo_id_norm,
        next_from_block,
        updated_at,
        payload
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        network = excluded.network,
        invoice_id = excluded.invoice_id,
        memo_id_norm = excluded.memo_id_norm,
        next_from_block = excluded.next_from_block,
        updated_at = excluded.updated_at,
        payload = excluded.payload
    `,
      )
      .run(
        cursor.key,
        cursor.network,
        cursor.invoiceId ?? null,
        cursor.memoId?.toLowerCase() ?? null,
        cursor.nextFromBlock.toString(),
        cursor.updatedAt,
        serializeReceiptStoreValue(cursor),
      );
  }

  async deleteWatcherCursor(key: string): Promise<void> {
    this.db.prepare('DELETE FROM arc_watcher_cursors WHERE key = ?').run(key);
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS resvary_invoices (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        customer_id TEXT,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS resvary_invoices_status
        ON resvary_invoices(status);

      CREATE INDEX IF NOT EXISTS resvary_invoices_customer_id
        ON resvary_invoices(customer_id);

      CREATE TABLE IF NOT EXISTS resvary_receipts (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        tx_hash_norm TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS arc_webhook_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS arc_webhook_deliveries (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        status TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS arc_webhook_deliveries_event_id
        ON arc_webhook_deliveries(event_id);

      CREATE TABLE IF NOT EXISTS arc_watcher_cursors (
        key TEXT PRIMARY KEY,
        network TEXT NOT NULL,
        invoice_id TEXT,
        memo_id_norm TEXT,
        next_from_block TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
    `);

    const duplicate = this.db
      .prepare(
        `SELECT tx_hash_norm, COUNT(*) AS count
         FROM resvary_receipts
         WHERE tx_hash_norm IS NOT NULL
         GROUP BY tx_hash_norm
         HAVING COUNT(*) > 1
         LIMIT 1`,
      )
      .get() as { tx_hash_norm: string; count: number } | undefined;
    if (duplicate) {
      throw new Error(
        `Cannot enforce receipt transaction uniqueness: ${duplicate.count} receipts use ${duplicate.tx_hash_norm}`,
      );
    }
    this.db.exec(`
      DROP INDEX IF EXISTS resvary_receipts_invoice_tx_hash;
      CREATE UNIQUE INDEX IF NOT EXISTS resvary_receipts_tx_hash
        ON resvary_receipts(tx_hash_norm)
        WHERE tx_hash_norm IS NOT NULL;
    `);
  }

  private allPayloads<T>(sql: string): T[] {
    return this.db
      .prepare(sql)
      .all()
      .map((row) => parsePayloadRow<T>(row)!);
  }
}

export function createSqliteReceiptStore(config: SqliteReceiptStoreConfig): SqliteReceiptStore {
  return new SqliteReceiptStore(config);
}

function parsePayloadRow<T>(row: unknown): T | undefined {
  if (!isPayloadRow(row)) {
    return undefined;
  }

  return parseReceiptStoreValue<T>(row.payload);
}

function isPayloadRow(value: unknown): value is PayloadRow {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'payload' in value &&
    typeof (value as PayloadRow).payload === 'string',
  );
}
