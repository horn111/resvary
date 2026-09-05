# Migrate from 0.8 to 1.0

Resvary moves directly from 0.8 to 1.0. There is no 0.9 release. Existing credit, pricing, funding, receipt, and webhook APIs keep their names and behavior; 1.0 adds optional admin query contracts and the Operator Console.

The database migration normalizes project, customer, type, status, and query columns used by the console, creates timeline indexes, and adds the append-only operator action journal. Backfill validates relationships before writing. It stops on orphaned records or project/customer mismatches instead of assigning uncertain ownership.

## Before the migration

1. Upgrade a staging copy first.
2. Stop application and worker writes during the migration.
3. Take a restorable database backup.
4. Record the current schema status and keep the 0.8 application artifact available.
5. Test the manual drill-down: customer balance → ledger entry → usage receipt → reservation → price version.

Do not treat a successful DDL command as a complete backup test. Restore the backup into a disposable database and run the 0.8 service against it.

## SQLite: schema v6

SQLite remains a local and single-node backend. Opening a v5 database with `@resvary/sqlite` 1.0 applies schema v6 automatically in one migration transaction.

Stop all processes before copying a SQLite file. If the database uses WAL mode, checkpoint it or use SQLite's online backup command so the backup includes committed WAL contents. Keep the original v5 file unchanged until verification completes.

After the first 1.0 startup, verify:

- schema version is 6;
- account, grant, reservation, receipt, ledger, funding, and outbox counts match the pre-migration snapshot;
- open reservation totals still match account reserved balances;
- a known receipt resolves to its reservation, price version, and ledger entries;
- the console only returns the configured project.

Schema v6 is not opened by Resvary 0.8. To roll back, stop 1.0 and restore the v5 backup; do not delete v6 columns or lower the recorded version manually.

## PostgreSQL: schema v4

PostgreSQL migration is explicit. The console never runs it and refuses to start against any version other than v4.

```bash
pg_dump --format=custom --file=resvary-before-1.0.dump "$DATABASE_URL"
DATABASE_URL="$DATABASE_URL" npx resvary-postgres status
DATABASE_URL="$DATABASE_URL" npx resvary-postgres migrate
DATABASE_URL="$DATABASE_URL" npx resvary-postgres status
```

The final status must report schema version 4. Apply the migration before deploying 1.0 application, worker, or console processes. Keep the writer outage in place if the backfill aborts; inspect the reported orphan or mismatch and correct the source data deliberately before retrying. The migration is safe to rerun after an interrupted attempt.

For rollback, stop every 1.0 writer and restore the pre-migration dump into a clean database. Do not run a 0.8 process against a schema it does not recognize.

## Application compatibility

- `CreditStore` is unchanged. Custom stores do not need to implement admin queries.
- `AdminQueryStore`, `AdminPage<T>`, `AuditItem`, `OperatorAction`, and `OperatorService` live under `@resvary/sdk/admin`.
- SQLite and PostgreSQL admin implementations are optional subpath exports.
- Cursor values are opaque. Persist the complete value and never parse or manufacture it in an application.
- Console HTTP routes are not a supported public API.

## Cutover verification

Before reopening writes:

1. Run the existing build, typecheck, and test gates.
2. Start the console with one project ID and verify that a different project's customer ID returns no result.
3. Explain one known charge through its receipt, reservation, price, and ledger entries.
4. Exercise a grant or adjustment in staging, retry it with the same UUID, and confirm a single balance change.
5. Confirm that only overdue reservations can be swept and only dead-letter events can be requeued.
6. Run the Docker health check and review the image scan result.

The production backup and rollback sequence is detailed in [Operator Console runbook](operator-console-runbook.md).
