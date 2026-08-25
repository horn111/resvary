# Persistence

Resvary provides in-memory, SQLite, and Postgres persistence behind the same domain interfaces.

```typescript
import { CreditLedger } from '@resvary/sdk/credits';
import { createSqliteCreditStore } from '@resvary/sqlite';

const store = createSqliteCreditStore({ path: '.resvary/resvary.sqlite' });
const credits = new CreditLedger({ projectId: 'my_ai_product', store });
```

The credit schema stores accounts, grants, meters, price versions, reservations, usage events, usage receipts, ledger entries, funding records, idempotency records, and outbox events. SQLite schema v3 adds retry, lease, and dead-letter state.

SQLite writes use WAL mode, a five-second busy timeout, and `BEGIN IMMEDIATE`. A failed command rolls back all balance, receipt, outbox, and idempotency writes.

The existing `createSqliteReceiptStore` remains available for invoices, payment receipts, webhook delivery attempts, and watcher cursors. No old table is renamed or removed.

Requirements:

- Node.js 24+;
- local filesystem access;
- one application node for the alpha.

Call `store.close()` during graceful shutdown. Use the in-memory store for tests that do not need restart behavior.

## Postgres

`@resvary/postgres` implements both `CreditStore` and `ReceiptStore`. Credit commands use `SERIALIZABLE` transactions with bounded retry. Outbox claims use `FOR UPDATE SKIP LOCKED`, so multiple workers may consume one database without sharing a process lock.

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/resvary \
  npx resvary-postgres migrate
```

```typescript
import { createPostgresCreditStore } from '@resvary/postgres';

const store = createPostgresCreditStore({
  connectionString: process.env.DATABASE_URL,
  schema: 'public',
});
```

Passing a `pg.Pool` leaves pool shutdown to the caller. Passing a connection string makes the store own the pool; call `await store.close()` during graceful shutdown. Store construction never applies migrations.
