# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Resvary serves technical founders, backend engineers, and platform engineers at small AI product teams. The Operator Console is for the person on call who must explain a balance change, investigate a usage charge, or recover an operational failure without editing the database by hand.

## Product Purpose

Resvary is open-source prepaid credits and usage billing infrastructure for AI products. It reserves the maximum cost before work starts, charges actual usage afterward, releases the remainder, and records an auditable receipt. Version 1.0 adds a self-hosted operator surface so the ledger can be inspected and safely operated in production.

Success means an operator can trace any charge from account balance through reservation, receipt, price version, and ledger entries; find overdue or failed work; and perform a small set of guarded recovery actions.

## Positioning

Resvary owns the real-time credit authorization lifecycle around AI work. It combines atomic reserve, commit, and release commands with immutable usage receipts and an operator-facing audit trail, without requiring adoption of a subscription, invoicing, tax, or hosted billing platform.

## Operating Context

- The TypeScript SDK remains the supported embedded integration surface.
- PostgreSQL 16–18 is the production persistence path; SQLite supports local and single-node operation.
- One console instance operates one configured Resvary project.
- Operators work primarily from desktop browsers and may need to inspect dense timelines, machine-readable payloads, and failure states under time pressure.
- The public launch includes a read-only preview backed only by synthetic data.

## Capabilities and Constraints

- The console covers Overview, Customers, Audit Explorer, and Operations.
- Protected actions are limited to positive manual grants, reasoned balance adjustments, expiry of already-overdue reservations, and requeue of dead-letter outbox events.
- Every operator action is idempotent and append-only audited.
- All console pages and private routes use one environment-provided admin secret and an HttpOnly session.
- The console target is 10,000 customers and 1,000,000 activity records per project with cursor pagination.
- Version 1.0 does not include a hosted control plane, RBAC, OIDC, pricing or policy editing, refunds, postpaid billing, subscriptions, tax invoices, or new language SDKs.
- Credits remain closed-loop, non-transferable, and non-redeemable.

## Brand Commitments

The product name is Resvary. Voice is direct, technical, calm, and explicit about limitations. Use the existing logo and the established monochrome technical editorial identity in `DESIGN.md`; do not introduce decorative grids, colored gradients, glass panels, or generic SaaS card styling.

## Evidence on Hand

- The public SDK and six-package release workflow are established at version 0.8.0.
- The repository contains SQLite and PostgreSQL persistence, concurrency and migration tests, a durable outbox worker, Arc Testnet funding evidence, and an interactive Next.js demo.
- There are no public customer metrics, testimonials, or named design partners; future work must not invent them.

## Product Principles

1. Every balance change must be explainable from immutable evidence.
2. Recovery actions must narrow risk, preserve history, and fail closed.
3. Self-hosting must be predictable: explicit migrations, health checks, and no hidden telemetry.
4. Stable domain contracts matter more than dashboard novelty.
5. Operational density is useful only when state, consequence, and next action remain legible.

## Accessibility & Inclusion

The web console must be keyboard-operable, preserve visible focus, expose status and errors to assistive technology, maintain WCAG AA contrast, and remain usable from 390px mobile widths through desktop operator workstations.
