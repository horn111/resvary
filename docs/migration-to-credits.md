# Migrating From Legacy Billing

The original `UsageMeter` and `createBillingPlan` APIs remain compatible but are deprecated. They use in-memory records and floating-point totals and should not become the source of truth for customer balances.

## Mapping

| Legacy concept             | Credit engine                               |
| -------------------------- | ------------------------------------------- |
| wallet buyer               | opaque application `customerId`             |
| `UsageMeter.record`        | `reserveCredits` plus `commitUsage`         |
| calculated amount          | immutable `PriceVersion` and `UsageReceipt` |
| direct per-request payment | manual or Arc-funded account balance        |
| payment receipt            | funding evidence; not a usage receipt       |

## Migration sequence

1. Define a stable `projectId` and application customer IDs.
2. Register meters and price versions.
3. Import existing closed-loop balances with `grantCredits({ source: 'migration' })` and deterministic idempotency keys.
4. Wrap one AI operation with `runMetered`.
5. Reconcile usage receipts against provider response IDs.
6. Move remaining operations after retry and failure behavior is verified.

Invoices are not automatically converted into balances. A historical invoice represents an external payment; a credit account represents the merchant's current obligation to provide service.

Existing x402 middleware, buyer client, invoice, proof, receipt, and webhook imports do not change in `0.3`.
