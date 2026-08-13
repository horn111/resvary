# Roadmap

> Last updated: August 2026

Settlary is now focused on open-source prepaid credits and usage billing for AI products. Arc remains an optional funding rail, not the product category.

## 0.3 alpha: shipped in repository

- [x] USD credit accounts with six-decimal integer arithmetic
- [x] Manual grants and compensating adjustments
- [x] Multi-dimensional meters and immutable price versions
- [x] Atomic reserve, commit, release, and expiry lifecycle
- [x] Per-charge usage receipts and immutable ledger entries
- [x] Idempotent mutation commands and duplicate usage protection
- [x] Transactional outbox and signed credit webhook helper
- [x] In-memory and SQLite stores
- [x] Restart, rollback, and concurrent reservation coverage
- [x] Arc Testnet invoice/payment receipt to credit grant adapter
- [x] Interactive simulated AI demo with optional live provider
- [x] AI credits starter for Express and Next.js
- [x] Backward-compatible receipts, x402, and buyer APIs

## Next: production persistence

- [ ] Postgres `CreditStore` and receipt store
- [ ] Cross-process concurrency and isolation tests
- [ ] Durable outbox delivery worker with retries and dead-letter state
- [ ] Structured logs, health checks, and migration CLI
- [ ] Import/export for local SQLite data
- [ ] Design-partner deployment guide

## Candidate milestone: funding and distribution

The next item is selected from design-partner evidence rather than implemented in parallel:

- Stripe-funded credits if card checkout is the adoption blocker;
- self-hosted HTTP service if teams need non-TypeScript or multi-service access;
- hosted control plane if teams ask Settlary to operate persistence and delivery;
- Arc production funding after Arc mainnet and legal review.

## Later

- allowance and promotional grant policies;
- tiered and package pricing;
- dashboard, audit explorer, and usage analytics;
- Fastify, Hono, Python, and Go clients;
- reversals and product-level refund policies;
- postpaid B2B usage and clearing adapters.

## Explicit non-goals for the alpha

- subscriptions, tax calculation, or tax invoices;
- transferable or redeemable credits;
- custody, cash-out, or marketplace wallets;
- managed production queue or SLA;
- expiring credit grants;
- hosted authentication, RBAC, and tenant administration.
