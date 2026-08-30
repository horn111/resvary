import { DatabaseSync } from 'node:sqlite';
import type { PoolClient } from 'pg';
import { parseReceiptStoreValue } from '@resvary/sdk/receipts';
import {
  createPostgresHandle,
  rollback,
  table,
  type PostgresConnectionConfig,
} from './connection.js';
import { POSTGRES_SCHEMA_VERSION } from './migrations.js';

type JsonRecord = Record<string, unknown>;
type SourceRow = Record<string, unknown> & { payload: string };

export interface SqliteImportConfig extends PostgresConnectionConfig {
  sqlitePath: string;
  dryRun?: boolean;
}

export interface SqliteImportReport {
  sqliteSchemaVersion: number;
  postgresSchemaVersion: number;
  dryRun: boolean;
  committed: boolean;
  counts: Record<string, number>;
  contentMismatches: string[];
  balanceMismatches: string[];
  ledgerMismatches: string[];
  allocationMismatches: string[];
  sourceOpenReservations: number;
  targetOpenReservations: number;
}

type TableDefinition = {
  name: string;
  columns: string[];
  values(payload: JsonRecord): unknown[];
};

const TABLES: TableDefinition[] = [
  define(
    'resvary_credit_accounts',
    ['id', 'project_id', 'customer_id', 'currency', 'posted_units', 'reserved_units', 'updated_at'],
    (p) => [
      p.id,
      p.projectId,
      p.customerId,
      p.currency,
      p.postedUnits,
      p.reservedUnits,
      p.updatedAt,
    ],
  ),
  define('resvary_credit_grants', ['id', 'account_id', 'amount_units', 'created_at'], (p) => [
    p.id,
    p.accountId,
    p.amountUnits,
    p.createdAt,
  ]),
  define(
    'resvary_grant_policies',
    ['id', 'project_id', 'policy_key', 'version', 'created_at'],
    (p) => [p.id, p.projectId, p.key, p.version, p.createdAt],
  ),
  define(
    'resvary_credit_lots',
    [
      'id',
      'account_id',
      'project_id',
      'customer_id',
      'kind',
      'policy_id',
      'original_units',
      'available_units',
      'reserved_units',
      'consumed_units',
      'expired_units',
      'expires_at',
      'created_at',
    ],
    (p) => [
      p.id,
      p.accountId,
      p.projectId,
      p.customerId,
      p.kind,
      p.policyId ?? null,
      p.originalUnits,
      p.availableUnits,
      p.reservedUnits,
      p.consumedUnits,
      p.expiredUnits,
      p.expiresAt ?? null,
      p.createdAt,
    ],
  ),
  define('resvary_meters', ['id', 'project_id', 'meter_key'], (p) => [p.id, p.projectId, p.key]),
  define('resvary_price_versions', ['id', 'meter_id', 'version', 'created_at'], (p) => [
    p.id,
    p.meterId,
    p.version,
    p.createdAt,
  ]),
  define(
    'resvary_credit_reservations',
    [
      'id',
      'account_id',
      'project_id',
      'customer_id',
      'status',
      'reserved_units',
      'expires_at',
      'created_at',
    ],
    (p) => [
      p.id,
      p.accountId,
      p.projectId,
      p.customerId,
      p.status,
      p.reservedUnits,
      p.expiresAt,
      p.createdAt,
    ],
  ),
  define('resvary_usage_events', ['id', 'account_id', 'received_at'], (p) => [
    p.id,
    p.accountId,
    p.receivedAt,
  ]),
  define(
    'resvary_usage_receipts',
    ['id', 'account_id', 'reservation_id', 'usage_event_id', 'charged_units', 'created_at'],
    (p) => [p.id, p.accountId, p.reservationId, p.usageEventId, p.amountUnits, p.createdAt],
  ),
  define(
    'resvary_credit_lot_allocations',
    [
      'id',
      'reservation_id',
      'lot_id',
      'account_id',
      'allocated_units',
      'reserved_units',
      'consumed_units',
      'released_units',
      'expired_units',
      'created_at',
    ],
    (p) => [
      p.id,
      p.reservationId,
      p.lotId,
      p.accountId,
      p.allocatedUnits,
      p.reservedUnits,
      p.consumedUnits,
      p.releasedUnits,
      p.expiredUnits,
      p.createdAt,
    ],
  ),
  define(
    'resvary_grant_policy_applications',
    [
      'id',
      'policy_id',
      'account_id',
      'project_id',
      'customer_id',
      'policy_type',
      'period_key',
      'created_at',
    ],
    (p) => [
      p.id,
      p.policyId,
      p.accountId,
      p.projectId,
      p.customerId,
      p.policyType,
      p.periodKey,
      p.createdAt,
    ],
  ),
  define(
    'resvary_ledger_entries',
    ['id', 'account_id', 'delta_units', 'balance_after_units', 'created_at'],
    (p) => [p.id, p.accountId, p.deltaUnits, p.balanceAfterUnits, p.createdAt],
  ),
  define(
    'resvary_funding_intents',
    ['id', 'project_id', 'customer_id', 'status', 'requested_units', 'created_at'],
    (p) => [p.id, p.projectId, p.customerId, p.status, p.requestedUnits, p.createdAt],
  ),
  define(
    'resvary_funding_transactions',
    [
      'id',
      'funding_intent_id',
      'rail',
      'network',
      'external_payment_id_norm',
      'tx_hash_norm',
      'amount_units',
      'created_at',
    ],
    (p) => [
      p.id,
      p.fundingIntentId,
      p.rail,
      p.network,
      String(p.externalPaymentId).toLowerCase(),
      typeof p.txHash === 'string' ? p.txHash.toLowerCase() : null,
      p.amountUnits,
      p.createdAt,
    ],
  ),
  define('resvary_idempotency_keys', ['scope', 'key', 'created_at'], (p) => [
    p.scope,
    p.key,
    p.createdAt,
  ]),
  define(
    'resvary_outbox_events',
    [
      'id',
      'project_id',
      'type',
      'status',
      'created_at',
      'attempt_count',
      'next_attempt_at',
      'lease_owner',
      'lease_expires_at',
      'last_attempt_at',
      'last_error',
      'delivered_at',
    ],
    (p) => [
      p.id,
      p.projectId,
      p.type,
      p.status,
      p.createdAt,
      p.attemptCount ?? 0,
      p.nextAttemptAt ?? p.createdAt,
      p.leaseOwner ?? null,
      p.leaseExpiresAt ?? null,
      p.lastAttemptAt ?? null,
      p.lastError ?? null,
      p.deliveredAt ?? null,
    ],
  ),
  define('resvary_invoices', ['id', 'status', 'customer_id', 'amount_units', 'created_at'], (p) => [
    p.id,
    p.status,
    p.customerId ?? null,
    p.amountUnits,
    p.createdAt,
  ]),
  define(
    'resvary_receipts',
    ['id', 'invoice_id', 'tx_hash_norm', 'status', 'amount_units', 'created_at'],
    (p) => [
      p.id,
      p.invoiceId,
      typeof p.txHash === 'string' ? p.txHash.toLowerCase() : null,
      p.status,
      p.amountUnits,
      p.createdAt,
    ],
  ),
  define('arc_webhook_events', ['id', 'type', 'created_at'], (p) => [p.id, p.type, p.createdAt]),
  define(
    'arc_webhook_deliveries',
    ['id', 'event_id', 'event_type', 'attempt', 'status', 'received_at'],
    (p) => [p.id, p.eventId, p.eventType, p.attempt, p.status, p.receivedAt],
  ),
  define(
    'arc_watcher_cursors',
    ['key', 'network', 'invoice_id', 'memo_id_norm', 'next_from_block', 'updated_at'],
    (p) => [
      p.key,
      p.network,
      p.invoiceId ?? null,
      typeof p.memoId === 'string' ? p.memoId.toLowerCase() : null,
      String(p.nextFromBlock),
      p.updatedAt,
    ],
  ),
];

