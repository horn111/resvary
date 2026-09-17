import { createPostgresHandle, table, type PostgresConnectionConfig } from './connection.js';
import { POSTGRES_SCHEMA_VERSION } from './migrations.js';

export interface PostgresHealth {
  ok: boolean;
  latencyMs: number;
  schema: string;
  schemaVersion: number;
  latestSchemaVersion: number;
  pendingOutboxEvents: number;
  deadLetterEvents: number;
  oldestPendingOutboxAgeMs: number;
  overdueReservations: number;
  reconciliationRequiredFunding: number;
  error?: string;
}

export async function checkPostgresHealth(
  config: PostgresConnectionConfig,
): Promise<PostgresHealth> {
  const handle = createPostgresHandle(config);
  const startedAt = Date.now();
  try {
    const now = Date.now();
    await handle.pool.query('SELECT 1');
    const version = await handle.pool.query<{ version: number }>(
      `SELECT version FROM ${table(handle, 'resvary_schema_migrations')} ORDER BY version ASC`,
    );
    const outbox = await handle.pool.query<{ status: string; count: string; oldest: string }>(
      `SELECT status, COUNT(*)::text AS count, MIN(created_at)::text AS oldest
       FROM ${table(handle, 'resvary_outbox_events')}
       WHERE status IN ('pending', 'dead_letter') GROUP BY status`,
    );
    const counts = new Map(outbox.rows.map((row) => [row.status, Number(row.count)]));
    const oldestPending = outbox.rows.find((row) => row.status === 'pending')?.oldest;
    const operational = await handle.pool.query<{
      overdue_reservations: string;
      reconciliation_required: string;
    }>(
      `SELECT
         (SELECT COUNT(*)::text FROM ${table(handle, 'resvary_credit_reservations')}
          WHERE status = 'open' AND expires_at <= $1) AS overdue_reservations,
         (SELECT COUNT(*)::text FROM ${table(handle, 'resvary_funding_transactions')}
          WHERE settlement_status = 'reconciliation_required') AS reconciliation_required`,
      [now],
    );
    const appliedVersions = version.rows.map((row) => row.version);
    const schemaVersion = appliedVersions.at(-1) ?? 0;
    const migrationHistoryValid = appliedVersions.every(
      (appliedVersion, index) => appliedVersion === index + 1,
    );
    return {
      ok: migrationHistoryValid && schemaVersion === POSTGRES_SCHEMA_VERSION,
      latencyMs: Date.now() - startedAt,
      schema: handle.schema,
      schemaVersion,
      latestSchemaVersion: POSTGRES_SCHEMA_VERSION,
      pendingOutboxEvents: counts.get('pending') ?? 0,
      deadLetterEvents: counts.get('dead_letter') ?? 0,
      oldestPendingOutboxAgeMs: oldestPending ? Math.max(0, now - Number(oldestPending)) : 0,
      overdueReservations: Number(operational.rows[0]?.overdue_reservations ?? 0),
      reconciliationRequiredFunding: Number(operational.rows[0]?.reconciliation_required ?? 0),
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      schema: handle.schema,
      schemaVersion: 0,
      latestSchemaVersion: POSTGRES_SCHEMA_VERSION,
      pendingOutboxEvents: 0,
      deadLetterEvents: 0,
      oldestPendingOutboxAgeMs: 0,
      overdueReservations: 0,
      reconciliationRequiredFunding: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (handle.ownsPool) await handle.pool.end();
  }
}
