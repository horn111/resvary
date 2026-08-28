# @resvary/postgres

Postgres `CreditStore` and `ReceiptStore` implementations for Resvary multi-process deployments. Resvary supports PostgreSQL 16–18. Stores never migrate automatically.

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

Credit transactions and bundled receipt ledger operations run at `SERIALIZABLE` isolation with bounded retry. Schema v2 adds database checks, foreign keys, and transaction-hash uniqueness. Apply migrations before starting application or worker processes.

CLI commands:

```text
resvary-postgres status
resvary-postgres migrate
resvary-postgres import-sqlite --sqlite .resvary/resvary.sqlite --dry-run
resvary-postgres import-sqlite --sqlite .resvary/resvary.sqlite
resvary-postgres verify-import --sqlite .resvary/resvary.sqlite
```

SQLite import requires Node.js 24. Stop every writer before importing. Verification compares entity payloads, balances, ledger totals, and open reservations.