export async function importSqliteDatabase(
  config: SqliteImportConfig,
): Promise<SqliteImportReport> {
  const source = new DatabaseSync(config.sqlitePath, { readOnly: true });
  source.exec('BEGIN');
  const handle = createPostgresHandle(config);
  const client = await handle.pool.connect();
  try {
    const sqliteSchemaVersion = readSqliteSchemaVersion(source);
    if (sqliteSchemaVersion !== 5) {
      throw new Error(`Unsupported SQLite schema version ${sqliteSchemaVersion}; expected 5`);
    }
    const postgresSchemaVersion = await readPostgresSchemaVersion(client, handle.schema);
    if (postgresSchemaVersion !== POSTGRES_SCHEMA_VERSION) {
      throw new Error(
        `Postgres schema version ${postgresSchemaVersion}; run resvary-postgres migrate first`,
      );
    }
    const available = sourceTables(source);
    await assertTargetEmpty(client, handle.schema);
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const counts: Record<string, number> = {};
    for (const definition of TABLES) {
      if (!available.has(definition.name)) {
        counts[definition.name] = 0;
        continue;
      }
      const rows = source.prepare(`SELECT payload FROM ${definition.name}`).all() as SourceRow[];
      for (const row of rows) {
        const payload = parseReceiptStoreValue<JsonRecord>(row.payload);
        const columns = [...definition.columns, 'payload'];
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        await client.query(
          `INSERT INTO ${table({ schema: handle.schema }, definition.name)} (${columns.join(', ')}) VALUES (${placeholders})`,
          [...definition.values(payload), row.payload],
        );
      }
      counts[definition.name] = rows.length;
    }
    const report = await buildReport(
      source,
      client,
      handle.schema,
      sqliteSchemaVersion,
      postgresSchemaVersion,
      counts,
      Boolean(config.dryRun),
    );
    if (
      report.contentMismatches.length > 0 ||
      report.balanceMismatches.length > 0 ||
      report.ledgerMismatches.length > 0 ||
      report.allocationMismatches.length > 0
    ) {
      throw new Error(
        `Import verification failed: ${[
          ...report.contentMismatches.map((name) => `content:${name}`),
          ...report.balanceMismatches.map((id) => `balance:${id}`),
          ...report.ledgerMismatches.map((key) => `ledger:${key}`),
          ...report.allocationMismatches.map((key) => `allocation:${key}`),
        ].join(', ')}`,
      );
    }
    if (report.sourceOpenReservations !== report.targetOpenReservations) {
      throw new Error(
        `Open reservation mismatch: source=${report.sourceOpenReservations} target=${report.targetOpenReservations}`,
      );
    }
    if (config.dryRun) await client.query('ROLLBACK');
    else await client.query('COMMIT');
    return { ...report, committed: !config.dryRun };
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    source.exec('ROLLBACK');
    source.close();
    client.release();
    if (handle.ownsPool) await handle.pool.end();
  }
}

