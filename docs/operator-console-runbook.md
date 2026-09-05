# Operator Console production runbook

## Deployment order

1. Announce a short writer outage and stop application and outbox-worker writes.
2. Back up the database and restore that backup into a disposable environment.
3. Apply PostgreSQL schema v4 with the migration CLI. SQLite migrates to v6 when the 1.0 store first opens.
4. Deploy the application and workers.
5. Deploy one console instance with one `RESVARY_PROJECT_ID`.
6. Verify `/api/health`, project isolation, a known charge drill-down, and one idempotent staging action.
7. Reopen traffic and watch database errors, overdue reservations, outbox backlog, and reconciliation counts.

Pin production deployments to the image digest reported by the release workflow, not to a mutable tag.

## Backup

PostgreSQL:

```bash
pg_dump --format=custom --file=resvary-before-1.0.dump "$DATABASE_URL"
createdb resvary_restore_test
pg_restore --clean --if-exists --dbname=resvary_restore_test resvary-before-1.0.dump
```

For SQLite, stop every writer and use SQLite's `.backup` command, or checkpoint WAL before copying the database. Preserve file ownership and permissions.

Record the backup location, schema version, application commit, image digest, project ID, and UTC time in the deployment ticket. Never record the admin secret.

## Rollback

1. Stop all 1.0 writers and the console.
2. Preserve the failed database for diagnosis.
3. Restore the pre-migration backup into a clean database or replace the stopped SQLite database with its v5 backup.
4. Start the 0.8 application and workers against the restored database.
5. Verify balances, open reservations, receipt lookup, and outbox processing before reopening traffic.

Do not attempt an in-place downgrade by deleting normalized columns, operator actions, or schema metadata.

## Secret rotation

Replace `RESVARY_CONSOLE_ADMIN_SECRET` with a new random value of at least 32 characters and restart the instance. Existing session cookies fail verification immediately because their secret fingerprint and signature no longer match. Verify the old secret is rejected and the new secret creates a secure cookie. Rotate the secret after suspected disclosure or operator offboarding.

## Operational recovery

- **Overdue reservations:** inspect the customer and reservation timestamps, then run the expiry sweep. The command only releases records already overdue at the supplied cutoff.
- **Dead-letter event:** inspect attempts and payload, correct the receiver, then requeue that exact event. Pending or delivered events are rejected.
- **Balance correction:** enter a signed amount and a reason that identifies the incident or ticket. Confirm the preview before submission.
- **Manual credit:** use a positive amount. Negative grants are rejected; use an adjustment for a correction.

Reuse the same displayed action UUID when a request times out and its outcome is unknown. A new UUID represents a new command and may cause a second valid mutation.

## Incident evidence

Capture the operator action UUID, project ID, target ID, UTC time, result status, and linked receipt/reservation/ledger identifiers. Do not paste the admin secret or raw customer payload into tickets or logs.
