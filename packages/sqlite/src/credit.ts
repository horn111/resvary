import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type {
  CreditAccount,
  CreditBalanceFilter,
  CreditGrant,
  CreditOutboxEvent,
  CreditReservation,
  CreditReservationFilter,
  CreditStore,
  CreditStoreReader,
  CreditStoreTransaction,
  IdempotencyRecord,
  FundingIntent,
  FundingTransaction,
  LedgerEntry,
  MeterDefinition,
  OutboxEventFilter,
  PriceVersion,
  UsageEvent,
  UsageReceipt,
} from '@settlary/sdk/credits';
import { parseReceiptStoreValue, serializeReceiptStoreValue } from '@settlary/sdk/receipts';

export interface SqliteCreditStoreConfig {
  path: string;
  createDirectory?: boolean;
}

type PayloadRow = { payload: string };

export class SqliteCreditStore implements CreditStore {
  private readonly db: DatabaseSyncType;
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(config: SqliteCreditStoreConfig) {
    if (config.path !== ':memory:' && config.createDirectory !== false) {
      mkdirSync(dirname(config.path), { recursive: true });
    }
    this.db = new DatabaseSync(config.path);
    this.migrate();
  }

  async transaction<T>(handler: (transaction: CreditStoreTransaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.transactionTail;
    this.transactionTail = previous.then(() => current);
    await previous;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = await handler(new SqliteCreditTransaction(this.db));
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      release();
    }
  }

  getAccount(id: string) {
    return reader(this.db).getAccount(id);
  }
  getAccountByCustomer(projectId: string, customerId: string) {
    return reader(this.db).getAccountByCustomer(projectId, customerId);
  }
  listAccounts(filter?: CreditBalanceFilter) {
    return reader(this.db).listAccounts(filter);
  }
  getGrant(id: string) {
    return reader(this.db).getGrant(id);
  }
  listGrants(accountId?: string) {
    return reader(this.db).listGrants(accountId);
  }
  getMeter(id: string) {
    return reader(this.db).getMeter(id);
  }
  getMeterByKey(projectId: string, key: string) {
    return reader(this.db).getMeterByKey(projectId, key);
  }
  getPriceVersion(id: string) {
    return reader(this.db).getPriceVersion(id);
  }
  listPriceVersions(meterId?: string) {
    return reader(this.db).listPriceVersions(meterId);
  }
  getReservation(id: string) {
    return reader(this.db).getReservation(id);
  }
  listReservations(filter?: CreditReservationFilter) {
    return reader(this.db).listReservations(filter);
  }
  getUsageEvent(id: string) {
    return reader(this.db).getUsageEvent(id);
  }
  getUsageReceipt(id: string) {
    return reader(this.db).getUsageReceipt(id);
  }
  listUsageReceipts(accountId?: string) {
    return reader(this.db).listUsageReceipts(accountId);
  }
  listLedgerEntries(accountId?: string) {
    return reader(this.db).listLedgerEntries(accountId);
  }
  getOutboxEvent(id: string) {
    return reader(this.db).getOutboxEvent(id);
  }
  listOutboxEvents(filter?: OutboxEventFilter) {
    return reader(this.db).listOutboxEvents(filter);
  }
  getIdempotencyRecord(scope: string, key: string) {
    return reader(this.db).getIdempotencyRecord(scope, key);
  }
  getFundingIntent(id: string) {
    return reader(this.db).getFundingIntent(id);
  }
  listFundingIntents(projectId?: string) {
    return reader(this.db).listFundingIntents(projectId);
  }
  getFundingTransaction(id: string) {
    return reader(this.db).getFundingTransaction(id);
  }
  getFundingTransactionByTxHash(network: string, txHash: `0x${string}`) {
    return reader(this.db).getFundingTransactionByTxHash(network, txHash);
  }
  listFundingTransactions(fundingIntentId?: string) {
    return reader(this.db).listFundingTransactions(fundingIntentId);
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS settlary_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settlary_credit_accounts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(project_id, customer_id)
      );

