# Preparing for Resvary 1.3

The 1.3 update adds operator recovery for the durable metered operations introduced in 1.2. It does not convert existing `runMetered` calls into durable operations. Manifests and starter dependencies are prepared at 1.3.0; publication still requires the release gates in [Release Publication](releasing.md).

## Deployment

1. Stop writers, back up the database, and verify that the backup restores.
2. Apply PostgreSQL schema v6 with `resvary-postgres migrate`. SQLite upgrades from v7 to v8 when the store opens. These migrations add indexes for operation lists, transition history, and targeted operator actions; they do not change balances or reservations.
3. Deploy the matching SDK, store, outbox worker, and console builds. Restart long-lived processes after the migration.
4. Check the schema version, authenticated `/api/health`, and an operation belonging to the configured console project. Test a saved-result recovery in staging and replay the same command UUID.
5. Resume writers and monitor metered-operation backlog separately from funding reconciliation and outbox delivery.

PostgreSQL indexes are created in a transaction. Schedule the migration window for the size of the operation, outbox, and operator-action tables. Retain the pre-migration backup and previous application artifacts. Roll back by restoring both together during a writer outage, not by deleting migration rows.

## API changes

- `DurableMeteredOperations.list` accepts an exclusive `after: { createdAt, id }` cursor and `updatedBefore`. Its ascending order and 500-row maximum remain unchanged. Pass the last row of one page as `after` for the next page.
- Bundled admin stores implement the additional `AdminOperationStore` interface. Existing custom `AdminQueryStore` implementations remain source-compatible. Implement the new interface only when exposing operation queries through a custom admin backend.
- `OperatorService` adds `settleOperation`, `reconcileOperation`, `markOperationUnknown`, and `confirmOperationNotExecuted`. Charging commands require the reviewed `resultHash`. Cancellation requires an external evidence reference. Every command requires an action UUID and reason.
- PostgreSQL health and console health add `meteredOperations`: per-state counts and oldest ages, plus an unresolved count and oldest unresolved age. Ages measure time since operation creation. The console's “Last update” filter uses `updatedAt` instead.
- Coordinator state changes emit `operation.transitioned` through the transactional outbox. Update exhaustive event-type switches and consumers that reject unfamiliar types before rollout. Delivery uses the same signature, lease, retry, and deduplication rules as existing events.

Admin list cursors are opaque and sort newest first. SDK worker-list cursors are explicit and sort oldest first. Neither is a snapshot: concurrent status changes can change which records match a filter. Use periodic bounded sweeps rather than treating one paginated traversal as a complete scheduler snapshot.

## History and privacy

Each state transition records a monotonic sequence in the same transaction as the operation update. Equal timestamps cannot reorder its history. Existing operations receive a sequence on their next state change; earlier transitions are not invented. Repeated calls that leave the state unchanged do not add duplicate transitions. Reconciliation attempts and failed commands also remain visible in the operator command journal.

The console receives an explicit allowlist of operation fields. Execution claim tokens, worker identity, provider response values, provider metadata, and raw provider errors are excluded from these operation views and command responses. A saved usage breakdown, result hash, customer, hold, and receipt identifiers remain available for review. Keep secrets out of operation keys, reasons, and evidence references too.

State history reads transition payloads retained in the outbox. Delivery status may change, but the coordinator does not rewrite transition payloads. Retain or archive delivered transition events for as long as their audit history is required; pruning them removes that portion of history from the console. This is operational evidence, not a tamper-proof audit system against a database administrator.

## Recovery boundaries

Recovery never invokes the provider. A running job can be marked unknown, but this does not stop its worker or prove that the provider did nothing. Before confirming no execution, stop or fence the worker and verify absence through a provider-specific lookup. A timeout, expired hold, or missing local response is not negative evidence.

If an external lookup finds a completed result, use the SDK's existing `recoverResult` with that evidence and measured usage, then review and settle the saved result in the console. The console does not accept arbitrary provider-result JSON.

A successful command may leave the operation in `needs_reconciliation`; inspect `result.resolved` and the current state. Insufficient credits leave the operation unresolved. A failed command UUID keeps its failure; after fixing the cause, prepare a new command. A lost response or pending command must be retried with the original UUID and payload first.

The SQLite-to-PostgreSQL importer still accepts only an offline schema-v5 SQLite snapshot. It rejects v7/v8 databases rather than silently omitting durable operations. This update does not expand the importer.

Run the reproducible process-crash example after building the packages:

```bash
npm run build:core
node examples/durable-operation-recovery.mjs
```

It uses synthetic provider usage and a temporary SQLite database. One child process saves a result and exits abruptly; the parent reopens the database, settles through `OperatorService`, and repeats the same command. Assertions verify one provider call, one receipt, and the expected balance. The printed database path remains available for inspection.

For PostgreSQL regression checks, set `TEST_DATABASE_URL` to a dedicated, disposable database whose name ends in `_test`, then run:

```bash
npm run build:core
npm run test --workspace=@resvary/postgres
npm run test --workspace=@resvary/agent-demo
```

The PostgreSQL suite creates and removes its own schemas. Agent Demo tests truncate their job tables, so use a test database, never application data. Without `TEST_DATABASE_URL`, database integration tests are skipped. The adapter suite covers migration from schema v5 with a saved operation, concurrent recovery, replay of the same command UUID, cursor pagination, project isolation, and redaction. CI runs the adapter against PostgreSQL 16, 17, and 18. Run `npm test` with the same variable set for the full workspace suite.
