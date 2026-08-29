# Roadmap

> Last updated: August 2026

Resvary is an embedded, open-source prepaid credit ledger and usage billing SDK for AI products. Arc is the reference settlement network for external USDC funding. The ledger keeps settlement separate from usage accounting so manual grants and future payment sources can fund the same credit lifecycle.

## 0.4 alpha: Circle-native funding proof

- [x] Funding rail and settlement domain model
- [x] SQLite schema migration v2 and rail-scoped external payment uniqueness
- [x] Durable Arc worker with persisted cursors, bounded scans, overlap, retry, and crash reconciliation
- [x] Direct Arc Testnet proof path with exactly-once grants
- [x] `@resvary/circle` integration package for Arc and Circle Gateway funding
- [x] Official Circle batching facilitator verify and settle integration
- [x] Exact-amount Gateway Nanopayment top-ups and replay-safe grants
- [x] Framework-neutral, Next.js, and Express HTTP handlers
- [x] Dual-rail interactive demo
- [x] Recovery, migration, threat-boundary, video, and evidence documentation
- [x] Publish two real public evidence records and release tag

The published evidence is pinned to `v0.4.0-alpha.0` and records an external Arc Testnet transaction, a Circle Gateway settlement, replay checks, and the shared credit lifecycle.

## 0.5 stable: production persistence

- [x] Postgres `CreditStore` and receipt store
- [x] Serializable transactions and cross-process concurrency tests
- [x] Durable outbox delivery worker with retries, leases, and dead-letter state
- [x] Structured logs, liveness/readiness checks, and migration CLI
- [x] Offline SQLite import with payload, count, balance, ledger, receipt, funding, and outbox verification
- [x] SQLite schema v4 compatibility for outbox lifecycle and cross-rail transaction uniqueness
- [x] Postgres schema constraints and sequential migration coverage
- [x] SQLite/Postgres starter build coverage
- [x] Self-hosted deployment and cutover guide

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
