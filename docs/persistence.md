# Persistence

`@settlary/sqlite` provides independent credit and payment receipt stores that may share one database file.

```typescript
import { CreditLedger } from '@settlary/sdk/credits';
import { createSqliteCreditStore } from '@settlary/sqlite';

const store = createSqliteCreditStore({ path: '.settlary/settlary.sqlite' });
const credits = new CreditLedger({ projectId: 'my_ai_product', store });
```

The credit schema stores accounts, grants, meters, price versions, reservations, usage events, usage receipts, ledger entries, funding records, idempotency records, and outbox events. Schema version `1` is recorded in `settlary_schema_migrations`.

SQLite writes use WAL mode, a five-second busy timeout, and `BEGIN IMMEDIATE`. A failed command rolls back all balance, receipt, outbox, and idempotency writes.

The existing `createSqliteReceiptStore` remains available for invoices, payment receipts, webhook delivery attempts, and watcher cursors. No old table is renamed or removed.

Requirements:

- Node.js 24+;
- local filesystem access;
- one application node for the alpha.

Call `store.close()` during graceful shutdown. Use the in-memory store for tests that do not need restart behavior.
