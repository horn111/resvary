# Funding Recovery and Reconciliation

Both funding rails use a durable, idempotent saga. Resvary does not attempt a distributed transaction across an RPC provider, Circle Gateway, and the credit store.

## Direct Arc

```text
save invoice
-> scan bounded block ranges
-> validate Memo and USDC transfer
-> save payment receipt
-> confirm funding transaction and credit grant
```

`ArcFundingWorker` restores pending intents from the receipt store, resumes persisted cursors, scans with a configurable overlap, retries RPC calls with exponential backoff and jitter, and confirms saved receipts that were not granted before a crash.

Recommended single-node settings:

```typescript
const worker = new ArcFundingWorker({
  ledger,
  receiptStore,
  payTo,
  confirmations: 2,
  maxBlockRange: 2_000,
  maxBlocksPerPoll: 10_000,
  cursorOverlap: 2,
  retryAttempts: 3,
});
```

The receipt and credit stores may commit at different times. A saved receipt is the recovery boundary. The worker retries credit confirmation; ledger uniqueness prevents a second grant.

## Gateway Nanopayment

```text
create funding intent
-> receive signed authorization
-> validate exact requirements
-> Circle verify
-> Circle settle
-> confirm funding transaction and credit grant
```

A crash after Circle settle but before the local grant requires the caller to retry the same signed payment. Circle and Resvary both receive the same authorization. Resvary derives the same authorization hash and creates at most one grant.

A later adverse Gateway event does not silently reverse credits that may already have been spent. Call `markReconciliationRequired`; Resvary keeps the ledger history and emits `funding.reconciliation_required` for an operator decision.

## Operator checklist

1. Inspect the funding intent, external payment reference, and outbox events.
2. Retry the same idempotent operation. Do not create a new external payment.
3. Confirm that one funding transaction references one credit grant.
4. If external settlement remains disputed, mark reconciliation required.
5. Use a compensating credit adjustment only after a documented merchant decision.
