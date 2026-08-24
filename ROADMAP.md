# Roadmap

> Last updated: August 2026

Resvary is an embedded, open-source prepaid credit ledger and usage billing SDK for AI products. Payment rails fund the ledger; they do not define the product.

## 0.4 alpha: Circle-native funding proof

- [x] Funding rail and settlement domain model
- [x] SQLite schema migration v2 and rail-scoped external payment uniqueness
- [x] Durable Arc worker with persisted cursors, bounded scans, overlap, retry, and crash reconciliation
- [x] Direct Arc Testnet proof path with exactly-once grants
- [x] Optional `@resvary/circle` package
- [x] Official Circle batching facilitator verify and settle integration
- [x] Exact-amount Gateway Nanopayment top-ups and replay-safe grants
- [x] Framework-neutral, Next.js, and Express HTTP handlers
- [x] Dual-rail interactive demo
- [x] Recovery, migration, threat-boundary, video, and evidence documentation
- [ ] Publish two real public evidence records and release tag

The final checkbox requires an external Arc Testnet transaction and Circle Gateway settlement. It cannot be satisfied by local tests or fabricated IDs.

## Next: production persistence

- [ ] Postgres `CreditStore` and receipt store
- [ ] Cross-process concurrency and isolation tests
- [ ] Durable outbox delivery worker with retries and dead-letter state
- [ ] Structured logs, health checks, and migration CLI
- [ ] Design-partner deployment guide

## Later

- allowance and promotional grant policies;
- tiered and package pricing;
- dashboard and audit explorer;
- Fastify, Hono, Python, and Go clients;
- product-level refunds and compensating adjustments;
- postpaid B2B usage.

## Explicit non-goals

- subscriptions, tax calculation, or tax invoices;
- transferable or redeemable credits;
- custody, cash-out, or marketplace wallets;
- hosted control plane, RBAC, or managed workers;
- Arc mainnet until public support, security review, and legal review exist.
