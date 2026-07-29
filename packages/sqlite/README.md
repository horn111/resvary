# @settlary/sqlite

Optional SQLite receipt store for `settlary`.

```ts
import { PersistentReceiptLedger } from '@settlary/sdk/receipts';
import { createSqliteReceiptStore } from '@settlary/sqlite';

const store = createSqliteReceiptStore({
  path: '.settlary/receipts.sqlite',
});

const ledger = new PersistentReceiptLedger({ store });
```

This package stores invoices, receipts, webhook events, webhook delivery attempts, and watcher cursors.

## Requirements

- Node 24+
- Local filesystem access

The package uses Node's built-in `node:sqlite` module. It is optional so the core SDK remains free of SQLite runtime requirements.
