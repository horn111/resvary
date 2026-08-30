# Architecture

## System shape

```text
AI application
  └─ CreditLedger
      ├─ integer pricing and rating
      ├─ accounts and reservations
      ├─ grant policies, credit lots, and allocations
      ├─ immutable ledger and usage receipts
      ├─ idempotency records
      ├─ transactional outbox
      └─ CreditStore + optional CreditPolicyStore
          ├─ InMemoryCreditStore
          ├─ SqliteCreditStore
          └─ PostgresCreditStore

Credit outbox
  └─ lease / retry / dead letter
      └─ OutboxWorker -> signed HTTP webhook

Arc settlement
  Direct Arc transfer -> Memo proof -> payment receipt --+
                                                        +-> funding transaction -> credit grant
  Gateway authorization -> Circle verify -> settle -----+
```

Arc is the reference settlement network for external USDC funding. Both Arc paths end in the same funding transaction and exactly-once credit grant. The ledger also accepts manual product grants and can support more payment sources without changing usage accounting.

The embedded SDK is the supported interface. Domain commands do not depend on HTTP, Next.js, Express, a wallet, or an AI provider. A future service can therefore wrap the same operations without replacing the ledger.

## Transaction boundary

Every balance-changing command performs this sequence inside one store transaction:

```text
validate idempotency
→ read account and domain state
→ validate balance and lifecycle
→ write immutable ledger entries
→ update account snapshot
→ write grant/reservation/usage/funding record
→ write outbox event
→ store the command result
→ commit
```

Policy-capable stores also expire available promotion lots, select lots in deterministic priority order, and update reservation allocations inside this boundary. Legacy custom `CreditStore` implementations keep the original transaction contract; policy commands require `CreditPolicyStore` and otherwise fail closed.

SQLite uses `BEGIN IMMEDIATE` so concurrent writers cannot reserve the same available credits. Postgres uses `SERIALIZABLE` transactions with bounded retry so independent application processes preserve the same invariant. The in-memory implementation serializes transactions and commits a cloned state only after the handler succeeds.

Postgres outbox workers claim due rows with `FOR UPDATE SKIP LOCKED`. A claim has a lease; a stopped worker's events become eligible after the lease expires. Delivery is at least once, so webhook consumers deduplicate by event ID.

## Balance model

An account stores three snapshots:

- `posted`: granted credits minus committed charges;
- `reserved`: credits held by open reservations;
- `available = posted - reserved`.

Ledger entries independently record changes to the posted or reserved bucket. They are append-only. Corrections use an adjustment entry rather than editing history.

Each grant in a policy-capable store creates a credit lot. Reservations consume promotions by nearest expiry, allowances FIFO, then general and migrated legacy credits FIFO. A reservation allocation survives promotion expiry so commit remains valid. Expired units released from an open reservation burn instead of becoming available again.

## Usage lifecycle

`reserveCredits` rates estimated usage and moves that amount into the reserved bucket. `commitUsage` rates actual usage, subtracts the actual charge from posted credits, and releases the full reservation in the same transaction. The receipt records actual line items, released amount, price version, and before/after available balance.

`runMetered` is a convenience orchestrator. Provider exceptions release the reservation. Commit failures do not: the caller can retry the same commit without giving away completed usage.

## Payment compatibility

The existing receipt subsystem remains separate because a payment receipt and usage receipt answer different questions:

- payment receipt: which external transfer funded an account;
- usage receipt: why a specific amount of product credits was charged.

Funding adapters validate this connection and guarantee one grant per `rail + network + externalPaymentId`. Direct Arc uses the transaction hash. Gateway uses a hash of normalized authorization fields and stores no full signature.
