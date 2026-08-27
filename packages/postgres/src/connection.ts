import { Pool, type PoolClient, type PoolConfig } from 'pg';

export interface PostgresConnectionConfig {
  connectionString?: string;
  pool?: Pool;
  schema?: string;
  maxTransactionRetries?: number;
  poolConfig?: Omit<PoolConfig, 'connectionString'>;
}

export interface PostgresHandle {
  pool: Pool;
  schema: string;
  ownsPool: boolean;
  maxTransactionRetries: number;
}

export function createPostgresHandle(config: PostgresConnectionConfig): PostgresHandle {
  if (config.pool && config.connectionString) {
    throw new Error('Provide either pool or connectionString, not both');
  }
  if (config.pool && config.poolConfig) {
    throw new Error('poolConfig cannot be used with an existing pool');
  }
  if (!config.pool && !config.connectionString) {
    throw new Error('Postgres connectionString or pool is required');
  }
  const maxTransactionRetries = config.maxTransactionRetries ?? 5;
  if (!Number.isInteger(maxTransactionRetries) || maxTransactionRetries < 0) {
    throw new Error('maxTransactionRetries must be a non-negative integer');
  }
  const schema = config.schema ?? 'public';
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new Error(`Invalid Postgres schema: ${schema}`);
  }
  return {
    pool:
      config.pool ?? new Pool({ ...config.poolConfig, connectionString: config.connectionString }),
    schema,
    ownsPool: !config.pool,
    maxTransactionRetries,
  };
}

export function table(handle: Pick<PostgresHandle, 'schema'>, name: string): string {
  return `"${handle.schema}"."${name}"`;
}

export function isRetryableTransactionError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = (error as { code?: string }).code;
  return code === '40001' || code === '40P01' || code === '23505';
}

export async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original transaction error.
  }
}
