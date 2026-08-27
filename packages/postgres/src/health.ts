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
  error?: string;
}

export async function checkPostgresHealth(
  config: PostgresConnectionConfig,
): Promise<PostgresHealth> {
  const handle = createPostgresHandle(config);
  const startedAt = Date.now();
  try {
    await handle.pool.query('SELECT 1');
    const version = await handle.pool.query<{ version: number }>(
      `SELECT version FROM ${table(handle, 'resvary_schema_migrations')} ORDER BY version ASC`,
    );
    const outbox = await handle.pool.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text AS count FROM ${table(handle, 'resvary_outbox_events')}
       WHERE status IN ('pending', 'dead_letter') GROUP BY status`,
    );
    const counts = new Map(outbox.rows.map((row) => [row.status, Number(row.count)]));
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
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (handle.ownsPool) await handle.pool.end();
  }
}