export async function verifySqliteImport(config: SqliteImportConfig): Promise<SqliteImportReport> {
  const source = new DatabaseSync(config.sqlitePath, { readOnly: true });
  source.exec('BEGIN');
  const handle = createPostgresHandle(config);
  const client = await handle.pool.connect();
  try {
    const sqliteSchemaVersion = readSqliteSchemaVersion(source);
    const postgresSchemaVersion = await readPostgresSchemaVersion(client, handle.schema);
    if (sqliteSchemaVersion !== 5) {
      throw new Error(`Unsupported SQLite schema version ${sqliteSchemaVersion}; expected 5`);
    }
    if (postgresSchemaVersion !== POSTGRES_SCHEMA_VERSION) {
      throw new Error(
        `Postgres schema version ${postgresSchemaVersion}; run resvary-postgres migrate first`,
      );
    }
    const available = sourceTables(source);
    const counts: Record<string, number> = {};
    for (const definition of TABLES) {
      counts[definition.name] = available.has(definition.name)
        ? (
            source.prepare(`SELECT COUNT(*) AS count FROM ${definition.name}`).get() as {
              count: number;
            }
          ).count
        : 0;
    }
    const report = await buildReport(
      source,
      client,
      handle.schema,
      sqliteSchemaVersion,
      postgresSchemaVersion,
      counts,
      false,
    );
    return report;
  } finally {
    source.exec('ROLLBACK');
    source.close();
    client.release();
    if (handle.ownsPool) await handle.pool.end();
  }
}

