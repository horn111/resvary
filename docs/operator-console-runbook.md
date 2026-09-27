# Operator Console production runbook

## Deployment order

1. Announce a short writer outage and stop application and outbox-worker writes.
2. Back up the database and restore that backup into a disposable environment.
3. For the unreleased 1.3 build, apply PostgreSQL schema v6 with the migration CLI. SQLite migrates to v8 when the store first opens. See [migration notes](migration-1.3.md) for transition-event compatibility and retention.
4. Deploy the application and workers.
5. Deploy one console instance with one `RESVARY_PROJECT_ID`.
6. Verify `/api/health`, project isolation, a known charge drill-down, and one idempotent staging action.
7. Reopen traffic and watch database errors, overdue reservations, outbox backlog, and reconciliation counts.

Pin production deployments to the image digest reported by the release workflow, not to a mutable tag.

## Backup

PostgreSQL:

```bash
pg_dump --format=custom --file=resvary-before-upgrade.dump "$DATABASE_URL"
createdb resvary_restore_test
pg_restore --clean --if-exists --dbname=resvary_restore_test resvary-before-upgrade.dump
```

For SQLite, stop every writer and use SQLite's `.backup` command, or checkpoint WAL before copying the database. Preserve file ownership and permissions.

Record the backup location, schema version, application commit, image digest, project ID, and UTC time in the deployment ticket. Never record the admin secret.

## Rollback

1. Stop all application writers, workers, and the console.
2. Preserve the failed database for diagnosis.
3. Restore the pre-migration backup into a clean database or replace the stopped SQLite database with its pre-upgrade backup.
4. Start the matching pre-upgrade application and worker builds against the restored database.
5. Verify balances, open reservations, receipt lookup, and outbox processing before reopening traffic.

Do not attempt an in-place downgrade by deleting normalized columns, operator actions, or schema metadata.

## Secret rotation

Replace `RESVARY_CONSOLE_ADMIN_SECRET` with a new random value of at least 32 characters and restart the instance. Existing session cookies fail verification immediately because their secret fingerprint and signature no longer match. Verify the old secret is rejected and the new secret creates a secure cookie. Rotate the secret after suspected disclosure or operator offboarding.

## Operational recovery

Metered operation recovery is separate from external funding reconciliation. On **Operations**, filter by status and time since last update, then open an operation to review its saved usage, pricing, holds, receipt, transitions, and command log. `/api/health` reports counts and oldest ages for all seven operation states; unresolved means `outcome_unknown`, `result_saved`, or `needs_reconciliation`. A stale `running` operation also needs investigation even though it is not counted in that unresolved total.

- **Saved result:** review the charge evidence, enter the incident reason, preview, and settle. If the original hold is expired or too small, review the resulting reconciliation state.
- **Reconciliation:** confirm the measured charge and current funding, then explicitly reconcile. An insufficient balance leaves the operation unresolved without a negative balance. Correct the funding and create a new command after a recorded failure.
- **Unknown outcome:** check the provider's records by operation key. Stop or fence the original worker before confirming no execution. A timeout is not proof of non-execution. If a result exists, recover it through `DurableMeteredOperations.recoverResult` with external evidence, then settle it.

- **Overdue reservations:** inspect the customer and reservation timestamps, then run the expiry sweep. The command only releases records already overdue at the supplied cutoff.
- **Dead-letter event:** inspect attempts and payload, correct the receiver, then requeue that exact event. Pending or delivered events are rejected.
- **Balance correction:** enter a signed amount and a reason that identifies the incident or ticket. Confirm the preview before submission.
- **Manual credit:** use a positive amount. Negative grants are rejected; use an adjustment for a correction.

Reuse the same displayed action UUID when a request times out and its outcome is unknown. A new UUID represents a new command and may cause a second valid mutation.

## Incident evidence

Capture the operator action UUID, project ID, target ID, UTC time, result status, and linked receipt/reservation/ledger identifiers. Do not paste the admin secret or raw customer payload into tickets or logs.
