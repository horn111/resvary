import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import type {
  PaymentInvoice,
  PaymentReceipt,
  ReceiptStore,
  ReceiptStoreDeliveryFilter,
  ReceiptStoreEventFilter,
  ReceiptStoreInvoiceFilter,
  TransactionalReceiptStore,
  WatcherCursor,
  WebhookDeliveryAttempt,
  WebhookEvent,
} from '@resvary/sdk/receipts';
import { parseReceiptStoreValue, serializeReceiptStoreValue } from '@resvary/sdk/receipts';
import {
  createPostgresHandle,
  isRetryableTransactionError,
  rollback,
  table,
  type PostgresConnectionConfig,
  type PostgresHandle,
} from './connection.js';

type PayloadRow = { payload: string };

interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

export interface PostgresReceiptStoreConfig extends PostgresConnectionConfig {}

class PostgresReceiptStoreView implements ReceiptStore {
  constructor(
    protected readonly db: Queryable,
    protected readonly handle: PostgresHandle,
  ) {}

  async saveInvoice(value: PaymentInvoice): Promise<void> {
    await this.db.query(
      `INSERT INTO ${table(this.handle, 'resvary_invoices')}
       (id, status, customer_id, amount_units, created_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status,
         customer_id = EXCLUDED.customer_id, amount_units = EXCLUDED.amount_units,
         created_at = EXCLUDED.created_at, payload = EXCLUDED.payload`,
      [
        value.id,
        value.status,
        value.customerId ?? null,
        value.amountUnits,
        value.createdAt,
        serializeReceiptStoreValue(value),
      ],
    );
  }

  getInvoice(id: string): Promise<PaymentInvoice | undefined> {
    return this.one(
      `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_invoices')} WHERE id = $1`,
      [id],
    );
  }

  async listInvoices(filter: ReceiptStoreInvoiceFilter = {}): Promise<PaymentInvoice[]> {
    return (
      await this.all<PaymentInvoice>(
        `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_invoices')} ORDER BY created_at ASC`,
      )
    ).filter(
      (value) =>
        (!filter.status || value.status === filter.status) &&
        (!filter.customerId || value.customerId === filter.customerId),
    );
  }

  async saveReceipt(value: PaymentReceipt): Promise<void> {
    await this.db.query(
      `INSERT INTO ${table(this.handle, 'resvary_receipts')}
       (id, invoice_id, tx_hash_norm, status, amount_units, created_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [
        value.id,
        value.invoiceId,
        value.txHash?.toLowerCase() ?? null,
        value.status,
        value.amountUnits,
        value.createdAt,
        serializeReceiptStoreValue(value),
      ],
    );
  }

  getReceipt(id: string): Promise<PaymentReceipt | undefined> {
    return this.one(
      `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_receipts')} WHERE id = $1`,
      [id],
    );
  }

  getReceiptByTxHash(
    txHash: `0x${string}`,
    invoiceId?: string,
  ): Promise<PaymentReceipt | undefined> {
    return this.one(
      `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_receipts')}
       WHERE tx_hash_norm = $1 ${invoiceId ? 'AND invoice_id = $2' : ''} LIMIT 1`,
      invoiceId ? [txHash.toLowerCase(), invoiceId] : [txHash.toLowerCase()],
    );
  }

  listReceipts(): Promise<PaymentReceipt[]> {
    return this.all(
      `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_receipts')} ORDER BY created_at ASC`,
    );
  }

