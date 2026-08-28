# @resvary/sqlite

SQLite persistence for Resvary credits, usage receipts, and stablecoin payment receipts.

```typescript
import { CreditLedger } from '@resvary/sdk/credits';
import { createSqliteCreditStore } from '@resvary/sqlite';

const store = createSqliteCreditStore({ path: '.resvary/resvary.sqlite' });
const credits = new CreditLedger({ projectId: 'my_ai_product', store });
```

On POSIX systems, newly created database directories use mode `0700`, while the database,
WAL, and shared-memory files use mode `0600`. On Windows, run the process under a dedicated
service account and restrict the database directory with NTFS ACLs.

The existing `createSqliteReceiptStore` remains available for payment invoices, receipts, webhook deliveries, and Arc watcher cursors. Both stores can use the same file.

Requires Node.js 24+ and local filesystem access. The credit store uses WAL, `BEGIN IMMEDIATE`, rollback-safe writes, and versioned schema metadata.
