import type { PoolClient } from 'pg';
import { createPostgresHandle, table, type PostgresConnectionConfig } from './connection.js';

export const POSTGRES_SCHEMA_VERSION = 1;
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
        `SELECT COALESCE(MAX(version), 0)::int AS version FROM ${table(handle, 'resvary_schema_migrations')}`,
      );
      currentVersion = result.rows[0]?.version ?? 0;
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
      `SELECT COALESCE(MAX(version), 0)::int AS version FROM ${table(handle, 'resvary_schema_migrations')}`,
    );
    if ((current.rows[0]?.version ?? 0) < 1) await applyV1(client, handle.schema);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
    if (handle.ownsPool) await handle.pool.end();
  }
  return getPostgresMigrationStatus(config);
}

async function applyV1(client: PoolClient, schema: string): Promise<void> {
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
