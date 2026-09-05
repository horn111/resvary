import 'server-only';
import { existsSync } from 'node:fs';
import { CreditLedger } from '@resvary/sdk/credits';
import { OperatorService, type AdminQueryStore } from '@resvary/sdk/admin';
import {
  createPostgresAdminStore,
  createPostgresCreditStore,
  getPostgresMigrationStatus,
  POSTGRES_SCHEMA_VERSION,
} from '@resvary/postgres';
import {
  createSqliteAdminStore,
  createSqliteCreditStore,
  SQLITE_SCHEMA_VERSION,
} from '@resvary/sqlite';
import type { CreditStore, OutboxDeliveryStore } from '@resvary/sdk/credits';
import { getConsoleConfig } from './config';

type Runtime = {
  config: ReturnType<typeof getConsoleConfig>;
  admin: AdminQueryStore;
  operator: OperatorService;
  store: CreditStore & OutboxDeliveryStore;
  database: 'SQLite' | 'Postgres';
  schemaVersion: number;
  close(): Promise<void>;
};

let runtimePromise: Promise<Runtime> | undefined;

export function getRuntime(): Promise<Runtime> {
  runtimePromise ??= createRuntime();
  return runtimePromise;
}

async function createRuntime(): Promise<Runtime> {
  const config = getConsoleConfig();
  if (config.backend.kind === 'sqlite') {
    if (config.demoMode && !existsSync(config.backend.path)) {
      throw new Error(`Bundled demo fixture is missing: ${config.backend.path}`);
    }
    const store = createSqliteCreditStore({ path: config.backend.path });
    const admin = createSqliteAdminStore({ path: config.backend.path });
    const ledger = new CreditLedger({ projectId: config.projectId, store });
    return {
      config,
      admin,
      operator: new OperatorService({
        projectId: config.projectId,
        ledger,
        adminStore: admin,
        deliveryStore: store,
      }),
      store,
      database: 'SQLite',
      schemaVersion: SQLITE_SCHEMA_VERSION,
      async close() {
        admin.close();
        store.close();
      },
    };
  }

  const connection = { connectionString: config.backend.connectionString };
  const migration = await getPostgresMigrationStatus(connection);
  if (migration.currentVersion !== POSTGRES_SCHEMA_VERSION) {
    throw new Error(
      `Postgres schema ${migration.currentVersion} is incompatible; run resvary-postgres migrate for schema ${POSTGRES_SCHEMA_VERSION}`,
    );
  }
  const store = createPostgresCreditStore(connection);
  const admin = createPostgresAdminStore(connection);
  const ledger = new CreditLedger({ projectId: config.projectId, store });
  return {
    config,
    admin,
    operator: new OperatorService({
      projectId: config.projectId,
      ledger,
      adminStore: admin,
      deliveryStore: store,
    }),
    store,
    database: 'Postgres',
    schemaVersion: POSTGRES_SCHEMA_VERSION,
    async close() {
      await admin.close();
      await store.close();
    },
  };
}
