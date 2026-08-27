# Migrate from 0.4 to 0.5

Back up the SQLite file before upgrading. The importer is offline: stop every 0.4 process that can write to the file before starting the cutover.

The SQLite import command requires Node.js 24 because it opens the source through the built-in `node:sqlite` module. Normal Postgres stores and workers support Node.js 20+.

## Cutover

1. Provision PostgreSQL and install the 0.5 packages.
2. Apply the target schema.
3. Stop all application, Arc watcher, and webhook processes using SQLite.
4. Run a dry import and inspect the JSON report.
5. Run the committed import, then verify it independently.
6. Point one application process at Postgres and run balance, reservation, receipt, and funding smoke tests.
7. Start additional application replicas and outbox workers.

```bash
resvary-postgres migrate
resvary-postgres import-sqlite --sqlite .resvary/resvary.sqlite --dry-run
resvary-postgres import-sqlite --sqlite .resvary/resvary.sqlite
resvary-postgres verify-import --sqlite .resvary/resvary.sqlite
```

The target entity tables must be empty. Import preserves IDs, timestamps, idempotency results, funding uniqueness, webhook records, and watcher cursors. The command compares entity counts and each account's posted and reserved units before commit.

## Rollback boundary

Before the first Postgres write, rollback means pointing the application back to the backed-up SQLite file. After Postgres accepts new writes there is no automatic reverse synchronization. Stop writes and reconcile explicitly instead of switching back to stale SQLite data.

SQLite remains supported for local and single-node use. Opening a 0.4 credit database with `@resvary/sqlite` 0.5 applies schema v3 for durable outbox state and schema v4 for transaction-hash funding uniqueness. If an existing database contains duplicate funding transaction hashes on the same network, reconcile those records before opening it with the new version.
