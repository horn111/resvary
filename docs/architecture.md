# Architecture

## System shape

```text
AI application
  └─ CreditLedger
      ├─ integer pricing and rating
      ├─ accounts and reservations
      ├─ immutable ledger and usage receipts
      ├─ idempotency records
      ├─ transactional outbox
      └─ CreditStore
          ├─ InMemoryCreditStore
          └─ SqliteCreditStore

Optional funding
  Arc invoice → memo proof → payment receipt → ArcCreditFunding → credit grant
```

The embedded SDK is the supported alpha interface. Domain commands do not depend on HTTP, Next.js, Express, a wallet, or an AI provider. A future service can therefore wrap the same operations without replacing the ledger.

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

SQLite uses `BEGIN IMMEDIATE` so concurrent writers cannot reserve the same available credits. The in-memory implementation serializes transactions and commits a cloned state only after the handler succeeds.

## Balance model

An account stores three snapshots:

- `posted`: granted credits minus committed charges;
- `reserved`: credits held by open reservations;
- `available = posted - reserved`.

Ledger entries independently record changes to the posted or reserved bucket. They are append-only. Corrections use an adjustment entry rather than editing history.

## Usage lifecycle

`reserveCredits` rates estimated usage and moves that amount into the reserved bucket. `commitUsage` rates actual usage, subtracts the actual charge from posted credits, and releases the full reservation in the same transaction. The receipt records actual line items, released amount, price version, and before/after available balance.

`runMetered` is a convenience orchestrator. Provider exceptions release the reservation. Commit failures do not: the caller can retry the same commit without giving away completed usage.

## Payment compatibility

The existing receipt subsystem remains separate because a payment receipt and usage receipt answer different questions:

- payment receipt: which external transfer funded an account;
- usage receipt: why a specific amount of product credits was charged.

`ArcCreditFunding` validates their connection and guarantees one grant per `network + txHash`.