function define(
  name: string,
  columns: string[],
  values: (payload: JsonRecord) => unknown[],
): TableDefinition {
  return { name, columns, values };
}

function readSqliteSchemaVersion(db: DatabaseSync): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM resvary_schema_migrations')
    .get() as { version: number };
  return Number(row.version);
}

async function readPostgresSchemaVersion(client: PoolClient, schema: string): Promise<number> {
  const result = await client.query<{ version: number }>(
    `SELECT version FROM ${table({ schema }, 'resvary_schema_migrations')} ORDER BY version ASC`,
  );
  const versions = result.rows.map((row) => row.version);
  for (let index = 0; index < versions.length; index += 1) {
    if (versions[index] !== index + 1) {
      throw new Error(
        `Invalid Postgres migration history: expected version ${index + 1}, found ${versions[index]}`,
      );
    }
  }
  return versions.at(-1) ?? 0;
}

function sourceTables(db: DatabaseSync): Set<string> {
  return new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
}

async function assertTargetEmpty(client: PoolClient, schema: string): Promise<void> {
  for (const definition of TABLES) {
    const result = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM ${table({ schema }, definition.name)} LIMIT 1) AS exists`,
    );
    if (result.rows[0]?.exists) throw new Error(`Target table is not empty: ${definition.name}`);
  }
}

async function buildReport(
  source: DatabaseSync,
  client: PoolClient,
  schema: string,
  sqliteSchemaVersion: number,
  postgresSchemaVersion: number,
  sourceCounts: Record<string, number>,
  dryRun: boolean,
): Promise<SqliteImportReport> {
  const contentMismatches: string[] = [];
  for (const definition of TABLES) {
    const result = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ${table({ schema }, definition.name)}`,
    );
    if ((result.rows[0]?.count ?? 0) !== sourceCounts[definition.name]) {
      throw new Error(
        `Count mismatch for ${definition.name}: source=${sourceCounts[definition.name]} target=${result.rows[0]?.count ?? 0}`,
      );
    }
    const sourcePayloads = sourceTables(source).has(definition.name)
      ? (source.prepare(`SELECT payload FROM ${definition.name}`).all() as SourceRow[]).map((row) =>
          canonicalPayload(row.payload),
        )
      : [];
    const targetPayloads = (
      await client.query<{ payload: string }>(
        `SELECT payload::text AS payload FROM ${table({ schema }, definition.name)}`,
      )
    ).rows.map((row) => canonicalPayload(row.payload));
    sourcePayloads.sort();
    targetPayloads.sort();
    if (
      sourcePayloads.length !== targetPayloads.length ||
      sourcePayloads.some((payload, index) => payload !== targetPayloads[index])
    ) {
      contentMismatches.push(definition.name);
    }
  }
  const balanceMismatches: string[] = [];
  const ledgerMismatches: string[] = [];
  const allocationMismatches: string[] = [];
  if (sourceTables(source).has('resvary_credit_accounts')) {
    const rows = source.prepare('SELECT payload FROM resvary_credit_accounts').all() as SourceRow[];
    for (const row of rows) {
      const account = parseReceiptStoreValue<JsonRecord>(row.payload);
      const result = await client.query<{ posted_units: string; reserved_units: string }>(
        `SELECT posted_units::text, reserved_units::text FROM ${table({ schema }, 'resvary_credit_accounts')} WHERE id = $1`,
        [account.id],
      );
      const target = result.rows[0];
      if (
        !target ||
        target.posted_units !== account.postedUnits ||
        target.reserved_units !== account.reservedUnits
      ) {
        balanceMismatches.push(String(account.id));
      }
    }
  }
  const sourceLedger = new Map<string, bigint>();
  if (sourceTables(source).has('resvary_ledger_entries')) {
    const rows = source.prepare('SELECT payload FROM resvary_ledger_entries').all() as SourceRow[];
    for (const row of rows) {
      const entry = parseReceiptStoreValue<JsonRecord>(row.payload);
      const key = `${String(entry.accountId)}:${String(entry.bucket)}`;
      sourceLedger.set(key, (sourceLedger.get(key) ?? 0n) + BigInt(String(entry.deltaUnits)));
    }
  }
  const targetLedgerResult = await client.query<{
    account_id: string;
    bucket: string;
    total: string;
  }>(
    `SELECT account_id, payload->>'bucket' AS bucket, SUM(delta_units)::text AS total
     FROM ${table({ schema }, 'resvary_ledger_entries')}
     GROUP BY account_id, payload->>'bucket'`,
  );
  const targetLedger = new Map(
    targetLedgerResult.rows.map((row) => [`${row.account_id}:${row.bucket}`, BigInt(row.total)]),
  );
  for (const key of new Set([...sourceLedger.keys(), ...targetLedger.keys()])) {
    if ((sourceLedger.get(key) ?? 0n) !== (targetLedger.get(key) ?? 0n)) ledgerMismatches.push(key);
  }
  let sourceOpenReservations = 0;
  if (sourceTables(source).has('resvary_credit_reservations')) {
    const rows = source
      .prepare('SELECT payload FROM resvary_credit_reservations')
      .all() as SourceRow[];
    sourceOpenReservations = rows.filter(
      (row) => parseReceiptStoreValue<JsonRecord>(row.payload).status === 'open',
    ).length;
  }
  const openResult = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM ${table({ schema }, 'resvary_credit_reservations')} WHERE status = 'open'`,
  );
  const targetOpenReservations = openResult.rows[0]?.count ?? 0;

  const accountLotResult = await client.query<{
    account_id: string;
    posted_units: string;
    reserved_units: string;
    lot_posted_units: string;
    lot_reserved_units: string;
  }>(
    `SELECT account.id AS account_id,
       account.posted_units::text, account.reserved_units::text,
       COALESCE(SUM(lot.available_units + lot.reserved_units), 0)::text AS lot_posted_units,
       COALESCE(SUM(lot.reserved_units), 0)::text AS lot_reserved_units
     FROM ${table({ schema }, 'resvary_credit_accounts')} account
     LEFT JOIN ${table({ schema }, 'resvary_credit_lots')} lot ON lot.account_id = account.id
     GROUP BY account.id, account.posted_units, account.reserved_units`,
  );
  for (const row of accountLotResult.rows) {
    if (
      BigInt(row.posted_units) !== BigInt(row.lot_posted_units) ||
      BigInt(row.reserved_units) !== BigInt(row.lot_reserved_units)
    ) {
      allocationMismatches.push(`account:${row.account_id}`);
    }
  }
  const reservationAllocationResult = await client.query<{
    reservation_id: string;
    reserved_units: string;
    allocation_units: string;
  }>(
    `SELECT reservation.id AS reservation_id, reservation.reserved_units::text,
       COALESCE(SUM(allocation.reserved_units), 0)::text AS allocation_units
     FROM ${table({ schema }, 'resvary_credit_reservations')} reservation
     LEFT JOIN ${table({ schema }, 'resvary_credit_lot_allocations')} allocation
       ON allocation.reservation_id = reservation.id
     WHERE reservation.status = 'open'
     GROUP BY reservation.id, reservation.reserved_units`,
  );
  for (const row of reservationAllocationResult.rows) {
    if (BigInt(row.reserved_units) !== BigInt(row.allocation_units)) {
      allocationMismatches.push(`reservation:${row.reservation_id}`);
    }
  }
  return {
    sqliteSchemaVersion,
    postgresSchemaVersion,
    dryRun,
    committed: false,
    counts: sourceCounts,
    contentMismatches,
    balanceMismatches,
    ledgerMismatches,
    allocationMismatches,
    sourceOpenReservations,
    targetOpenReservations,
  };
}

function canonicalPayload(payload: string): string {
  return JSON.stringify(canonicalize(parseReceiptStoreValue<unknown>(payload)));
}

function canonicalize(value: unknown): unknown {
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}