      CREATE TABLE IF NOT EXISTS settlary_credit_grants (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS settlary_credit_grants_account ON settlary_credit_grants(account_id);

      CREATE TABLE IF NOT EXISTS settlary_meters (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        meter_key TEXT NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(project_id, meter_key)
      );

      CREATE TABLE IF NOT EXISTS settlary_price_versions (
        id TEXT PRIMARY KEY,
        meter_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(meter_id, version)
      );

      CREATE TABLE IF NOT EXISTS settlary_credit_reservations (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS settlary_credit_reservations_open
        ON settlary_credit_reservations(project_id, customer_id, status, expires_at);

      CREATE TABLE IF NOT EXISTS settlary_usage_events (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settlary_usage_receipts (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        reservation_id TEXT NOT NULL UNIQUE,
        usage_event_id TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS settlary_usage_receipts_account ON settlary_usage_receipts(account_id, created_at);

      CREATE TABLE IF NOT EXISTS settlary_ledger_entries (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS settlary_ledger_entries_account ON settlary_ledger_entries(account_id, created_at);

      CREATE TABLE IF NOT EXISTS settlary_funding_intents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settlary_funding_transactions (
        id TEXT PRIMARY KEY,
        funding_intent_id TEXT NOT NULL,
        network TEXT NOT NULL,
        tx_hash_norm TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(network, tx_hash_norm)
      );

      CREATE TABLE IF NOT EXISTS settlary_idempotency_keys (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY(scope, key)
      );

      CREATE TABLE IF NOT EXISTS settlary_outbox_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS settlary_outbox_events_pending
        ON settlary_outbox_events(project_id, status, created_at);

      INSERT OR IGNORE INTO settlary_schema_migrations(version, applied_at)
        VALUES (1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
    `);
  }
}

class SqliteCreditTransaction implements CreditStoreTransaction {
  constructor(private readonly db: DatabaseSyncType) {}
  getAccount(id: string) {
    return reader(this.db).getAccount(id);
  }
  getAccountByCustomer(projectId: string, customerId: string) {
    return reader(this.db).getAccountByCustomer(projectId, customerId);
  }
  listAccounts(filter?: CreditBalanceFilter) {
    return reader(this.db).listAccounts(filter);
  }
  getGrant(id: string) {
    return reader(this.db).getGrant(id);
  }
  listGrants(accountId?: string) {
    return reader(this.db).listGrants(accountId);
  }
  getMeter(id: string) {
    return reader(this.db).getMeter(id);
  }
  getMeterByKey(projectId: string, key: string) {
    return reader(this.db).getMeterByKey(projectId, key);
  }
  getPriceVersion(id: string) {
    return reader(this.db).getPriceVersion(id);
  }
  listPriceVersions(meterId?: string) {
    return reader(this.db).listPriceVersions(meterId);
  }
  getReservation(id: string) {
    return reader(this.db).getReservation(id);
  }
  listReservations(filter?: CreditReservationFilter) {
    return reader(this.db).listReservations(filter);
  }
  getUsageEvent(id: string) {
    return reader(this.db).getUsageEvent(id);
  }
  getUsageReceipt(id: string) {
    return reader(this.db).getUsageReceipt(id);
  }
  listUsageReceipts(accountId?: string) {
    return reader(this.db).listUsageReceipts(accountId);
  }
  listLedgerEntries(accountId?: string) {
    return reader(this.db).listLedgerEntries(accountId);
  }
  getOutboxEvent(id: string) {
    return reader(this.db).getOutboxEvent(id);
  }
  listOutboxEvents(filter?: OutboxEventFilter) {
    return reader(this.db).listOutboxEvents(filter);
  }
  getIdempotencyRecord(scope: string, key: string) {
    return reader(this.db).getIdempotencyRecord(scope, key);
  }
  getFundingIntent(id: string) {
    return reader(this.db).getFundingIntent(id);
  }
  listFundingIntents(projectId?: string) {
    return reader(this.db).listFundingIntents(projectId);
  }
  getFundingTransaction(id: string) {
    return reader(this.db).getFundingTransaction(id);
  }
  getFundingTransactionByTxHash(network: string, txHash: `0x${string}`) {
    return reader(this.db).getFundingTransactionByTxHash(network, txHash);
  }
  listFundingTransactions(fundingIntentId?: string) {
    return reader(this.db).listFundingTransactions(fundingIntentId);
  }

  async saveAccount(value: CreditAccount) {
    upsert(
      this.db,
      'settlary_credit_accounts',
      ['id', 'project_id', 'customer_id', 'updated_at'],
      [value.id, value.projectId, value.customerId, value.updatedAt],
      value,
    );
  }
  async saveGrant(value: CreditGrant) {
    insert(
      this.db,
      'settlary_credit_grants',
      ['id', 'account_id', 'created_at'],
      [value.id, value.accountId, value.createdAt],
      value,
    );
  }
  async saveMeter(value: MeterDefinition) {
    insert(
      this.db,
      'settlary_meters',
      ['id', 'project_id', 'meter_key'],
      [value.id, value.projectId, value.key],
      value,
    );
  }
  async savePriceVersion(value: PriceVersion) {
    insert(
      this.db,
      'settlary_price_versions',
      ['id', 'meter_id', 'version', 'created_at'],
      [value.id, value.meterId, value.version, value.createdAt],
      value,
    );
  }
  async saveReservation(value: CreditReservation) {
    upsert(
      this.db,
      'settlary_credit_reservations',
      ['id', 'account_id', 'project_id', 'customer_id', 'status', 'expires_at', 'created_at'],
      [
        value.id,
        value.accountId,
        value.projectId,
        value.customerId,
        value.status,
        value.expiresAt,
        value.createdAt,
      ],
      value,
    );
  }
  async saveUsageEvent(value: UsageEvent) {
    insert(
      this.db,
      'settlary_usage_events',
      ['id', 'account_id', 'received_at'],
      [value.id, value.accountId, value.receivedAt],
      value,
    );
  }
  async saveUsageReceipt(value: UsageReceipt) {
    insert(
      this.db,
      'settlary_usage_receipts',
      ['id', 'account_id', 'reservation_id', 'usage_event_id', 'created_at'],
      [value.id, value.accountId, value.reservationId, value.usageEventId, value.createdAt],
      value,
    );
  }
  async saveLedgerEntry(value: LedgerEntry) {
    insert(
      this.db,
      'settlary_ledger_entries',
      ['id', 'account_id', 'created_at'],
      [value.id, value.accountId, value.createdAt],
      value,
    );
  }
  async saveOutboxEvent(value: CreditOutboxEvent) {
    upsert(
      this.db,
      'settlary_outbox_events',
      ['id', 'project_id', 'type', 'status', 'created_at'],
      [value.id, value.projectId, value.type, value.status, value.createdAt],
      value,
    );
  }
  async saveIdempotencyRecord(value: IdempotencyRecord) {
    insert(
      this.db,
      'settlary_idempotency_keys',
      ['scope', 'key', 'created_at'],
      [value.scope, value.key, value.createdAt],
      value,
      ['scope', 'key'],
    );
  }
  async saveFundingIntent(value: FundingIntent) {
    upsert(
      this.db,
      'settlary_funding_intents',
      ['id', 'project_id', 'customer_id', 'status', 'created_at'],
      [value.id, value.projectId, value.customerId, value.status, value.createdAt],
      value,
    );
  }
  async saveFundingTransaction(value: FundingTransaction) {
    insert(
      this.db,
      'settlary_funding_transactions',
      ['id', 'funding_intent_id', 'network', 'tx_hash_norm', 'created_at'],
      [value.id, value.fundingIntentId, value.network, value.txHash.toLowerCase(), value.createdAt],
      value,
    );
  }
}

function reader(db: DatabaseSyncType): CreditStoreReader {
  return {
    async getAccount(id) {
      return one<CreditAccount>(db, 'SELECT payload FROM settlary_credit_accounts WHERE id = ?', [
        id,
      ]);
    },
    async getAccountByCustomer(projectId, customerId) {
      return one<CreditAccount>(
        db,
        'SELECT payload FROM settlary_credit_accounts WHERE project_id = ? AND customer_id = ?',
        [projectId, customerId],
      );
    },
    async listAccounts(filter = {}) {
      return all<CreditAccount>(
        db,
        'SELECT payload FROM settlary_credit_accounts ORDER BY updated_at ASC',
      ).filter((item) => matchesBalanceFilter(item, filter));
    },
    async getGrant(id) {
      return one<CreditGrant>(db, 'SELECT payload FROM settlary_credit_grants WHERE id = ?', [id]);
    },
    async listGrants(accountId) {
      return accountId
        ? all<CreditGrant>(
            db,
            'SELECT payload FROM settlary_credit_grants WHERE account_id = ? ORDER BY created_at ASC',
            [accountId],
          )
        : all<CreditGrant>(
            db,
            'SELECT payload FROM settlary_credit_grants ORDER BY created_at ASC',
          );
    },
    async getMeter(id) {
      return one<MeterDefinition>(db, 'SELECT payload FROM settlary_meters WHERE id = ?', [id]);
    },
    async getMeterByKey(projectId, key) {
      return one<MeterDefinition>(
        db,
        'SELECT payload FROM settlary_meters WHERE project_id = ? AND meter_key = ?',
        [projectId, key],
      );
    },
    async getPriceVersion(id) {
      return one<PriceVersion>(db, 'SELECT payload FROM settlary_price_versions WHERE id = ?', [
        id,
      ]);
    },
    async listPriceVersions(meterId) {
      return meterId
        ? all<PriceVersion>(
            db,
            'SELECT payload FROM settlary_price_versions WHERE meter_id = ? ORDER BY version ASC',
            [meterId],
          )
        : all<PriceVersion>(
            db,
            'SELECT payload FROM settlary_price_versions ORDER BY created_at ASC',
          );
    },
    async getReservation(id) {
      return one<CreditReservation>(
        db,
        'SELECT payload FROM settlary_credit_reservations WHERE id = ?',
        [id],
      );
    },
    async listReservations(filter = {}) {
      return all<CreditReservation>(
        db,
        'SELECT payload FROM settlary_credit_reservations ORDER BY created_at ASC',
      ).filter(
        (item) =>
          matchesBalanceFilter(item, filter) && (!filter.status || item.status === filter.status),
      );
    },
    async getUsageEvent(id) {
      return one<UsageEvent>(db, 'SELECT payload FROM settlary_usage_events WHERE id = ?', [id]);
    },
    async getUsageReceipt(id) {
      return one<UsageReceipt>(db, 'SELECT payload FROM settlary_usage_receipts WHERE id = ?', [
        id,
      ]);
    },
    async listUsageReceipts(accountId) {
      return accountId
        ? all<UsageReceipt>(
            db,
            'SELECT payload FROM settlary_usage_receipts WHERE account_id = ? ORDER BY created_at ASC',
            [accountId],
          )
        : all<UsageReceipt>(
            db,
            'SELECT payload FROM settlary_usage_receipts ORDER BY created_at ASC',
          );
    },
    async listLedgerEntries(accountId) {
      return accountId
        ? all<LedgerEntry>(
            db,
            'SELECT payload FROM settlary_ledger_entries WHERE account_id = ? ORDER BY created_at ASC, rowid ASC',
            [accountId],
          )
        : all<LedgerEntry>(
            db,
            'SELECT payload FROM settlary_ledger_entries ORDER BY created_at ASC, rowid ASC',
          );
    },
    async getOutboxEvent(id) {
      return one<CreditOutboxEvent>(db, 'SELECT payload FROM settlary_outbox_events WHERE id = ?', [
        id,
      ]);
    },
    async listOutboxEvents(filter = {}) {
      return all<CreditOutboxEvent>(
        db,
        'SELECT payload FROM settlary_outbox_events ORDER BY created_at ASC, rowid ASC',
      ).filter(
        (item) =>
          (!filter.projectId || item.projectId === filter.projectId) &&
          (!filter.status || item.status === filter.status) &&
          (!filter.type || item.type === filter.type),
      );
    },
    async getIdempotencyRecord(scope, key) {
      return one<IdempotencyRecord>(
        db,
        'SELECT payload FROM settlary_idempotency_keys WHERE scope = ? AND key = ?',
        [scope, key],
      );
    },
    async getFundingIntent(id) {
      return one<FundingIntent>(db, 'SELECT payload FROM settlary_funding_intents WHERE id = ?', [
        id,
      ]);
    },
    async listFundingIntents(projectId) {
      return projectId
        ? all<FundingIntent>(
            db,
            'SELECT payload FROM settlary_funding_intents WHERE project_id = ? ORDER BY created_at ASC',
            [projectId],
          )
        : all<FundingIntent>(
            db,
            'SELECT payload FROM settlary_funding_intents ORDER BY created_at ASC',
          );
    },
    async getFundingTransaction(id) {
      return one<FundingTransaction>(
        db,
        'SELECT payload FROM settlary_funding_transactions WHERE id = ?',
        [id],
      );
    },
    async getFundingTransactionByTxHash(network, txHash) {
      return one<FundingTransaction>(
        db,
        'SELECT payload FROM settlary_funding_transactions WHERE network = ? AND tx_hash_norm = ?',
        [network, txHash.toLowerCase()],
      );
    },
    async listFundingTransactions(fundingIntentId) {
      return fundingIntentId
        ? all<FundingTransaction>(
            db,
            'SELECT payload FROM settlary_funding_transactions WHERE funding_intent_id = ? ORDER BY created_at ASC',
            [fundingIntentId],
          )
        : all<FundingTransaction>(
            db,
            'SELECT payload FROM settlary_funding_transactions ORDER BY created_at ASC',
          );
    },
  };
}

function insert(
  db: DatabaseSyncType,
  table: string,
  columns: string[],
  values: unknown[],
  payload: unknown,
  conflictColumns: string[] = ['id'],
): void {
  const allColumns = [...columns, 'payload'];
  const placeholders = allColumns.map(() => '?').join(', ');
  const conflict = conflictColumns.join(', ');
  db.prepare(
    `INSERT INTO ${table} (${allColumns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${conflict}) DO NOTHING`,
  ).run(...values, serializeReceiptStoreValue(payload));
}

function upsert(
  db: DatabaseSyncType,
  table: string,
  columns: string[],
  values: unknown[],
  payload: unknown,
): void {
  const allColumns = [...columns, 'payload'];
  const placeholders = allColumns.map(() => '?').join(', ');
  const updates = allColumns
    .filter((column) => column !== 'id')
    .map((column) => `${column} = excluded.${column}`)
    .join(', ');
  db.prepare(
    `INSERT INTO ${table} (${allColumns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`,
  ).run(...values, serializeReceiptStoreValue(payload));
}

function one<T>(db: DatabaseSyncType, sql: string, params: unknown[] = []): T | undefined {
  return parseRow<T>(db.prepare(sql).get(...params));
}
function all<T>(db: DatabaseSyncType, sql: string, params: unknown[] = []): T[] {
  return db
    .prepare(sql)
    .all(...params)
    .map((row) => parseRow<T>(row)!)
    .filter(Boolean);
}
function parseRow<T>(row: unknown): T | undefined {
  if (
    !row ||
    typeof row !== 'object' ||
    !('payload' in row) ||
    typeof (row as PayloadRow).payload !== 'string'
  )
    return undefined;
  return parseReceiptStoreValue<T>((row as PayloadRow).payload);
}
function matchesBalanceFilter(
  value: { projectId: string; customerId: string },
  filter: CreditBalanceFilter,
): boolean {
  return (
    (!filter.projectId || value.projectId === filter.projectId) &&
    (!filter.customerId || value.customerId === filter.customerId)
  );
}

export function createSqliteCreditStore(config: SqliteCreditStoreConfig): SqliteCreditStore {
  return new SqliteCreditStore(config);
}
