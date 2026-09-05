import type { PoolClient } from 'pg';
import { creditUnitsToString, parseCreditUnits } from '@resvary/sdk/credits';
import type {
  CreditAccount,
  CreditLot,
  CreditLotAllocation,
  CreditReservation,
} from '@resvary/sdk/credits';
import { parseReceiptStoreValue, serializeReceiptStoreValue } from '@resvary/sdk/receipts';
import { createPostgresHandle, table, type PostgresConnectionConfig } from './connection.js';

export const POSTGRES_SCHEMA_VERSION = 4;
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
    if (currentVersion < 3) await applyV3(client, handle.schema);
    if (currentVersion < 4) await applyV4(client, handle.schema);
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

/** @internal Exported for sequential-migration verification. */
export async function applyV2(client: PoolClient, schema: string): Promise<void> {
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

/** @internal Exported for sequential-migration verification. */
export async function applyV3(client: PoolClient, schema: string): Promise<void> {
  const t = (name: string) => table({ schema }, name);
  await client.query('BEGIN');
  try {
    await client.query(`
      CREATE TABLE ${t('resvary_grant_policies')} (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, policy_key TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0), created_at BIGINT NOT NULL,
        payload JSONB NOT NULL, UNIQUE(project_id, policy_key, version)
      );
      CREATE INDEX resvary_grant_policies_project
        ON ${t('resvary_grant_policies')}(project_id, created_at);

      CREATE TABLE ${t('resvary_credit_lots')} (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, project_id TEXT NOT NULL,
        customer_id TEXT NOT NULL, kind TEXT NOT NULL,
        policy_id TEXT, original_units NUMERIC(78,0) NOT NULL,
        available_units NUMERIC(78,0) NOT NULL, reserved_units NUMERIC(78,0) NOT NULL,
        consumed_units NUMERIC(78,0) NOT NULL, expired_units NUMERIC(78,0) NOT NULL,
        expires_at BIGINT, created_at BIGINT NOT NULL, payload JSONB NOT NULL,
        CONSTRAINT resvary_credit_lots_kind
          CHECK (kind IN ('legacy', 'general', 'allowance', 'promotion')),
        CONSTRAINT resvary_credit_lots_balances_nonnegative
          CHECK (original_units > 0 AND available_units >= 0 AND reserved_units >= 0
            AND consumed_units >= 0 AND expired_units >= 0),
        CONSTRAINT resvary_credit_lots_balance_total
          CHECK (available_units + reserved_units + consumed_units + expired_units = original_units),
        CONSTRAINT resvary_credit_lots_account_fk FOREIGN KEY (account_id)
          REFERENCES ${t('resvary_credit_accounts')}(id),
        CONSTRAINT resvary_credit_lots_policy_fk FOREIGN KEY (policy_id)
          REFERENCES ${t('resvary_grant_policies')}(id)
      );
      CREATE INDEX resvary_credit_lots_account
        ON ${t('resvary_credit_lots')}(account_id, created_at);
      CREATE INDEX resvary_credit_lots_expiry
        ON ${t('resvary_credit_lots')}(project_id, expires_at)
        WHERE expires_at IS NOT NULL;

      CREATE TABLE ${t('resvary_credit_lot_allocations')} (
        id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL, lot_id TEXT NOT NULL,
        account_id TEXT NOT NULL, allocated_units NUMERIC(78,0) NOT NULL,
        reserved_units NUMERIC(78,0) NOT NULL, consumed_units NUMERIC(78,0) NOT NULL,
        released_units NUMERIC(78,0) NOT NULL, expired_units NUMERIC(78,0) NOT NULL,
        created_at BIGINT NOT NULL, payload JSONB NOT NULL,
        CONSTRAINT resvary_credit_lot_allocations_balances_nonnegative
          CHECK (allocated_units > 0 AND reserved_units >= 0 AND consumed_units >= 0
            AND released_units >= 0 AND expired_units >= 0),
        CONSTRAINT resvary_credit_lot_allocations_balance_total
          CHECK (reserved_units + consumed_units + released_units + expired_units = allocated_units),
        CONSTRAINT resvary_credit_lot_allocations_reservation_fk FOREIGN KEY (reservation_id)
          REFERENCES ${t('resvary_credit_reservations')}(id),
        CONSTRAINT resvary_credit_lot_allocations_lot_fk FOREIGN KEY (lot_id)
          REFERENCES ${t('resvary_credit_lots')}(id),
        CONSTRAINT resvary_credit_lot_allocations_account_fk FOREIGN KEY (account_id)
          REFERENCES ${t('resvary_credit_accounts')}(id),
        UNIQUE(reservation_id, lot_id)
      );
      CREATE INDEX resvary_credit_lot_allocations_reservation
        ON ${t('resvary_credit_lot_allocations')}(reservation_id, created_at);

      CREATE TABLE ${t('resvary_grant_policy_applications')} (
        id TEXT PRIMARY KEY, policy_id TEXT NOT NULL, account_id TEXT NOT NULL,
        project_id TEXT NOT NULL, customer_id TEXT NOT NULL, policy_type TEXT NOT NULL,
        period_key TEXT NOT NULL, created_at BIGINT NOT NULL, payload JSONB NOT NULL,
        CONSTRAINT resvary_grant_policy_applications_type
          CHECK (policy_type IN ('allowance', 'promotion')),
        CONSTRAINT resvary_grant_policy_applications_policy_fk FOREIGN KEY (policy_id)
          REFERENCES ${t('resvary_grant_policies')}(id),
        CONSTRAINT resvary_grant_policy_applications_account_fk FOREIGN KEY (account_id)
          REFERENCES ${t('resvary_credit_accounts')}(id),
        UNIQUE(policy_id, account_id, period_key)
      );
      CREATE INDEX resvary_grant_policy_applications_customer
        ON ${t('resvary_grant_policy_applications')}(project_id, customer_id, created_at);
    `);

    const accounts = await client.query<{ payload: string }>(
      `SELECT payload::text AS payload FROM ${t('resvary_credit_accounts')} ORDER BY id`,
    );
    for (const accountRow of accounts.rows) {
      const account = parseReceiptStoreValue<CreditAccount>(accountRow.payload);
      const posted = parseCreditUnits(account.postedUnits);
      const reserved = parseCreditUnits(account.reservedUnits);
      if (reserved > posted) {
        throw new Error(
          `Cannot migrate Postgres credit lots: account invariant failed for ${account.id}`,
        );
      }
      const reservations = await client.query<{ payload: string }>(
        `SELECT payload::text AS payload FROM ${t('resvary_credit_reservations')}
         WHERE account_id = $1 AND status = 'open' ORDER BY created_at, id`,
        [account.id],
      );
      const open = reservations.rows.map((item) =>
        parseReceiptStoreValue<CreditReservation>(item.payload),
      );
      const reservationTotal = open.reduce(
        (total, reservation) => total + parseCreditUnits(reservation.reservedUnits),
        0n,
      );
      if (reservationTotal !== reserved) {
        throw new Error(
          `Cannot migrate Postgres credit lots: open reservations do not match account ${account.id}`,
        );
      }
      if (posted === 0n) continue;
      const available = posted - reserved;
      const lot: CreditLot = {
        id: `lot_legacy_${account.id}`,
        accountId: account.id,
        projectId: account.projectId,
        customerId: account.customerId,
        kind: 'legacy',
        originalAmount: creditUnitsToString(posted),
        originalUnits: posted.toString(),
        availableAmount: creditUnitsToString(available),
        availableUnits: available.toString(),
        reservedAmount: creditUnitsToString(reserved),
        reservedUnits: reserved.toString(),
        consumedAmount: '0',
        consumedUnits: '0',
        expiredAmount: '0',
        expiredUnits: '0',
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
        metadata: { migratedFrom: 'postgres-v2' },
      };
      await client.query(
        `INSERT INTO ${t('resvary_credit_lots')} (
          id, account_id, project_id, customer_id, kind, policy_id,
          original_units, available_units, reserved_units, consumed_units, expired_units,
          expires_at, created_at, payload
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
        [
          lot.id,
          lot.accountId,
          lot.projectId,
          lot.customerId,
          lot.kind,
          null,
          lot.originalUnits,
          lot.availableUnits,
          lot.reservedUnits,
          lot.consumedUnits,
          lot.expiredUnits,
          null,
          lot.createdAt,
          serializeReceiptStoreValue(lot),
        ],
      );
      for (const reservation of open) {
        const units = parseCreditUnits(reservation.reservedUnits);
        if (units === 0n) continue;
        const allocation: CreditLotAllocation = {
          id: `cla_legacy_${reservation.id}`,
          reservationId: reservation.id,
          lotId: lot.id,
          accountId: account.id,
          projectId: account.projectId,
          customerId: account.customerId,
          allocatedAmount: creditUnitsToString(units),
          allocatedUnits: units.toString(),
          reservedAmount: creditUnitsToString(units),
          reservedUnits: units.toString(),
          consumedAmount: '0',
          consumedUnits: '0',
          releasedAmount: '0',
          releasedUnits: '0',
          expiredAmount: '0',
          expiredUnits: '0',
          createdAt: reservation.createdAt,
          updatedAt: account.updatedAt,
        };
        await client.query(
          `INSERT INTO ${t('resvary_credit_lot_allocations')} (
            id, reservation_id, lot_id, account_id, allocated_units, reserved_units,
            consumed_units, released_units, expired_units, created_at, payload
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
          [
            allocation.id,
            allocation.reservationId,
            allocation.lotId,
            allocation.accountId,
            allocation.allocatedUnits,
            allocation.reservedUnits,
            allocation.consumedUnits,
            allocation.releasedUnits,
            allocation.expiredUnits,
            allocation.createdAt,
            serializeReceiptStoreValue(allocation),
          ],
        );
      }
    }

    await client.query(
      `INSERT INTO ${t('resvary_schema_migrations')}(version, applied_at) VALUES (3, $1)`,
      [Date.now()],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** @internal Exported for sequential-migration verification. */
export async function applyV4(client: PoolClient, schema: string): Promise<void> {
  const t = (name: string) => table({ schema }, name);
  await client.query('BEGIN');
  try {
    await client.query(`
      ALTER TABLE ${t('resvary_credit_accounts')} ADD COLUMN created_at BIGINT;
      ALTER TABLE ${t('resvary_credit_grants')}
        ADD COLUMN project_id TEXT,
        ADD COLUMN customer_id TEXT,
        ADD COLUMN source TEXT;
      ALTER TABLE ${t('resvary_usage_events')}
        ADD COLUMN project_id TEXT,
        ADD COLUMN customer_id TEXT;
      ALTER TABLE ${t('resvary_usage_receipts')}
        ADD COLUMN project_id TEXT,
        ADD COLUMN customer_id TEXT;
      ALTER TABLE ${t('resvary_ledger_entries')}
        ADD COLUMN project_id TEXT,
        ADD COLUMN customer_id TEXT,
        ADD COLUMN entry_type TEXT;
      ALTER TABLE ${t('resvary_funding_transactions')}
        ADD COLUMN project_id TEXT,
        ADD COLUMN customer_id TEXT,
        ADD COLUMN settlement_status TEXT;

      CREATE TABLE ${t('resvary_operator_actions')} (
        id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence >= 0),
        project_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
        created_at BIGINT NOT NULL,
        payload JSONB NOT NULL,
        PRIMARY KEY(id, sequence)
      );
    `);

    for (const relation of [
      'resvary_credit_grants',
      'resvary_usage_events',
      'resvary_usage_receipts',
      'resvary_ledger_entries',
    ]) {
      const orphan = await client.query<{ id: string }>(
        `SELECT child.id FROM ${t(relation)} child
         LEFT JOIN ${t('resvary_credit_accounts')} account ON account.id = child.account_id
         WHERE account.id IS NULL LIMIT 1`,
      );
      if (orphan.rows[0]) {
        throw new Error(
          `Cannot migrate Postgres admin schema: orphan ${relation} row ${orphan.rows[0].id}`,
        );
      }
      const mismatch = await client.query<{ id: string }>(
        `SELECT child.id FROM ${t(relation)} child
         JOIN ${t('resvary_credit_accounts')} account ON account.id = child.account_id
         WHERE (child.payload->>'projectId') IS DISTINCT FROM account.project_id
            OR (child.payload->>'customerId') IS DISTINCT FROM account.customer_id
         LIMIT 1`,
      );
      if (mismatch.rows[0]) {
        throw new Error(
          `Cannot migrate Postgres admin schema: project/customer mismatch in ${relation} row ${mismatch.rows[0].id}`,
        );
      }
      await client.query(
        `UPDATE ${t(relation)} child
         SET project_id = account.project_id, customer_id = account.customer_id
         FROM ${t('resvary_credit_accounts')} account
         WHERE account.id = child.account_id`,
      );
    }

    const fundingMismatch = await client.query<{ id: string }>(
      `SELECT funding_tx.id FROM ${t('resvary_funding_transactions')} funding_tx
       LEFT JOIN ${t('resvary_funding_intents')} intent
         ON intent.id = funding_tx.funding_intent_id
       WHERE intent.id IS NULL
          OR (funding_tx.payload->>'projectId') IS DISTINCT FROM intent.project_id
          OR (funding_tx.payload->>'customerId') IS DISTINCT FROM intent.customer_id
       LIMIT 1`,
    );
    if (fundingMismatch.rows[0]) {
      throw new Error(
        `Cannot migrate Postgres admin schema: orphan or project/customer mismatch in funding transaction ${fundingMismatch.rows[0].id}`,
      );
    }

    await client.query(`
      UPDATE ${t('resvary_credit_accounts')}
        SET created_at = (payload->>'createdAt')::bigint;
      UPDATE ${t('resvary_credit_grants')}
        SET source = payload->>'source';
      UPDATE ${t('resvary_ledger_entries')}
        SET entry_type = payload->>'type';
      UPDATE ${t('resvary_funding_transactions')} funding_tx
        SET project_id = intent.project_id,
            customer_id = intent.customer_id,
            settlement_status = funding_tx.payload->>'settlementStatus'
        FROM ${t('resvary_funding_intents')} intent
        WHERE intent.id = funding_tx.funding_intent_id;

      ALTER TABLE ${t('resvary_credit_accounts')} ALTER COLUMN created_at SET NOT NULL;
      ALTER TABLE ${t('resvary_credit_grants')}
        ALTER COLUMN project_id SET NOT NULL,
        ALTER COLUMN customer_id SET NOT NULL,
        ALTER COLUMN source SET NOT NULL;
      ALTER TABLE ${t('resvary_usage_events')}
        ALTER COLUMN project_id SET NOT NULL,
        ALTER COLUMN customer_id SET NOT NULL;
      ALTER TABLE ${t('resvary_usage_receipts')}
        ALTER COLUMN project_id SET NOT NULL,
        ALTER COLUMN customer_id SET NOT NULL;
      ALTER TABLE ${t('resvary_ledger_entries')}
        ALTER COLUMN project_id SET NOT NULL,
        ALTER COLUMN customer_id SET NOT NULL,
        ALTER COLUMN entry_type SET NOT NULL;
      ALTER TABLE ${t('resvary_funding_transactions')}
        ALTER COLUMN project_id SET NOT NULL,
        ALTER COLUMN customer_id SET NOT NULL,
        ALTER COLUMN settlement_status SET NOT NULL;

      CREATE INDEX resvary_credit_accounts_admin_timeline
        ON ${t('resvary_credit_accounts')}(project_id, updated_at DESC, id DESC);
      CREATE INDEX resvary_credit_grants_admin_timeline
        ON ${t('resvary_credit_grants')}(project_id, customer_id, created_at DESC, id DESC);
      CREATE INDEX resvary_credit_grants_admin_project_timeline
        ON ${t('resvary_credit_grants')}(project_id, created_at DESC, id DESC);
      CREATE INDEX resvary_credit_reservations_admin_timeline
        ON ${t('resvary_credit_reservations')}(project_id, customer_id, created_at DESC, id DESC);
      CREATE INDEX resvary_credit_reservations_admin_project_timeline
        ON ${t('resvary_credit_reservations')}(project_id, created_at DESC, id DESC);
      CREATE INDEX resvary_usage_receipts_admin_timeline
        ON ${t('resvary_usage_receipts')}(project_id, customer_id, created_at DESC, id DESC);
      CREATE INDEX resvary_usage_receipts_admin_project_timeline
        ON ${t('resvary_usage_receipts')}(project_id, created_at DESC, id DESC);
      CREATE INDEX resvary_ledger_entries_admin_timeline
        ON ${t('resvary_ledger_entries')}(project_id, customer_id, created_at DESC, id DESC);
      CREATE INDEX resvary_ledger_entries_admin_project_timeline
        ON ${t('resvary_ledger_entries')}(project_id, created_at DESC, id DESC);
      CREATE INDEX resvary_funding_intents_admin_timeline
        ON ${t('resvary_funding_intents')}(project_id, customer_id, created_at DESC, id DESC);
      CREATE INDEX resvary_funding_intents_admin_project_timeline
        ON ${t('resvary_funding_intents')}(project_id, created_at DESC, id DESC);
      CREATE INDEX resvary_funding_transactions_admin_timeline
        ON ${t('resvary_funding_transactions')}(project_id, customer_id, created_at DESC, id DESC);
      CREATE INDEX resvary_funding_transactions_admin_project_timeline
        ON ${t('resvary_funding_transactions')}(project_id, created_at DESC, id DESC);
      CREATE INDEX resvary_operator_actions_admin_timeline
        ON ${t('resvary_operator_actions')}(project_id, created_at DESC, id DESC, sequence DESC);
    `);

    await client.query(
      `INSERT INTO ${t('resvary_schema_migrations')}(version, applied_at) VALUES (4, $1)`,
      [Date.now()],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
