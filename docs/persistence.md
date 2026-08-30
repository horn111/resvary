# Persistence

Resvary provides in-memory, SQLite, and Postgres persistence behind the same domain interfaces.

```typescript
import { CreditLedger } from '@resvary/sdk/credits';
import { createSqliteCreditStore } from '@resvary/sqlite';

const store = createSqliteCreditStore({ path: '.resvary/resvary.sqlite' });
const credits = new CreditLedger({ projectId: 'my_ai_product', store });
```

New SQLite directories and database files are owner-only on POSIX (`0700` and `0600`).
WAL and shared-memory companions are hardened to `0600` as well. On Windows, use a dedicated
service account and apply restrictive NTFS ACLs to the database directory.

The credit schema stores accounts, grants, policies, credit lots, reservation allocations, policy applications, meters, price versions, reservations, usage events, usage receipts, ledger entries, funding records, idempotency records, and outbox events. SQLite schema v3 adds retry, lease, and dead-letter state. Schema v4 enforces one funding grant per network transaction hash across every funding rail. Schema v5 adds policies and lots, and automatically backfills existing balances and open reservations.

SQLite writes use WAL mode, a five-second busy timeout, and `BEGIN IMMEDIATE`. A failed command rolls back all balance, receipt, outbox, and idempotency writes.

Receipt operations use the optional `TransactionalReceiptStore` contract when a backend provides it. The bundled in-memory, SQLite, and Postgres stores commit invoice state, receipts, and webhook events atomically. Third-party `ReceiptStore` implementations remain source-compatible, but must implement that optional contract to receive the same atomicity guarantee.

The existing `createSqliteReceiptStore` remains available for invoices, payment receipts, webhook delivery attempts, and watcher cursors. No old table is renamed or removed.

Requirements:

- Node.js 24+;
- local filesystem access;
- one application node.

Call `store.close()` during graceful shutdown. Use the in-memory store for tests that do not need restart behavior.

## Postgres

`@resvary/postgres` implements `CreditPolicyStore` and `ReceiptStore`. Credit commands use `SERIALIZABLE` transactions with bounded retry. Outbox claims use `FOR UPDATE SKIP LOCKED`, so multiple workers may consume one database without sharing a process lock. PostgreSQL schema v3 adds policies, lots, allocations, and guarded legacy backfill.

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
