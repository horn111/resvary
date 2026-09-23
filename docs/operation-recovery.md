# Durable metered operations (1.2)

Use `DurableMeteredOperations` when a queue or worker separates the provider call from credit settlement. The existing `runMetered`, reservation, and `commitUsage` APIs remain available. An operation is identified by a project-scoped key and has its own state, independent of its reservation.

```typescript
import { CreditLedger, DurableMeteredOperations } from '@resvary/sdk/credits';

const credits = new CreditLedger({ projectId: 'my_ai_product', store });
const operations = new DurableMeteredOperations(credits);
const operation = await operations.create({
  customerId: 'customer_123',
  priceId: price.id,
  estimatedUsage: { input_tokens: '2000', output_tokens: '1000' },
  idempotencyKey: 'job_123',
  expiresAt: Date.now() + 30 * 60_000,
});
await queue.send({ operationKey: operation.operationKey });

// In a worker. A duplicate claim returns undefined and must not invoke the provider.
const claim = await operations.claim({ operationKey: 'job_123', workerId: 'worker_1' });
if (claim) {
  const completion = await callModel({ idempotencyKey: claim.operationKey });
  await operations.saveResult({
    operationKey: claim.operationKey,
    claimToken: claim.claimToken!,
    result: {
      value: { providerId: completion.id },
      usageEventId: completion.id,
      actualUsage: {
        input_tokens: String(completion.inputTokens),
        output_tokens: String(completion.outputTokens),
      },
    },
  });
}

// This step can run in another process or after a restart.
const { operation: final, receipt } = await operations.settle('job_123');
if (final.status === 'needs_reconciliation') {
  // Review the saved result and funding, then explicitly call operations.reconcile('job_123').
}
```

| Operation state        | Meaning                                                              | May call the provider?               |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------ |
| `queued`               | A reservation exists, but no worker has claimed execution.           | Only after an atomic claim.          |
| `running`              | One worker owns a permanent execution claim.                         | That worker may make its first call. |
| `outcome_unknown`      | The worker did not persist a result; an external lookup is required. | No.                                  |
| `result_saved`         | A JSON-safe provider result and measured usage are durable.          | No.                                  |
| `needs_reconciliation` | The saved result could not be charged against the original hold.     | No.                                  |
| `settled`              | A usage receipt was issued.                                          | No.                                  |
| `cancelled`            | No charge is due; the hold is released or awaits expiry.             | No.                                  |

Create an operation before enqueueing a job. A worker calls `claim` and invokes the provider only if the claim succeeds. Give the provider the operation key as its idempotency key when supported. Persist the result with `saveResult` **before** `settle`. A second worker, including one after a process restart, may settle the saved result but must never call the provider again. A claim has no automatic lease-based retry: a process can die after the provider acts but before it saves the result. Replaying the call in that window could duplicate an external side effect.

If a claimed worker disappears, mark the operation `outcome_unknown` and query the provider by the same key. `recoverResult` records a result found by that lookup. `confirmNotExecuted` requires an external evidence reference before cancelling and releasing an open hold. A late result from the original worker can still be saved while the outcome remains unknown. Only an operator or a provider-specific reconciliation process should decide that no call occurred.

`settle` uses the saved usage event and a stable commit key. A retry after a crash between credit commit and operation update replays the receipt. If the hold expired, was released, or is too small, the operation becomes `needs_reconciliation`. `reconcile` explicitly releases any remaining original hold, reserves the measured amount under a new idempotency key, and commits the saved usage event. If available credits cannot cover that amount, the operation stays unresolved; no negative balance or silent charge is created. Reconciliation retries can create a fresh hold after a prior reconciliation hold expires, but the usage event may be committed only once.

The SDK validates that saved provider results are JSON serializable and at most 128 KiB. Store a compact provider response or durable reference; do not put secrets or large model output in the operation record. Keep the provider's response in the application database when its retention or access policy differs from credit records.

## Storage and migration

`DurableMeteredOperations` requires the optional operation methods on a `CreditStore`. Bundled memory, SQLite, and PostgreSQL stores implement them. Custom 1.x stores keep working for the existing ledger API and receive an `unsupported_store_capability` error if used with this new coordinator until they implement operation persistence.

SQLite schema v7 adds `resvary_metered_operations` with an operation ID primary key, unique `(project_id, operation_key)`, a reservation foreign key, status and timestamps, and a JSON payload. SQLite applies v7 automatically when the store opens. PostgreSQL schema v5 adds the same table and indexes; run `resvary-postgres migrate` as a deployment step before starting 1.2 workers. Migrations do not rewrite existing reservations or claims. Existing `runMetered` claims stay independent and are not silently adopted as recoverable operations.

Creating the reservation and inserting the operation use two transactions because `reserveCredits` is a public ledger command. If a process dies between them, the reservation remains recoverable by its idempotency key and expires normally. Creating the operation again with the same input and key resumes from that reservation. Do not enqueue the job until `create` returns an operation record.

The existing `resvary-postgres import-sqlite` command intentionally accepts only an offline SQLite schema v5 snapshot from Resvary 0.8. It rejects schema v7; it does not drop operation records silently. Do not use that command to move a live 1.2 operation database. Settle or reconcile outstanding operations and use a separately verified migration plan for a newer SQLite database.
