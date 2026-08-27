import type { PoolClient } from 'pg';
import { createPostgresHandle, table, type PostgresConnectionConfig } from './connection.js';

export const POSTGRES_SCHEMA_VERSION = 2;
const MIGRATION_LOCK_ID = 7_226_519_918;

export interface PostgresMigrationStatus {
  schema: string;
  currentVersion: number;
  latestVersion: number;
  pendingVersions: number[];
}

export async function getPostgresMigrationStatus(
  config: PostgresConnectionConfig,
): Promise<PostgresMigrationStatus> {
  const handle = createPostgresHandle(config);
  try {
    const exists = await handle.pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = $1 AND table_name = 'resvary_schema_migrations'
       ) AS exists`,
      [handle.schema],
    );
    let currentVersion = 0;
    if (exists.rows[0]?.exists) {
      const result = await handle.pool.query<{ version: number }>(
        `SELECT version FROM ${table(handle, 'resvary_schema_migrations')} ORDER BY version ASC`,
      );
      currentVersion = assertMigrationHistory(result.rows.map((row) => row.version));
    }
    return {
      schema: handle.schema,
      currentVersion,
      latestVersion: POSTGRES_SCHEMA_VERSION,
      pendingVersions: Array.from(
        { length: POSTGRES_SCHEMA_VERSION - currentVersion },
        (_, index) => currentVersion + index + 1,
      ),
    };
  } finally {
    if (handle.ownsPool) await handle.pool.end();
  }
}

export async function migratePostgres(
  config: PostgresConnectionConfig,
): Promise<PostgresMigrationStatus> {
  const handle = createPostgresHandle(config);
  const client = await handle.pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${handle.schema}"`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${table(handle, 'resvary_schema_migrations')} (
        version INTEGER PRIMARY KEY,
        applied_at BIGINT NOT NULL
      )
    `);
    const current = await client.query<{ version: number }>(
      `SELECT version FROM ${table(handle, 'resvary_schema_migrations')} ORDER BY version ASC`,
    );
    const currentVersion = assertMigrationHistory(current.rows.map((row) => row.version));
    if (currentVersion < 1) await applyV1(client, handle.schema);
    if (currentVersion < 2) await applyV2(client, handle.schema);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
    if (handle.ownsPool) await handle.pool.end();
  }
  return getPostgresMigrationStatus(config);
}

function assertMigrationHistory(versions: number[]): number {
  for (let index = 0; index < versions.length; index += 1) {
    const expected = index + 1;
    if (versions[index] !== expected) {
      throw new Error(
        `Invalid Postgres migration history: expected version ${expected}, found ${versions[index]}`,
      );
    }
  }
  const currentVersion = versions.at(-1) ?? 0;
  if (currentVersion > POSTGRES_SCHEMA_VERSION) {
    throw new Error(
      `Postgres schema version ${currentVersion} is newer than supported version ${POSTGRES_SCHEMA_VERSION}`,
    );
  }
  return currentVersion;
}

/** @internal Exported for sequential-migration verification. */
export async function applyV1(client: PoolClient, schema: string): Promise<void> {
  const t = (name: string) => table({ schema }, name);
  await client.query('BEGIN');
  try {
    await client.query(`
      CREATE TABLE ${t('resvary_credit_accounts')} (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, customer_id TEXT NOT NULL,
        currency TEXT NOT NULL, posted_units NUMERIC(78,0) NOT NULL,
        reserved_units NUMERIC(78,0) NOT NULL, updated_at BIGINT NOT NULL, payload JSONB NOT NULL,
        UNIQUE(project_id, customer_id)
      );
      CREATE TABLE ${t('resvary_credit_grants')} (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, amount_units NUMERIC(78,0) NOT NULL,
        created_at BIGINT NOT NULL, payload JSONB NOT NULL
      );
      CREATE INDEX resvary_credit_grants_account ON ${t('resvary_credit_grants')}(account_id);
      CREATE TABLE ${t('resvary_meters')} (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, meter_key TEXT NOT NULL, payload JSONB NOT NULL,
        UNIQUE(project_id, meter_key)
      );
      CREATE TABLE ${t('resvary_price_versions')} (
        id TEXT PRIMARY KEY, meter_id TEXT NOT NULL, version INTEGER NOT NULL,
        created_at BIGINT NOT NULL, payload JSONB NOT NULL, UNIQUE(meter_id, version)
      );
      CREATE TABLE ${t('resvary_credit_reservations')} (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, project_id TEXT NOT NULL,
        customer_id TEXT NOT NULL, status TEXT NOT NULL,
        reserved_units NUMERIC(78,0) NOT NULL, expires_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL, payload JSONB NOT NULL
      );
      CREATE INDEX resvary_credit_reservations_open
        ON ${t('resvary_credit_reservations')}(project_id, customer_id, status, expires_at);
      CREATE TABLE ${t('resvary_usage_events')} (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, received_at BIGINT NOT NULL, payload JSONB NOT NULL
      );
      CREATE TABLE ${t('resvary_usage_receipts')} (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, reservation_id TEXT NOT NULL UNIQUE,
        usage_event_id TEXT NOT NULL UNIQUE, charged_units NUMERIC(78,0) NOT NULL,
        created_at BIGINT NOT NULL, payload JSONB NOT NULL
      );
      CREATE INDEX resvary_usage_receipts_account
        ON ${t('resvary_usage_receipts')}(account_id, created_at);
      CREATE TABLE ${t('resvary_ledger_entries')} (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, delta_units NUMERIC(78,0) NOT NULL,
        balance_after_units NUMERIC(78,0) NOT NULL, created_at BIGINT NOT NULL, payload JSONB NOT NULL
      );
      CREATE INDEX resvary_ledger_entries_account
        ON ${t('resvary_ledger_entries')}(account_id, created_at);
      CREATE TABLE ${t('resvary_funding_intents')} (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, customer_id TEXT NOT NULL,
        status TEXT NOT NULL, requested_units NUMERIC(78,0) NOT NULL,
        created_at BIGINT NOT NULL, payload JSONB NOT NULL
      );
      CREATE TABLE ${t('resvary_funding_transactions')} (
        id TEXT PRIMARY KEY, funding_intent_id TEXT NOT NULL, rail TEXT NOT NULL,
        network TEXT NOT NULL, external_payment_id_norm TEXT NOT NULL, tx_hash_norm TEXT,
        amount_units NUMERIC(78,0) NOT NULL, created_at BIGINT NOT NULL, payload JSONB NOT NULL,
        UNIQUE(rail, network, external_payment_id_norm)
      );
      CREATE UNIQUE INDEX resvary_funding_transactions_tx_hash
        ON ${t('resvary_funding_transactions')}(network, tx_hash_norm)
        WHERE tx_hash_norm IS NOT NULL;
      CREATE TABLE ${t('resvary_idempotency_keys')} (
        scope TEXT NOT NULL, key TEXT NOT NULL, created_at BIGINT NOT NULL, payload JSONB NOT NULL,
        PRIMARY KEY(scope, key)
      );
      CREATE TABLE ${t('resvary_outbox_events')} (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL,
        created_at BIGINT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at BIGINT NOT NULL, lease_owner TEXT, lease_expires_at BIGINT,
        last_attempt_at BIGINT, last_error TEXT, delivered_at BIGINT, payload JSONB NOT NULL
      );
      CREATE INDEX resvary_outbox_events_due
        ON ${t('resvary_outbox_events')}(project_id, status, next_attempt_at, created_at);

      CREATE TABLE ${t('resvary_invoices')} (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, customer_id TEXT, amount_units NUMERIC(78,0) NOT NULL,
        created_at BIGINT NOT NULL, payload JSONB NOT NULL
      );
      CREATE INDEX resvary_invoices_status ON ${t('resvary_invoices')}(status);
      CREATE INDEX resvary_invoices_customer_id ON ${t('resvary_invoices')}(customer_id);
      CREATE TABLE ${t('resvary_receipts')} (
        id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, tx_hash_norm TEXT, status TEXT NOT NULL,
        amount_units NUMERIC(78,0) NOT NULL, created_at BIGINT NOT NULL, payload JSONB NOT NULL
      );
      CREATE UNIQUE INDEX resvary_receipts_invoice_tx_hash
        ON ${t('resvary_receipts')}(invoice_id, tx_hash_norm) WHERE tx_hash_norm IS NOT NULL;
      CREATE TABLE ${t('arc_webhook_events')} (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, created_at BIGINT NOT NULL, payload JSONB NOT NULL
      );
      CREATE TABLE ${t('arc_webhook_deliveries')} (
        id TEXT PRIMARY KEY, event_id TEXT NOT NULL, event_type TEXT NOT NULL, attempt INTEGER NOT NULL,
        status TEXT NOT NULL, received_at BIGINT NOT NULL, payload JSONB NOT NULL
      );
      CREATE INDEX arc_webhook_deliveries_event_id ON ${t('arc_webhook_deliveries')}(event_id);
      CREATE TABLE ${t('arc_watcher_cursors')} (
        key TEXT PRIMARY KEY, network TEXT NOT NULL, invoice_id TEXT, memo_id_norm TEXT,
        next_from_block NUMERIC(78,0) NOT NULL, updated_at BIGINT NOT NULL, payload JSONB NOT NULL
      );
    `);
    await client.query(
      `INSERT INTO ${t('resvary_schema_migrations')}(version, applied_at) VALUES (1, $1)`,
      [Date.now()],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function applyV2(client: PoolClient, schema: string): Promise<void> {
  const t = (name: string) => table({ schema }, name);
  await client.query('BEGIN');
  try {
    const duplicateReceipt = await client.query<{ tx_hash_norm: string; count: string }>(
      `SELECT tx_hash_norm, COUNT(*)::text AS count
       FROM ${t('resvary_receipts')}
       WHERE tx_hash_norm IS NOT NULL
       GROUP BY tx_hash_norm
       HAVING COUNT(*) > 1
       LIMIT 1`,
    );
    if (duplicateReceipt.rows[0]) {
      throw new Error(
        `Cannot enforce receipt transaction uniqueness: ${duplicateReceipt.rows[0].count} receipts use ${duplicateReceipt.rows[0].tx_hash_norm}`,
      );
    }

    await client.query(`
      DROP INDEX IF EXISTS "${schema}".resvary_receipts_invoice_tx_hash;
      CREATE UNIQUE INDEX resvary_receipts_tx_hash
        ON ${t('resvary_receipts')}(tx_hash_norm)
        WHERE tx_hash_norm IS NOT NULL;

      ALTER TABLE ${t('resvary_credit_accounts')}
        ADD CONSTRAINT resvary_credit_accounts_nonnegative
        CHECK (posted_units >= 0 AND reserved_units >= 0 AND reserved_units <= posted_units);
      ALTER TABLE ${t('resvary_credit_grants')}
        ADD CONSTRAINT resvary_credit_grants_amount_positive CHECK (amount_units > 0),
        ADD CONSTRAINT resvary_credit_grants_account_fk FOREIGN KEY (account_id)
          REFERENCES ${t('resvary_credit_accounts')}(id);
      ALTER TABLE ${t('resvary_price_versions')}
        ADD CONSTRAINT resvary_price_versions_version_positive CHECK (version > 0),
        ADD CONSTRAINT resvary_price_versions_meter_fk FOREIGN KEY (meter_id)
          REFERENCES ${t('resvary_meters')}(id);
      ALTER TABLE ${t('resvary_credit_reservations')}
        ADD CONSTRAINT resvary_credit_reservations_status
          CHECK (status IN ('open', 'committed', 'released', 'expired')),
        ADD CONSTRAINT resvary_credit_reservations_units_nonnegative CHECK (reserved_units >= 0),
        ADD CONSTRAINT resvary_credit_reservations_account_fk FOREIGN KEY (account_id)
          REFERENCES ${t('resvary_credit_accounts')}(id);
      ALTER TABLE ${t('resvary_usage_events')}
        ADD CONSTRAINT resvary_usage_events_account_fk FOREIGN KEY (account_id)
          REFERENCES ${t('resvary_credit_accounts')}(id);
      ALTER TABLE ${t('resvary_usage_receipts')}
        ADD CONSTRAINT resvary_usage_receipts_units_nonnegative CHECK (charged_units >= 0),
        ADD CONSTRAINT resvary_usage_receipts_account_fk FOREIGN KEY (account_id)
          REFERENCES ${t('resvary_credit_accounts')}(id),
        ADD CONSTRAINT resvary_usage_receipts_reservation_fk FOREIGN KEY (reservation_id)
          REFERENCES ${t('resvary_credit_reservations')}(id),
        ADD CONSTRAINT resvary_usage_receipts_usage_event_fk FOREIGN KEY (usage_event_id)
          REFERENCES ${t('resvary_usage_events')}(id);
      ALTER TABLE ${t('resvary_ledger_entries')}
        ADD CONSTRAINT resvary_ledger_entries_balance_nonnegative CHECK (balance_after_units >= 0),
        ADD CONSTRAINT resvary_ledger_entries_account_fk FOREIGN KEY (account_id)
          REFERENCES ${t('resvary_credit_accounts')}(id);
      ALTER TABLE ${t('resvary_funding_intents')}
        ADD CONSTRAINT resvary_funding_intents_status
          CHECK (status IN ('pending', 'confirmed', 'failed')),
        ADD CONSTRAINT resvary_funding_intents_units_positive CHECK (requested_units > 0);
      ALTER TABLE ${t('resvary_funding_transactions')}
        ADD CONSTRAINT resvary_funding_transactions_units_positive CHECK (amount_units > 0),
        ADD CONSTRAINT resvary_funding_transactions_intent_fk FOREIGN KEY (funding_intent_id)
          REFERENCES ${t('resvary_funding_intents')}(id);
      ALTER TABLE ${t('resvary_outbox_events')}
        ADD CONSTRAINT resvary_outbox_events_status
          CHECK (status IN ('pending', 'processing', 'delivered', 'dead_letter')),
        ADD CONSTRAINT resvary_outbox_events_attempt_nonnegative CHECK (attempt_count >= 0);
      ALTER TABLE ${t('resvary_invoices')}
        ADD CONSTRAINT resvary_invoices_status
          CHECK (status IN ('open', 'observed', 'paid', 'expired', 'refunded', 'void')),
        ADD CONSTRAINT resvary_invoices_amount_positive CHECK (amount_units > 0);
      ALTER TABLE ${t('resvary_receipts')}
        ADD CONSTRAINT resvary_receipts_status CHECK (status IN ('paid', 'refunded')),
        ADD CONSTRAINT resvary_receipts_amount_positive CHECK (amount_units > 0),
        ADD CONSTRAINT resvary_receipts_invoice_fk FOREIGN KEY (invoice_id)
          REFERENCES ${t('resvary_invoices')}(id);
      ALTER TABLE ${t('arc_webhook_deliveries')}
        ADD CONSTRAINT arc_webhook_deliveries_status CHECK (status IN ('verified', 'failed')),
        ADD CONSTRAINT arc_webhook_deliveries_attempt_positive CHECK (attempt > 0);
      ALTER TABLE ${t('arc_watcher_cursors')}
        ADD CONSTRAINT arc_watcher_cursors_block_nonnegative CHECK (next_from_block >= 0);
    `);
    await client.query(
      `INSERT INTO ${t('resvary_schema_migrations')}(version, applied_at) VALUES (2, $1)`,
      [Date.now()],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