  async saveWebhookEvent(value: WebhookEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO ${table(this.handle, 'arc_webhook_events')}(id, type, created_at, payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type,
         created_at = EXCLUDED.created_at, payload = EXCLUDED.payload`,
      [value.id, value.type, value.createdAt, serializeReceiptStoreValue(value)],
    );
  }

  async listWebhookEvents(filter: ReceiptStoreEventFilter = {}): Promise<WebhookEvent[]> {
    return (
      await this.all<WebhookEvent>(
        `SELECT payload::text AS payload FROM ${table(this.handle, 'arc_webhook_events')} ORDER BY created_at ASC`,
      )
    ).filter((value) => !filter.type || value.type === filter.type);
  }

  async saveWebhookDelivery(value: WebhookDeliveryAttempt): Promise<void> {
    await this.db.query(
      `INSERT INTO ${table(this.handle, 'arc_webhook_deliveries')}
       (id, event_id, event_type, attempt, status, received_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET event_id = EXCLUDED.event_id,
         event_type = EXCLUDED.event_type, attempt = EXCLUDED.attempt,
         status = EXCLUDED.status, received_at = EXCLUDED.received_at,
         payload = EXCLUDED.payload`,
      [
        value.id,
        value.eventId,
        value.eventType,
        value.attempt,
        value.status,
        value.receivedAt,
        serializeReceiptStoreValue(value),
      ],
    );
  }

  getWebhookDelivery(id: string): Promise<WebhookDeliveryAttempt | undefined> {
    return this.one(
      `SELECT payload::text AS payload FROM ${table(this.handle, 'arc_webhook_deliveries')} WHERE id = $1`,
      [id],
    );
  }

  async listWebhookDeliveries(
    filter: ReceiptStoreDeliveryFilter = {},
  ): Promise<WebhookDeliveryAttempt[]> {
    return (
      await this.all<WebhookDeliveryAttempt>(
        `SELECT payload::text AS payload FROM ${table(this.handle, 'arc_webhook_deliveries')} ORDER BY received_at ASC, attempt ASC`,
      )
    ).filter(
      (value) =>
        (!filter.eventId || value.eventId === filter.eventId) &&
        (!filter.status || value.status === filter.status),
    );
  }

  getWatcherCursor(key: string): Promise<WatcherCursor | undefined> {
    return this.one(
      `SELECT payload::text AS payload FROM ${table(this.handle, 'arc_watcher_cursors')} WHERE key = $1`,
      [key],
    );
  }

  listWatcherCursors(): Promise<WatcherCursor[]> {
    return this.all(
      `SELECT payload::text AS payload FROM ${table(this.handle, 'arc_watcher_cursors')} ORDER BY updated_at ASC`,
    );
  }

  async saveWatcherCursor(value: WatcherCursor): Promise<void> {
    await this.db.query(
      `INSERT INTO ${table(this.handle, 'arc_watcher_cursors')}
       (key, network, invoice_id, memo_id_norm, next_from_block, updated_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (key) DO UPDATE SET network = EXCLUDED.network,
         invoice_id = EXCLUDED.invoice_id, memo_id_norm = EXCLUDED.memo_id_norm,
         next_from_block = EXCLUDED.next_from_block, updated_at = EXCLUDED.updated_at,
         payload = EXCLUDED.payload`,
      [
        value.key,
        value.network,
        value.invoiceId ?? null,
        value.memoId?.toLowerCase() ?? null,
        value.nextFromBlock.toString(),
        value.updatedAt,
        serializeReceiptStoreValue(value),
      ],
    );
  }

  async deleteWatcherCursor(key: string): Promise<void> {
    await this.db.query(`DELETE FROM ${table(this.handle, 'arc_watcher_cursors')} WHERE key = $1`, [
      key,
    ]);
  }

  private async one<T>(sql: string, values: unknown[] = []): Promise<T | undefined> {
    const result = await this.db.query<PayloadRow>(sql, values);
    return result.rows[0] ? parseReceiptStoreValue<T>(result.rows[0].payload) : undefined;
  }

  private async all<T>(sql: string, values: unknown[] = []): Promise<T[]> {
    const result = await this.db.query<PayloadRow>(sql, values);
    return result.rows.map((row) => parseReceiptStoreValue<T>(row.payload));
  }
}

export class PostgresReceiptStore
  extends PostgresReceiptStoreView
  implements TransactionalReceiptStore
{
  private readonly ownedHandle: PostgresHandle;

  constructor(config: PostgresReceiptStoreConfig) {
    const handle = createPostgresHandle(config);
    super(handle.pool, handle);
    this.ownedHandle = handle;
  }

  async transaction<T>(handler: (store: ReceiptStore) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const client: PoolClient = await this.ownedHandle.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const result = await handler(new PostgresReceiptStoreView(client, this.ownedHandle));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await rollback(client);
        if (
          !isRetryableTransactionError(error) ||
          attempt >= this.ownedHandle.maxTransactionRetries
        ) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(10 * 2 ** attempt, 250)));
      } finally {
        client.release();
      }
    }
  }

  async close(): Promise<void> {
    if (this.ownedHandle.ownsPool) await this.ownedHandle.pool.end();
  }
}

export function createPostgresReceiptStore(
  config: PostgresReceiptStoreConfig,
): PostgresReceiptStore {
  return new PostgresReceiptStore(config);
}
