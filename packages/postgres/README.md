# @resvary/postgres

Postgres `CreditPolicyStore` and `ReceiptStore` implementations for Resvary multi-process deployments. Resvary supports PostgreSQL 16–18. Stores never migrate automatically.

```bash
npm install @resvary/sdk @resvary/postgres
DATABASE_URL=postgres://... npx resvary-postgres migrate
```

```ts
import { createPostgresCreditStore } from '@resvary/postgres';

const store = createPostgresCreditStore({ connectionString: process.env.DATABASE_URL! });
// Use store with CreditLedger, then close the owned pool during shutdown.
await store.close();
```

Pass either `connectionString` or an existing `pg.Pool`. A store created from a connection string owns and closes its pool. A store given a pool never closes it.

Credit transactions and bundled receipt ledger operations run at `SERIALIZABLE` isolation with bounded retry. Schema v3 adds grant policies, credit lots, reservation allocations, and guarded legacy backfill. Apply migrations before starting application or worker processes.

Resvary 0.8 keeps schema v3. Graduated/package price definitions and their receipt line items use
the existing JSONB payloads, so upgrading from 0.7 requires no database migration.

CLI commands:

```text
resvary-postgres status
resvary-postgres migrate
resvary-postgres import-sqlite --sqlite .resvary/resvary.sqlite --dry-run
resvary-postgres import-sqlite --sqlite .resvary/resvary.sqlite
resvary-postgres verify-import --sqlite .resvary/resvary.sqlite
```

SQLite import requires Node.js 24 and SQLite schema v5. Stop every writer before importing. Verification compares entity payloads, balances, ledger totals, lots, allocations, and open reservations.
